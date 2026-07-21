// ═══════════════════════════════════════════════════════════════════════════
// GulfLedger · ZATCA shared module (Deno / Supabase Edge Functions)
// supabase/functions/_shared/zatca.ts
// ───────────────────────────────────────────────────────────────────────────
// Contains: environment endpoints, ASN.1 DER builders, the ZATCA-profile CSR
// builder (secp256k1, SAN dirName attributes, certificate-template ext),
// auth helpers, and the Fatoora API fetch wrapper.
//
// ⚠ VERIFY-BEFORE-PROD: endpoint paths and header names below follow the
// published Fatoora API conventions; confirm against the current ZATCA
// developer portal before simulation/production onboarding. Sandbox is the
// proving ground — Sprint 1 exits with a successful sandbox round-trip.
// ═══════════════════════════════════════════════════════════════════════════

import { secp256k1 } from "https://esm.sh/@noble/curves@1.4.0/secp256k1";
import { sha256 } from "https://esm.sh/@noble/hashes@1.4.0/sha256";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── Environments ───────────────────────────────────────────────────────────
export const ZATCA_ENV = {
  sandbox: {
    base: "https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal",
    certTemplate: "TSTZATCA-Code-Signing",
  },
  simulation: {
    base: "https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation",
    certTemplate: "PREZATCA-Code-Signing",
  },
  production: {
    base: "https://gw-fatoora.zatca.gov.sa/e-invoicing/core",
    certTemplate: "ZATCA-Code-Signing",
  },
} as const;
export type ZatcaEnvName = keyof typeof ZATCA_ENV;

// ── Small utils ────────────────────────────────────────────────────────────
export const te = new TextEncoder();
export function bytesToHex(b: Uint8Array): string {
  return Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
}
export function hexToBytes(h: string): Uint8Array {
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}
export function b64(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
}
export function concat(...arrs: Uint8Array[]): Uint8Array {
  const len = arrs.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}

// ── ASN.1 DER builders (minimal, sufficient for the ZATCA CSR) ────────────
function derLen(n: number): Uint8Array {
  if (n < 0x80) return new Uint8Array([n]);
  const bytes: number[] = [];
  let v = n;
  while (v > 0) { bytes.unshift(v & 0xff); v >>= 8; }
  return new Uint8Array([0x80 | bytes.length, ...bytes]);
}
function tlv(tag: number, value: Uint8Array): Uint8Array {
  return concat(new Uint8Array([tag]), derLen(value.length), value);
}
export const SEQ = (...c: Uint8Array[]) => tlv(0x30, concat(...c));
export const SET = (...c: Uint8Array[]) => tlv(0x31, concat(...c));
export const INT = (n: number) => tlv(0x02, new Uint8Array([n]));
export const UTF8 = (s: string) => tlv(0x0c, te.encode(s));
export const PRINTABLE = (s: string) => tlv(0x13, te.encode(s));
export const OCTET = (b: Uint8Array) => tlv(0x04, b);
export const BITSTR = (b: Uint8Array) => tlv(0x03, concat(new Uint8Array([0x00]), b));
export const CTX = (n: number, b: Uint8Array, constructed = true) =>
  tlv((constructed ? 0xa0 : 0x80) | n, b);

export function OID(oid: string): Uint8Array {
  const parts = oid.split(".").map(Number);
  const body: number[] = [parts[0] * 40 + parts[1]];
  for (let i = 2; i < parts.length; i++) {
    let v = parts[i];
    const stack: number[] = [v & 0x7f];
    v >>= 7;
    while (v > 0) { stack.unshift((v & 0x7f) | 0x80); v >>= 7; }
    body.push(...stack);
  }
  return tlv(0x06, new Uint8Array(body));
}

// Relative distinguished name: SET { SEQ { OID, value } }
const RDN = (oid: string, value: Uint8Array) => SET(SEQ(OID(oid), value));

// ── ZATCA CSR ──────────────────────────────────────────────────────────────
// Profile (per ZATCA SDK CSR config):
//   Subject:  C=SA, OU=<branch>, O=<org>, CN=<common name>
//   Extensions (in extensionRequest attribute):
//     1.3.6.1.4.1.311.20.2  certificateTemplateName  PRINTABLESTRING (per env)
//     2.5.29.17             subjectAltName → directoryName with:
//        SN  (2.5.4.5)                   EGS serial  "1-GulfLedger|2-<model>|3-<uuid>"
//        UID (0.9.2342.19200300.100.1.1) VAT number (15 digits)
//        title (2.5.4.12)                invoice-type bitmap, "1100" = std+simplified
//        registeredAddress (2.5.4.26)    short address
//        businessCategory  (2.5.4.15)    industry
export interface CsrFields {
  commonName: string;       // e.g. "GulfLedger-EGS-1"
  orgName: string;          // legal business name (Arabic OK)
  orgUnit: string;          // branch name or TRN-10digit for VAT groups
  egsSerial: string;        // "1-GulfLedger|2-WebEGS|3-<uuid>"
  vatNumber: string;        // 15-digit TRN
  invoiceTypes: string;     // "1100"
  address: string;          // registered address (short national address)
  businessCategory: string; // e.g. "Retail"
}

export function buildZatcaCsr(privKeyHex: string, fields: CsrFields, env: ZatcaEnvName): { csrPem: string; csrB64: string } {
  const priv = hexToBytes(privKeyHex);
  const pubUncompressed = secp256k1.getPublicKey(priv, false); // 65 bytes, 0x04 || X || Y

  // SubjectPublicKeyInfo: { {ecPublicKey, secp256k1}, BIT STRING point }
  const spki = SEQ(
    SEQ(OID("1.2.840.10045.2.1"), OID("1.3.132.0.10")),
    BITSTR(pubUncompressed),
  );

  // Subject Name (order: C, OU, O, CN — matches ZATCA SDK output)
  const subject = SEQ(
    RDN("2.5.4.6", PRINTABLE("SA")),
    RDN("2.5.4.11", UTF8(fields.orgUnit)),
    RDN("2.5.4.10", UTF8(fields.orgName)),
    RDN("2.5.4.3", UTF8(fields.commonName)),
  );

  // SAN: GeneralNames with one directoryName [4]
  const sanDirName = SEQ(
    // ZATCA "SN" = OpenSSL shortname for SURNAME (2.5.4.4), NOT serialNumber
    // (2.5.4.5). Verified by byte-diff against a sandbox-ISSUED CSR.
    RDN("2.5.4.4", UTF8(fields.egsSerial)),
    RDN("0.9.2342.19200300.100.1.1", UTF8(fields.vatNumber)),
    RDN("2.5.4.12", UTF8(fields.invoiceTypes)),
    RDN("2.5.4.26", UTF8(fields.address)),
    RDN("2.5.4.15", UTF8(fields.businessCategory)),
  );
  const san = SEQ(CTX(4, sanDirName)); // GeneralName ::= [4] directoryName

  const extensions = SEQ(
    SEQ(OID("1.3.6.1.4.1.311.20.2"), OCTET(PRINTABLE(ZATCA_ENV[env].certTemplate))),
    SEQ(OID("2.5.29.17"), OCTET(san)),
  );

  // attributes [0]: Attribute { extensionRequest, SET { extensions } }
  const attributes = CTX(0, SEQ(OID("1.2.840.113549.1.9.14"), SET(extensions)));

  const cri = SEQ(INT(0), subject, spki, attributes);

  // Sign CRI with ECDSA-SHA256 over secp256k1; DER signature
  const digest = sha256(cri);
  const sig = secp256k1.sign(digest, priv);
  const sigDer = sig.toDERRawBytes();

  const csr = SEQ(
    cri,
    SEQ(OID("1.2.840.10045.4.3.2")), // ecdsa-with-SHA256
    BITSTR(sigDer),
  );

  const csrB64 = b64(csr);
  const lines = csrB64.match(/.{1,64}/g)!.join("\n");
  const csrPem = `-----BEGIN CERTIFICATE REQUEST-----\n${lines}\n-----END CERTIFICATE REQUEST-----`;
  return { csrPem, csrB64: btoa(csrPem) }; // ZATCA expects base64 of the full PEM
}

export function generateKeypairHex(): { privHex: string } {
  const priv = secp256k1.utils.randomPrivateKey();
  return { privHex: bytesToHex(priv) };
}

// ── Fatoora API ────────────────────────────────────────────────────────────
const ZATCA_COMMON_HEADERS = {
  "Content-Type": "application/json",
  "Accept": "application/json",
  "Accept-Version": "V2",
  "Accept-Language": "en",
  // ZATCA's WAF rejects header-less clients; present as a normal HTTP client.
  "User-Agent": "GulfLedger-EGS/1.0 (Supabase Edge; +https://gulfledger.vercel.app)",
};

async function readZatcaBody(res: Response): Promise<{ body: unknown; raw: string }> {
  const raw = await res.text().catch(() => "");
  try { return { body: JSON.parse(raw), raw }; } catch { return { body: {}, raw }; }
}

/** Calls ZATCA — directly, or via the Vercel relay if ZATCA_RELAY_URL is set
 *  (ZATCA's Cloudflare challenges Supabase egress IPs; the relay re-originates
 *  the request from the GulfLedger domain). Same return shape either way. */
async function zatcaCall(env: ZatcaEnvName, path: string, headers: Record<string, string>, body: unknown) {
  const relayUrl = Deno.env.get("ZATCA_RELAY_URL") ?? "";
  const relaySecret = Deno.env.get("ZATCA_RELAY_SECRET") ?? "";
  const basePath = new URL(ZATCA_ENV[env].base).pathname; // /e-invoicing/<env>

  if (relayUrl && relaySecret) {
    const res = await fetch(relayUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-relay-secret": relaySecret },
      body: JSON.stringify({ path: `${basePath}${path}`, headers, body }),
    });
    const wrapper = await res.json().catch(() => ({}));
    const raw = String(wrapper.raw ?? "");
    let parsed: unknown = {};
    try { parsed = JSON.parse(raw); } catch { /* html or empty */ }
    return { ok: wrapper.upstream_status === 200, status: Number(wrapper.upstream_status ?? res.status), body: parsed, raw: raw.slice(0, 600), server: String(wrapper.server ?? "relay") };
  }

  const res = await fetch(`${ZATCA_ENV[env].base}${path}`, {
    method: "POST",
    headers: { ...ZATCA_COMMON_HEADERS, ...headers },
    body: JSON.stringify(body),
  });
  const { body: parsed, raw } = await readZatcaBody(res);
  return { ok: res.status === 200, status: res.status, body: parsed, raw: raw.slice(0, 600), server: res.headers.get("server") ?? "" };
}

export async function zatcaComplianceCsid(env: ZatcaEnvName, csrB64: string, otp: string) {
  return zatcaCall(env, "/compliance", { "OTP": otp, "Accept-Version": "V2", "Accept-Language": "en", "Accept": "application/json" }, { csr: csrB64 });
}

export async function zatcaProductionCsid(env: ZatcaEnvName, complianceCsid: string, secret: string, complianceRequestId: string) {
  const auth = "Basic " + btoa(`${complianceCsid}:${secret}`);
  return zatcaCall(env, "/production/csids", { "Authorization": auth, "Accept-Version": "V2", "Accept-Language": "en", "Accept": "application/json" }, { compliance_request_id: complianceRequestId });
}

// ── Supabase helpers ───────────────────────────────────────────────────────
export function serviceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

/** Verify the caller's JWT and their access to the business. Returns user id.
 *  v2: validates the token EXPLICITLY (works across legacy + new signing keys)
 *  and reports the precise reason on failure, so 401s are debuggable. */
export async function requireBusinessAccess(req: Request, businessId: string): Promise<{ userId: string } | Response> {
  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!jwt) return json({ error: "unauthorized", reason: "no_token", hint: "Authorization header missing" }, 401);

  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: `Bearer ${jwt}` } } },
  );
  const { data, error } = await userClient.auth.getUser(jwt);
  if (error || !data?.user) {
    return json({ error: "unauthorized", reason: "getUser_failed", detail: error?.message ?? "no user" }, 401);
  }
  const user = data.user;

  // Business access: try the RPC; if the helper signature differs, fall back to
  // a direct membership probe under the user's own RLS.
  let hasAccess = false;
  const rpc = await userClient.rpc("user_has_business_access", { p_business_id: businessId });
  if (!rpc.error && rpc.data === true) hasAccess = true;
  if (!hasAccess) {
    const probe = await userClient.from("businesses").select("id").eq("id", businessId).maybeSingle();
    if (!probe.error && probe.data?.id === businessId) hasAccess = true;
  }
  if (!hasAccess) return json({ error: "forbidden", reason: "no_business_access", business_id: businessId }, 403);
  return { userId: user.id };
}

export function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    },
  });
}

export function corsPreflight(req: Request): Response | null {
  if (req.method === "OPTIONS") return json({ ok: true });
  return null;
}


// ═══════════════════════════════════════════════════════════════════════════
// SPRINT 2 — UBL 2.1 builder, invoice hashing, XAdES signing, QR (TLV)
// ───────────────────────────────────────────────────────────────────────────
// Hash quirks mirror the ZATCA SDK exactly (verified against zatca-xml-js):
//   invoiceHash          = b64( raw sha256 bytes of pure XML )
//   certificateHash      = b64( HEX-STRING of sha256 of the cert base64 text )
//   signedPropertiesHash = b64( HEX-STRING of sha256 of the props XML block )
//   signature            = ECDSA-SHA256 over the raw invoiceHash bytes
// The signed-properties whitespace is part of the digest — do not reformat.
// ═══════════════════════════════════════════════════════════════════════════

export interface UblLine {
  name: string;
  quantity: number;
  unitPrice: number;        // VAT-exclusive
  vatCategory: "S" | "Z" | "E" | "O";
  vatRate: number;          // 15 for S, 0 otherwise
}
export interface UblInvoiceOpts {
  invoiceNumber: string;
  uuid: string;
  issueDate: string;        // YYYY-MM-DD
  issueTime: string;        // HH:mm:ss
  invoiceTypeCode: "388" | "381" | "383";
  subType: "standard" | "simplified";  // 0100000 | 0200000
  icv: number;
  pih: string;
  seller: { name: string; vat: string; street: string; building: string; city: string; district: string; postal: string; crn?: string };
  buyer:  { name: string; vat?: string; street?: string; city?: string };
  lines: UblLine[];
  billingReferenceId?: string;  // original invoice number, for 381/383
  note?: string;
}

function xesc(s: string): string {
  // C14N text escaping: only & < > are escaped in character data. Escaping
  // quotes here would make our bytes diverge from ZATCA's re-canonicalization
  // (they re-emit a raw ") for any value containing quotes. \r is stripped
  // because C14N would re-encode it as &#xD;.
  return String(s ?? "").replace(/\r/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function money(n: number): string { return (Math.round(n * 100) / 100).toFixed(2); }

export function buildInvoiceXml(o: UblInvoiceOpts): string {
  const typeName = o.subType === "simplified" ? "0200000" : "0100000";
  let totalExcl = 0, totalVat = 0;
  const cats = new Map<string, { taxable: number; vat: number; rate: number }>();
  const linesXml = o.lines.map((l, i) => {
    const ext = l.quantity * l.unitPrice;
    const vat = ext * (l.vatRate / 100);
    totalExcl += ext; totalVat += vat;
    const c = cats.get(l.vatCategory) ?? { taxable: 0, vat: 0, rate: l.vatRate };
    c.taxable += ext; c.vat += vat; cats.set(l.vatCategory, c);
    return `<cac:InvoiceLine><cbc:ID>${i + 1}</cbc:ID><cbc:InvoicedQuantity unitCode="PCE">${l.quantity}</cbc:InvoicedQuantity><cbc:LineExtensionAmount currencyID="SAR">${money(ext)}</cbc:LineExtensionAmount><cac:TaxTotal><cbc:TaxAmount currencyID="SAR">${money(vat)}</cbc:TaxAmount><cbc:RoundingAmount currencyID="SAR">${money(ext + vat)}</cbc:RoundingAmount></cac:TaxTotal><cac:Item><cbc:Name>${xesc(l.name)}</cbc:Name><cac:ClassifiedTaxCategory><cbc:ID>${l.vatCategory}</cbc:ID><cbc:Percent>${money(l.vatRate)}</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:ClassifiedTaxCategory></cac:Item><cac:Price><cbc:PriceAmount currencyID="SAR">${money(l.unitPrice)}</cbc:PriceAmount></cac:Price></cac:InvoiceLine>`;
  }).join("");

  const exemptReason = (cat: string) =>
    cat === "Z" ? `<cbc:TaxExemptionReasonCode>VATEX-SA-32</cbc:TaxExemptionReasonCode><cbc:TaxExemptionReason>Export of goods</cbc:TaxExemptionReason>`
    : cat === "E" ? `<cbc:TaxExemptionReasonCode>VATEX-SA-29</cbc:TaxExemptionReasonCode><cbc:TaxExemptionReason>Financial services</cbc:TaxExemptionReason>`
    : cat === "O" ? `<cbc:TaxExemptionReasonCode>VATEX-SA-OOS</cbc:TaxExemptionReasonCode><cbc:TaxExemptionReason>Out of scope</cbc:TaxExemptionReason>`
    : "";
  const subtotalsXml = [...cats.entries()].map(([cat, c]) =>
    `<cac:TaxSubtotal><cbc:TaxableAmount currencyID="SAR">${money(c.taxable)}</cbc:TaxableAmount><cbc:TaxAmount currencyID="SAR">${money(c.vat)}</cbc:TaxAmount><cac:TaxCategory><cbc:ID>${cat}</cbc:ID><cbc:Percent>${money(c.rate)}</cbc:Percent>${exemptReason(cat)}<cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal>`
  ).join("");

  const billingRef = o.billingReferenceId
    ? `<cac:BillingReference><cac:InvoiceDocumentReference><cbc:ID>${xesc(o.billingReferenceId)}</cbc:ID></cac:InvoiceDocumentReference></cac:BillingReference>`
    : "";
  const noteXml = o.note ? `<cbc:Note languageID="ar">${xesc(o.note)}</cbc:Note>` : "";
  const buyerVatXml = o.buyer.vat
    ? `<cac:PartyTaxScheme><cbc:CompanyID>${xesc(o.buyer.vat)}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>`
    : "";
  const sellerCrn = o.seller.crn
    ? `<cac:PartyIdentification><cbc:ID schemeID="CRN">${xesc(o.seller.crn)}</cbc:ID></cac:PartyIdentification>`
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2">
SET_UBL_EXTENSIONS_STRING
    <cbc:ProfileID>reporting:1.0</cbc:ProfileID>
    <cbc:ID>${xesc(o.invoiceNumber)}</cbc:ID>
    <cbc:UUID>${o.uuid}</cbc:UUID>
    <cbc:IssueDate>${o.issueDate}</cbc:IssueDate>
    <cbc:IssueTime>${o.issueTime}</cbc:IssueTime>
    <cbc:InvoiceTypeCode name="${typeName}">${o.invoiceTypeCode}</cbc:InvoiceTypeCode>
    ${noteXml}<cbc:DocumentCurrencyCode>SAR</cbc:DocumentCurrencyCode>
    <cbc:TaxCurrencyCode>SAR</cbc:TaxCurrencyCode>
    ${billingRef}<cac:AdditionalDocumentReference>
        <cbc:ID>ICV</cbc:ID>
        <cbc:UUID>${o.icv}</cbc:UUID>
    </cac:AdditionalDocumentReference>
    <cac:AdditionalDocumentReference>
        <cbc:ID>PIH</cbc:ID>
        <cac:Attachment>
            <cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${o.pih}</cbc:EmbeddedDocumentBinaryObject>
        </cac:Attachment>
    </cac:AdditionalDocumentReference>
    SET_QR_CODE_DATA
    <cac:Signature>
        <cbc:ID>urn:oasis:names:specification:ubl:signature:Invoice</cbc:ID>
        <cbc:SignatureMethod>urn:oasis:names:specification:ubl:dsig:enveloped:xades</cbc:SignatureMethod>
    </cac:Signature>
    <cac:AccountingSupplierParty>
        <cac:Party>
            ${sellerCrn}<cac:PostalAddress>
                <cbc:StreetName>${xesc(o.seller.street)}</cbc:StreetName>
                <cbc:BuildingNumber>${xesc(o.seller.building)}</cbc:BuildingNumber>
                <cbc:CitySubdivisionName>${xesc(o.seller.district)}</cbc:CitySubdivisionName>
                <cbc:CityName>${xesc(o.seller.city)}</cbc:CityName>
                <cbc:PostalZone>${xesc(o.seller.postal)}</cbc:PostalZone>
                <cac:Country><cbc:IdentificationCode>SA</cbc:IdentificationCode></cac:Country>
            </cac:PostalAddress>
            <cac:PartyTaxScheme>
                <cbc:CompanyID>${xesc(o.seller.vat)}</cbc:CompanyID>
                <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
            </cac:PartyTaxScheme>
            <cac:PartyLegalEntity>
                <cbc:RegistrationName>${xesc(o.seller.name)}</cbc:RegistrationName>
            </cac:PartyLegalEntity>
        </cac:Party>
    </cac:AccountingSupplierParty>
    <cac:AccountingCustomerParty>
        <cac:Party>
            ${(o.buyer.street || o.buyer.city) ? `<cac:PostalAddress>
                <cbc:StreetName>${xesc(o.buyer.street ?? "")}</cbc:StreetName>
                <cbc:CityName>${xesc(o.buyer.city ?? "")}</cbc:CityName>
                <cac:Country><cbc:IdentificationCode>SA</cbc:IdentificationCode></cac:Country>
            </cac:PostalAddress>
            ` : ""}${buyerVatXml}<cac:PartyLegalEntity>
                <cbc:RegistrationName>${xesc(o.buyer.name)}</cbc:RegistrationName>
            </cac:PartyLegalEntity>
        </cac:Party>
    </cac:AccountingCustomerParty>
    <cac:Delivery>
        <cbc:ActualDeliveryDate>${o.issueDate}</cbc:ActualDeliveryDate>
    </cac:Delivery>
    <cac:PaymentMeans><cbc:PaymentMeansCode>10</cbc:PaymentMeansCode>${o.invoiceTypeCode !== "388" ? `<cbc:InstructionNote>${xesc(o.note ?? "Correction")}</cbc:InstructionNote>` : ""}</cac:PaymentMeans>
    <cac:TaxTotal>
        <cbc:TaxAmount currencyID="SAR">${money(totalVat)}</cbc:TaxAmount>
        ${subtotalsXml}
    </cac:TaxTotal>
    <cac:TaxTotal>
        <cbc:TaxAmount currencyID="SAR">${money(totalVat)}</cbc:TaxAmount>
    </cac:TaxTotal>
    <cac:LegalMonetaryTotal>
        <cbc:LineExtensionAmount currencyID="SAR">${money(totalExcl)}</cbc:LineExtensionAmount>
        <cbc:TaxExclusiveAmount currencyID="SAR">${money(totalExcl)}</cbc:TaxExclusiveAmount>
        <cbc:TaxInclusiveAmount currencyID="SAR">${money(totalExcl + totalVat)}</cbc:TaxInclusiveAmount>
        <cbc:PayableAmount currencyID="SAR">${money(totalExcl + totalVat)}</cbc:PayableAmount>
    </cac:LegalMonetaryTotal>
    ${linesXml}
</Invoice>`;
}

// ── Hashing helpers (SDK quirks) ───────────────────────────────────────────
export function sha256B64(input: string | Uint8Array): string {
  const bytes = typeof input === "string" ? te.encode(input) : input;
  return b64(sha256(bytes));
}
export function sha256HexB64(input: string | Uint8Array): string {
  const bytes = typeof input === "string" ? te.encode(input) : input;
  return btoa(bytesToHex(sha256(bytes)));
}
export const INITIAL_PIH = "NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==";

/** Pure invoice XML (the hashed form): no declaration, no UBLExtensions,
 *  no cac:Signature block, no QR document reference. */
export function getPureInvoiceXml(xml: string): string {
  // Byte-exact equivalent of ZATCA's reference pipeline (XPath-exclude the three
  // blocks, then C14N11) for OUR self-generated template. The key insight that
  // fixes the hash: the XPath exclusion removes ONLY the element nodes — the
  // whitespace TEXT NODES around them remain and appear in the canonical bytes.
  // So we remove exactly the elements (no surrounding-whitespace eating, no
  // "fixups") and the residue is automatically what ZATCA computes.
  // Preconditions guaranteed by buildInvoiceXml: no self-closing tags, no
  // multi-attribute elements, root namespaces already in C14N prefix order,
  // LF line endings, text escaped as & < > only.
  let s = xml;
  // C14N drops the XML declaration (and its newline — outside the root element)
  s = s.replace(/<\?xml[^?]*\?>\n?/, "");
  // Placeholders (hash may be computed pre-injection): removing just the token
  // leaves the same bytes as element-only removal of the injected block.
  s = s.replace("SET_UBL_EXTENSIONS_STRING", "");
  s = s.replace("SET_QR_CODE_DATA", "");
  // Element-only removals — regexes deliberately do NOT consume the whitespace
  // text nodes before/after the elements.
  s = s.replace(/<ext:UBLExtensions>[\s\S]*?<\/ext:UBLExtensions>/, "");
  s = s.replace(/<cac:AdditionalDocumentReference>\s*<cbc:ID>QR<\/cbc:ID>[\s\S]*?<\/cac:AdditionalDocumentReference>/, "");
  s = s.replace(/<cac:Signature>[\s\S]*?<\/cac:Signature>/, "");
  return s;
}
export function computeInvoiceHash(xml: string): string {
  return sha256B64(getPureInvoiceXml(xml));
}

// ── Certificate parsing (from the CSID binarySecurityToken) ───────────────
export interface CertInfo {
  certB64: string;        // base64 DER (cleaned, no armor/newlines)
  derBytes: Uint8Array;
  hash: string;           // SDK quirk: b64(hex(sha256(certB64 text)))
  issuer: string;         // RFC2253-ish, e.g. "CN=eInvoicing"
  serialDecimal: string;
}
export function parseCsidCertificate(binarySecurityToken: string): CertInfo {
  // BST is base64( base64-DER text ) in ZATCA responses
  let certB64 = binarySecurityToken.trim();
  try {
    const once = atob(certB64);
    if (once.startsWith("MII")) certB64 = once.replace(/\s+/g, "");
  } catch (_e) { /* already raw */ }
  const der = Uint8Array.from(atob(certB64), (ch) => ch.charCodeAt(0));

  // Minimal DER walk: Certificate → TBSCertificate → [serialNumber, issuer]
  function readTL(buf: Uint8Array, off: number): { tag: number; len: number; hl: number } {
    const tag = buf[off];
    let len = buf[off + 1], hl = 2;
    if (len & 0x80) {
      const n = len & 0x7f; len = 0;
      for (let i = 0; i < n; i++) len = (len << 8) | buf[off + 2 + i];
      hl = 2 + n;
    }
    return { tag, len, hl };
  }
  let off = 0;
  let t = readTL(der, off); off += t.hl;            // Certificate SEQ
  t = readTL(der, off);                              // TBS SEQ
  let tbsOff = off + t.hl;
  let p = tbsOff;
  let v = readTL(der, p);                            // version [0] or serial
  if (v.tag === 0xa0) { p += v.hl + v.len; v = readTL(der, p); }
  const serialBytes = der.slice(p + v.hl, p + v.hl + v.len);
  let serialDecimal = 0n;
  for (const byte of serialBytes) serialDecimal = (serialDecimal << 8n) | BigInt(byte);
  p += v.hl + v.len;
  v = readTL(der, p); p += v.hl + v.len;             // signature AlgorithmIdentifier
  // issuer Name
  const issOff = p; const issTl = readTL(der, p);
  const issuerDer = der.slice(issOff, issOff + issTl.hl + issTl.len);
  // Build the FULL issuer DN, RFC2253 style (RDNs reversed, joined ", ").
  // Sandbox certs are just CN=eInvoicing, but simulation/production issuers are
  // multi-RDN (CN=..., DC=..., ...) — the XAdES X509IssuerName must match what
  // ZATCA derives or the signed-properties check fails outside sandbox.
  let issuer = "CN=eInvoicing";
  try {
    const OIDS: Record<string, string> = {
      "2.5.4.3": "CN", "2.5.4.10": "O", "2.5.4.11": "OU", "2.5.4.6": "C",
      "2.5.4.7": "L", "2.5.4.8": "ST", "0.9.2342.19200300.100.1.25": "DC",
    };
    const oidStr = (b: Uint8Array): string => {
      if (!b.length) return "";
      const out: number[] = [Math.floor(b[0] / 40), b[0] % 40];
      let v = 0;
      for (let i = 1; i < b.length; i++) { v = (v << 7) | (b[i] & 0x7f); if (!(b[i] & 0x80)) { out.push(v); v = 0; } }
      return out.join(".");
    };
    const nameTl = readTL(issuerDer, 0);           // Name ::= SEQUENCE OF RDN
    const rdns: string[] = [];
    let q = nameTl.hl;
    while (q < nameTl.hl + nameTl.len) {
      const setTl = readTL(issuerDer, q);          // RDN ::= SET OF ATVA
      let r = q + setTl.hl;
      const parts: string[] = [];
      while (r < q + setTl.hl + setTl.len) {
        const seqTl = readTL(issuerDer, r);        // ATVA ::= SEQUENCE { OID, value }
        let a = r + seqTl.hl;
        const oidTl = readTL(issuerDer, a);
        const oid = oidStr(issuerDer.slice(a + oidTl.hl, a + oidTl.hl + oidTl.len));
        a += oidTl.hl + oidTl.len;
        const valTl = readTL(issuerDer, a);
        const val = new TextDecoder().decode(issuerDer.slice(a + valTl.hl, a + valTl.hl + valTl.len));
        const key = OIDS[oid];
        if (key) parts.push(key + "=" + val);
        r += seqTl.hl + seqTl.len;
      }
      if (parts.length) rdns.push(parts.join("+"));
      q += setTl.hl + setTl.len;
    }
    if (rdns.length) issuer = rdns.reverse().join(", ");
  } catch (_e) { /* keep fallback */ }
  return { certB64, derBytes: der, hash: sha256HexB64(certB64), issuer, serialDecimal: serialDecimal.toString() };
}

// ── XAdES signed properties + UBLExtensions injection ─────────────────────
const SIGNED_PROPS_TEMPLATE = (signingTime: string, certHash: string, issuer: string, serial: string) =>
`<xades:SignedProperties xmlns:xades="http://uri.etsi.org/01903/v1.3.2#" Id="xadesSignedProperties">
                                    <xades:SignedSignatureProperties>
                                        <xades:SigningTime>${signingTime}</xades:SigningTime>
                                        <xades:SigningCertificate>
                                            <xades:Cert>
                                                <xades:CertDigest>
                                                    <ds:DigestMethod xmlns:ds="http://www.w3.org/2000/09/xmldsig#" Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>
                                                    <ds:DigestValue xmlns:ds="http://www.w3.org/2000/09/xmldsig#">${certHash}</ds:DigestValue>
                                                </xades:CertDigest>
                                                <xades:IssuerSerial>
                                                    <ds:X509IssuerName xmlns:ds="http://www.w3.org/2000/09/xmldsig#">${issuer}</ds:X509IssuerName>
                                                    <ds:X509SerialNumber xmlns:ds="http://www.w3.org/2000/09/xmldsig#">${serial}</ds:X509SerialNumber>
                                                </xades:IssuerSerial>
                                            </xades:Cert>
                                        </xades:SigningCertificate>
                                    </xades:SignedSignatureProperties>
                                </xades:SignedProperties>`;

export interface SignResult { signedXml: string; invoiceHash: string; qr: string; }

export function signInvoice(xml: string, privKeyHex: string, cert: CertInfo, opts: {
  sellerName: string; sellerVat: string; issueDateTime: string; total: string; vat: string; isSimplified: boolean;
}): SignResult {
  const invoiceHash = computeInvoiceHash(xml);
  const hashBytes = Uint8Array.from(atob(invoiceHash), (c) => c.charCodeAt(0));
  const priv = hexToBytes(privKeyHex);
  const sig = secp256k1.sign(sha256(hashBytes), priv);
  const signatureB64 = b64(sig.toDERRawBytes());

  const signingTime = new Date().toISOString().slice(0, 19);
  const props = SIGNED_PROPS_TEMPLATE(signingTime, cert.hash, cert.issuer, cert.serialDecimal);
  const signedPropsHash = sha256HexB64(props);

  // QR TLV
  const pubKeyDer = (() => {
    const pub = secp256k1.getPublicKey(priv, false);
    return SEQ(SEQ(OID("1.2.840.10045.2.1"), OID("1.3.132.0.10")), BITSTR(pub));
  })();
  const tlvParts: Uint8Array[] = [];
  const tlv = (tag: number, val: Uint8Array) => { tlvParts.push(new Uint8Array([tag, val.length])); tlvParts.push(val); };
  tlv(1, te.encode(opts.sellerName));
  tlv(2, te.encode(opts.sellerVat));
  tlv(3, te.encode(opts.issueDateTime));
  tlv(4, te.encode(opts.total));
  tlv(5, te.encode(opts.vat));
  tlv(6, te.encode(invoiceHash));
  // Tag 7 must be the base64 signature STRING characters — ZATCA compares it
  // verbatim against ds:SignatureValue (raw DER bytes here = guaranteed
  // INVOICE_SIGNATURE_VALUE_QRCODE_INVALID).
  tlv(7, te.encode(signatureB64));
  tlv(8, pubKeyDer);
  if (opts.isSimplified) {
    // tag 9: the CA's signature over the cert (last BIT STRING of the certificate)
    const der = cert.derBytes;
    let lastBitstr: Uint8Array | null = null;
    for (let i = der.length - 80; i < der.length - 2 && i >= 0; i++) {
      if (der[i] === 0x03) {
        const len = der[i + 1];
        if (!(len & 0x80) && i + 2 + len === der.length) { lastBitstr = der.slice(i + 3, i + 2 + len); break; }
      }
    }
    if (lastBitstr) tlv(9, lastBitstr);
  }
  const qr = b64(concat(...tlvParts));

  const ublExt = `<ext:UBLExtensions>
        <ext:UBLExtension>
            <ext:ExtensionURI>urn:oasis:names:specification:ubl:dsig:enveloped:xades</ext:ExtensionURI>
            <ext:ExtensionContent>
                <sig:UBLDocumentSignatures xmlns:sig="urn:oasis:names:specification:ubl:schema:xsd:CommonSignatureComponents-2" xmlns:sac="urn:oasis:names:specification:ubl:schema:xsd:SignatureAggregateComponents-2" xmlns:sbc="urn:oasis:names:specification:ubl:schema:xsd:SignatureBasicComponents-2">
                    <sac:SignatureInformation>
                        <cbc:ID>urn:oasis:names:specification:ubl:signature:1</cbc:ID>
                        <sbc:ReferencedSignatureID>urn:oasis:names:specification:ubl:signature:Invoice</sbc:ReferencedSignatureID>
                        <ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#" Id="signature">
                            <ds:SignedInfo>
                                <ds:CanonicalizationMethod Algorithm="http://www.w3.org/2006/12/xml-c14n11"/>
                                <ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256"/>
                                <ds:Reference Id="invoiceSignedData" URI="">
                                    <ds:Transforms>
                                        <ds:Transform Algorithm="http://www.w3.org/TR/1999/REC-xpath-19991116">
                                            <ds:XPath>not(//ancestor-or-self::ext:UBLExtensions)</ds:XPath>
                                        </ds:Transform>
                                        <ds:Transform Algorithm="http://www.w3.org/TR/1999/REC-xpath-19991116">
                                            <ds:XPath>not(//ancestor-or-self::cac:Signature)</ds:XPath>
                                        </ds:Transform>
                                        <ds:Transform Algorithm="http://www.w3.org/TR/1999/REC-xpath-19991116">
                                            <ds:XPath>not(//ancestor-or-self::cac:AdditionalDocumentReference[cbc:ID='QR'])</ds:XPath>
                                        </ds:Transform>
                                        <ds:Transform Algorithm="http://www.w3.org/2006/12/xml-c14n11"/>
                                    </ds:Transforms>
                                    <ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>
                                    <ds:DigestValue>${invoiceHash}</ds:DigestValue>
                                </ds:Reference>
                                <ds:Reference Type="http://www.w3.org/2000/09/xmldsig#SignatureProperties" URI="#xadesSignedProperties">
                                    <ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>
                                    <ds:DigestValue>${signedPropsHash}</ds:DigestValue>
                                </ds:Reference>
                            </ds:SignedInfo>
                            <ds:SignatureValue>${signatureB64}</ds:SignatureValue>
                            <ds:KeyInfo>
                                <ds:X509Data>
                                    <ds:X509Certificate>${cert.certB64}</ds:X509Certificate>
                                </ds:X509Data>
                            </ds:KeyInfo>
                            <ds:Object>
                                <xades:QualifyingProperties xmlns:xades="http://uri.etsi.org/01903/v1.3.2#" Target="signature">
                                    ${props}
                                </xades:QualifyingProperties>
                            </ds:Object>
                        </ds:Signature>
                    </sac:SignatureInformation>
                </sig:UBLDocumentSignatures>
            </ext:ExtensionContent>
        </ext:UBLExtension>
    </ext:UBLExtensions>`;

  const qrRef = `<cac:AdditionalDocumentReference>
        <cbc:ID>QR</cbc:ID>
        <cac:Attachment>
            <cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${qr}</cbc:EmbeddedDocumentBinaryObject>
        </cac:Attachment>
    </cac:AdditionalDocumentReference>`;

  const signedXml = xml
    .replace("SET_UBL_EXTENSIONS_STRING", ublExt)
    .replace("    SET_QR_CODE_DATA", "    " + qrRef);
  return { signedXml, invoiceHash, qr };
}

// ── Submission APIs ────────────────────────────────────────────────────────
export async function zatcaComplianceInvoiceCheck(env: ZatcaEnvName, csid: string, secret: string, payload: { invoiceHash: string; uuid: string; invoice: string }) {
  const auth = "Basic " + btoa(`${csid}:${secret}`);
  return zatcaCall(env, "/compliance/invoices", { "Authorization": auth, "Accept-Version": "V2", "Accept-Language": "en" }, payload);
}
export async function zatcaClearInvoice(env: ZatcaEnvName, csid: string, secret: string, payload: { invoiceHash: string; uuid: string; invoice: string }) {
  const auth = "Basic " + btoa(`${csid}:${secret}`);
  return zatcaCall(env, "/invoices/clearance/single", { "Authorization": auth, "Accept-Version": "V2", "Accept-Language": "en", "Clearance-Status": "1" }, payload);
}
export async function zatcaReportInvoice(env: ZatcaEnvName, csid: string, secret: string, payload: { invoiceHash: string; uuid: string; invoice: string }) {
  const auth = "Basic " + btoa(`${csid}:${secret}`);
  return zatcaCall(env, "/invoices/reporting/single", { "Authorization": auth, "Accept-Version": "V2", "Accept-Language": "en", "Clearance-Status": "0" }, payload);
}
