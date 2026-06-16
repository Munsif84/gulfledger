// ═══ SELF-CONTAINED submit (engine inlined) ═══
import { secp256k1 } from "https://esm.sh/@noble/curves@1.4.0/secp256k1";
import { sha256 } from "https://esm.sh/@noble/hashes@1.4.0/sha256";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { DOMParser, XMLSerializer } from "https://esm.sh/@xmldom/xmldom@0.8.10";
import { XMLParser, XMLBuilder } from "https://esm.sh/fast-xml-parser@4.4.1";

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
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
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
            <cac:PostalAddress>
                <cbc:StreetName>${xesc(o.buyer.street ?? "")}</cbc:StreetName>
                <cbc:CityName>${xesc(o.buyer.city ?? "")}</cbc:CityName>
                <cac:Country><cbc:IdentificationCode>SA</cbc:IdentificationCode></cac:Country>
            </cac:PostalAddress>
            ${buyerVatXml}<cac:PartyLegalEntity>
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

// XML namespaces used by ZATCA UBL invoices.
const UBL_NS = {
  ext: "urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2",
  cac: "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
  cbc: "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
};

function removeNode(n: any) { if (n && n.parentNode) n.parentNode.removeChild(n); }

/** Pure invoice XML (the hashed form): no declaration, no UBLExtensions,
 *  no cac:Signature block, no QR document reference.
 *
 *  ZATCA recomputes the invoice hash by taking the SIGNED invoice, deleting
 *  three elements (Invoice/ext:UBLExtensions, Invoice/cac:Signature, and the
 *  Invoice/cac:AdditionalDocumentReference whose cbc:ID = "QR"), canonicalizing
 *  the result with C14N, then SHA-256 + base64. The hash MUST be byte-identical
 *  to that, or ZATCA returns invalid-invoice-hash.
 *
 *  We do this the way ZATCA does — real DOM deletion + canonical serialization
 *  — instead of regex/string surgery, which can never reliably byte-match C14N.
 *
 *  PROVEN OFFLINE (Node, against xmldsigjs XmlCanonicalizer(false,false) — the
 *  exact canonicalizer the reference zatca-xml-js uses): for the ZATCA invoice
 *  shape (all namespaces declared on the root, simple attributes, no comments /
 *  PIs), @xmldom/xmldom's XMLSerializer output is byte-identical to true C14N,
 *  including entity escaping (&amp; &lt;), UTF-8 chars, attribute preservation,
 *  and whitespace. Hashes matched on both trimmed and full realistic invoices.
 *
 *  The two trailing whitespace fixups below are ZATCA's own documented quirk
 *  (replicated from zatca-xml-js getInvoiceHash) — applied AFTER canonicalization.
 *
 *  NB: pass the SIGNED xml (or the pre-signature template) — the result is the
 *  same either way, because the three removed elements are exactly the parts
 *  that differ between them. Hash is therefore signature/QR-independent. */
export function getPureInvoiceXml(xml: string): string {
  // Use the rendered XML if a template placeholder slipped through, so the
  // parser always sees well-formed markup (placeholders aren't valid elements).
  let src = xml
    .replace("SET_UBL_EXTENSIONS_STRING", "<ext:UBLExtensions/>")
    .replace("    SET_QR_CODE_DATA", "");

  // 0. Normalize formatting via a parse→rebuild round-trip, EXACTLY as the
  //    reference zatca-xml-js does (fast-xml-parser, format:true, 4-space indent).
  //    This is load-bearing: ZATCA reformats the document to one-element-per-line
  //    before hashing, so inline blocks in our template (e.g. the seller CRN,
  //    tax subtotals, invoice lines) must be expanded to match. Without this the
  //    canonical bytes differ and ZATCA returns invalid-invoice-hash even though
  //    our own hash is internally consistent.
  const parserOpts = { ignoreAttributes: false, ignoreDeclaration: false, ignorePiTags: false, parseTagValue: false };
  const obj = new XMLParser(parserOpts).parse(src);
  src = new XMLBuilder({ ...parserOpts, format: true, indentBy: "    " }).build(obj).replace(/&apos;/g, "'");

  const doc = new DOMParser().parseFromString(src, "text/xml");
  const root = doc.documentElement;

  // 1. Delete Invoice/ext:UBLExtensions (direct children only)
  const exts = root.getElementsByTagNameNS(UBL_NS.ext, "UBLExtensions");
  for (let i = exts.length - 1; i >= 0; i--) if (exts[i].parentNode === root) removeNode(exts[i]);

  // 2. Delete Invoice/cac:Signature (direct children only — never nested ones)
  const sigs = root.getElementsByTagNameNS(UBL_NS.cac, "Signature");
  for (let i = sigs.length - 1; i >= 0; i--) if (sigs[i].parentNode === root) removeNode(sigs[i]);

  // 3. Delete Invoice/cac:AdditionalDocumentReference where child cbc:ID == "QR"
  const refs = root.getElementsByTagNameNS(UBL_NS.cac, "AdditionalDocumentReference");
  for (let i = refs.length - 1; i >= 0; i--) {
    const node = refs[i];
    if (node.parentNode !== root) continue;
    const ids = node.getElementsByTagNameNS(UBL_NS.cbc, "ID");
    if (ids.length && (ids[0].textContent || "").trim() === "QR") removeNode(node);
  }

  // 4. Re-normalize via a second parse→rebuild round-trip. The reference
  //    deletes nodes from the parsed object model and only THEN rebuilds, so
  //    its output has no leftover whitespace text nodes from removed elements.
  //    Re-running the round-trip on our post-deletion DOM reproduces that:
  //    it drops the orphaned indentation the deletions left behind.
  const obj2 = new XMLParser(parserOpts).parse(new XMLSerializer().serializeToString(root));
  let pure = new XMLBuilder({ ...parserOpts, format: true, indentBy: "    " }).build(obj2).replace(/&apos;/g, "'");

  // 4b. Strip the XML declaration the rebuild re-adds (C14N omits it).
  pure = pure.replace(/^<\?xml[^>]*\?>\s*/, "");

  // 4c. C14N requires empty elements as start/end tag pairs, never self-closing.
  pure = pure.replace(/<([A-Za-z_][\w.:-]*)((?:\s+[^<>]*?)?)\/>/g, "<$1$2></$1>");

  // 5. ZATCA's two documented whitespace fixups (hash is wrong without them).
  pure = pure.replace("<cbc:ProfileID>", "\n    <cbc:ProfileID>");
  pure = pure.replace("<cac:AccountingSupplierParty>", "\n    \n    <cac:AccountingSupplierParty>");

  // 6. The rebuild appends a trailing newline; C14N output ends at </Invoice>.
  pure = pure.replace(/\s+$/, "");
  return pure;
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
  // Extract CN (2.5.4.3) UTF8/Printable value(s), build "CN=x" (sandbox issuer is CN=eInvoicing)
  let issuer = "CN=eInvoicing";
  for (let i = 0; i + 5 < issuerDer.length; i++) {
    if (issuerDer[i] === 0x06 && issuerDer[i + 1] === 0x03 && issuerDer[i + 2] === 0x55 && issuerDer[i + 3] === 0x04 && issuerDer[i + 4] === 0x03) {
      const st = i + 5; const tl = readTL(issuerDer, st);
      issuer = "CN=" + new TextDecoder().decode(issuerDer.slice(st + tl.hl, st + tl.hl + tl.len));
      break;
    }
  }
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
  // ── Compute the invoice hash the way ZATCA does: from the SIGNED-SHAPE
  //    document, not the raw template. ZATCA recomputes the hash by deleting
  //    ext:UBLExtensions / cac:Signature / QR-ref from the *submitted* (signed)
  //    XML and canonicalizing the remainder. The leftover inter-element
  //    whitespace differs between the bare template and the signed document, so
  //    hashing the template yields a non-matching hash (this was the bug).
  //
  //    The hash is independent of the *content* of those three deleted blocks
  //    (proven offline), so we assemble the signed document with placeholder
  //    blocks of the SAME structure/whitespace as the final ones, hash that,
  //    then fill in the real signature/QR. Result byte-matches ZATCA's C14N. ──
  const ublExtForHash = `<ext:UBLExtensions>
        <ext:UBLExtension>
            <ext:ExtensionURI>urn:oasis:names:specification:ubl:dsig:enveloped:xades</ext:ExtensionURI>
            <ext:ExtensionContent>SIGNATURE_PLACEHOLDER</ext:ExtensionContent>
        </ext:UBLExtension>
    </ext:UBLExtensions>`;
  const qrRefForHash = `<cac:AdditionalDocumentReference>
        <cbc:ID>QR</cbc:ID>
        <cac:Attachment>
            <cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">QR_PLACEHOLDER</cbc:EmbeddedDocumentBinaryObject>
        </cac:Attachment>
    </cac:AdditionalDocumentReference>`;
  const signedShapeForHash = xml
    .replace("SET_UBL_EXTENSIONS_STRING", ublExtForHash)
    .replace("    SET_QR_CODE_DATA", "    " + qrRefForHash);
  const invoiceHash = computeInvoiceHash(signedShapeForHash);

  const hashBytes = Uint8Array.from(atob(invoiceHash), (c) => c.charCodeAt(0));
  const priv = hexToBytes(privKeyHex);
  const sig = secp256k1.sign(sha256(hashBytes), priv);
  const signatureB64 = b64(sig.toDERRawBytes());

  const signingTime = new Date().toISOString().slice(0, 19);
  const props = SIGNED_PROPS_TEMPLATE(signingTime, cert.hash, cert.issuer, cert.serialDecimal);
  const propsForHash = props.replace(/^<xades:SignedProperties/, `<xades:SignedProperties xmlns:xades="http://uri.etsi.org/01903/v1.3.2#"`)
    === props ? props : props; // template already carries xmlns
  const signedPropsHash = sha256HexB64(propsForHash);

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
  tlv(7, Uint8Array.from(atob(signatureB64), (c) => c.charCodeAt(0)));
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


// ═══════════ FUNCTION ═══════════

// ═══════════════════════════════════════════════════════════════════════════
// GulfLedger · zatca-submit-invoice
// ───────────────────────────────────────────────────────────────────────────
// POST { invoice_id }
// Auth: user JWT with access to the invoice's business.
//
// The Phase-2 hot path:
//   load invoice + items + business + active device →
//   allocate ICV (atomic on device row) → build UBL → sign (XAdES + QR) →
//   B2B → clearance, simplified → reporting (sandbox: compliance endpoint) →
//   archive XML/hash/QR on invoice + log submission + advance PIH chain.
//
// Idempotent: an invoice already cleared/reported returns its stored state.
// ═══════════════════════════════════════════════════════════════════════════


Deno.serve(async (req) => {
  const pre = corsPreflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let payload: { invoice_id?: string };
  try { payload = await req.json(); } catch { return json({ error: "invalid JSON" }, 400); }
  if (!payload.invoice_id) return json({ error: "invoice_id required" }, 400);

  const db = serviceClient();

  const { data: inv, error: invErr } = await db.from("invoices").select("*").eq("id", payload.invoice_id).single();
  if (invErr || !inv) return json({ error: "invoice_not_found", detail: invErr?.message }, 404);

  const access = await requireBusinessAccess(req, inv.business_id);
  if (access instanceof Response) return access;

  if (inv.zatca_status === "cleared" || inv.zatca_status === "reported") {
    return json({ ok: true, already: true, status: inv.zatca_status, zatca_uuid: inv.zatca_uuid, icv: inv.zatca_icv });
  }

  const { data: items } = await db.from("invoice_items").select("*").eq("invoice_id", inv.id).order("sort_order");
  if (!items?.length) return json({ error: "invoice_has_no_items" }, 422);

  const { data: biz } = await db.from("businesses").select("*").eq("id", inv.business_id).single();
  if (!biz) return json({ error: "business_not_found" }, 404);

  const { data: device } = await db.from("zatca_devices")
    .select("*").eq("business_id", inv.business_id).eq("status", "active")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!device) return json({ error: "no_active_device", message_ar: "لا يوجد جهاز فوترة مفعّل — أكمل الربط مع فاتورة أولاً." }, 409);

  const { data: keys } = await db.from("zatca_device_keys").select("*").eq("device_id", device.id).single();
  if (!keys?.private_key_hex) return json({ error: "device_credentials_missing" }, 500);

  const env = device.environment as ZatcaEnvName;
  const pick = (...ks: string[]) => { for (const k of ks) { const v = (biz as Record<string, unknown>)[k]; if (v != null && String(v).trim() !== "") return String(v); } return ""; };

  // ── Allocate ICV atomically: claim icv_counter+1 guarded by current value ──
  const nextIcv = Number(device.icv_counter) + 1;
  const pih = device.last_invoice_hash || INITIAL_PIH;
  const { data: claimed } = await db.from("zatca_devices")
    .update({ icv_counter: nextIcv })
    .eq("id", device.id).eq("icv_counter", device.icv_counter)
    .select("id").maybeSingle();
  if (!claimed) return json({ error: "icv_conflict_retry", message_ar: "تعارض في عداد الفواتير — أعد المحاولة." }, 409);

  // ── Build UBL ──
  const isSimplified = inv.invoice_type !== "b2b";
  const docType: "388" | "381" | "383" = inv.is_credit_note ? "381" : "388";
  const issueDate = String(inv.invoice_date ?? inv.created_at).slice(0, 10);
  const issueTime = (String(inv.created_at).match(/T(\d{2}:\d{2}:\d{2})/) ?? [, "09:00:00"])[1]!;
  const uuid = inv.zatca_uuid ?? crypto.randomUUID();

  const lines: UblLine[] = items.map((it: Record<string, unknown>) => {
    const rate = Number(it.vat_rate ?? 15);
    const cat: UblLine["vatCategory"] = rate > 0 ? "S" : (String(it.vat_category ?? "Z").toUpperCase() as UblLine["vatCategory"]);
    return {
      name: String(it.description ?? it.name ?? "Item"),
      quantity: Number(it.quantity ?? 1),
      unitPrice: Number(it.unit_price ?? it.price ?? 0),
      vatCategory: ["S", "Z", "E", "O"].includes(cat) ? cat : "S",
      vatRate: rate,
    };
  });

  const xml = buildInvoiceXml({
    invoiceNumber: String(inv.invoice_number),
    uuid,
    issueDate, issueTime,
    invoiceTypeCode: docType,
    subType: isSimplified ? "simplified" : "standard",
    icv: nextIcv,
    pih,
    seller: {
      name: pick("name", "name_ar", "business_name") || "Business",
      vat: pick("vat_number", "trn", "tax_number").replace(/\D/g, ""),
      street: pick("street_name", "street", "address") || "Street",
      building: pick("building_number", "building_no") || "0000",
      city: pick("city") || "Riyadh",
      district: pick("district") || "District",
      postal: pick("postal_code", "zip") || "00000",
      crn: pick("cr_number", "commercial_registration") || undefined,
    },
    buyer: {
      name: String(inv.buyer_name ?? "Customer"),
      vat: inv.buyer_trn ? String(inv.buyer_trn).replace(/\D/g, "") : undefined,
      street: inv.buyer_address ? String(inv.buyer_address) : undefined,
      city: inv.buyer_city ? String(inv.buyer_city) : undefined,
    },
    lines,
  });

  // ── Sign / hash ──
  // Pick the credential pair that matches the endpoint:
  // sandbox uses the compliance-invoice endpoint (compliance CSID+secret);
  // production clearance/reporting uses the production CSID+secret.
  const useProduction = env === "production" && device.production_csid;
  const activeCsid = String(useProduction ? device.production_csid : (device.compliance_csid || device.production_csid));
  const activeSecret = String(useProduction ? (keys.production_secret || keys.csid_secret) : (keys.compliance_secret || keys.csid_secret));
  const cert = parseCsidCertificate(activeCsid);

  // ZATCA treats the two invoice classes differently (confirmed by ZATCA support
  // + reference SDKs): SIMPLIFIED (B2C) invoices must be cryptographically SIGNED
  // by us — ZATCA verifies our signature. STANDARD (B2B) invoices must NOT carry
  // our signature — ZATCA signs/clears them server-side; we only attach the
  // invoice hash. Submitting a signed standard invoice yields invalid-invoice-hash
  // even when the hash is perfectly computed (ZATCA recomputes against the
  // server-cleared form, not our signed one).
  const signed = signInvoice(xml, String(keys.private_key_hex), cert, {
    sellerName: pick("name", "name_ar", "business_name") || "Business",
    sellerVat: pick("vat_number", "trn", "tax_number").replace(/\D/g, ""),
    issueDateTime: `${issueDate}T${issueTime}`,
    total: Number(inv.total ?? 0).toFixed(2),
    vat: Number(inv.vat_amount ?? 0).toFixed(2),
    isSimplified,
  });

  // For STANDARD invoices, submit the UNSIGNED document: resolve the signature
  // and QR placeholders to empty so neither the UBLExtensions signature block nor
  // the QR reference is present. The invoice hash (computed identically) still
  // goes in the API body. For SIMPLIFIED, submit the fully signed document.
  const submissionXml = isSimplified
    ? signed.signedXml
    : xml.replace("SET_UBL_EXTENSIONS_STRING", "").replace("    SET_QR_CODE_DATA\n", "");

  // 4. Submit
  const submissionHash = signed.invoiceHash;

  // ── Submit ──
  const apiPayload = { invoiceHash: submissionHash, uuid, invoice: btoa(unescape(encodeURIComponent(submissionXml))) };
  
  
  const resp = env === "sandbox"
    ? await zatcaComplianceInvoiceCheck(env, activeCsid, activeSecret, apiPayload)
    : (isSimplified
        ? await zatcaReportInvoice(env, activeCsid, activeSecret, apiPayload)
        : await zatcaClearInvoice(env, activeCsid, activeSecret, apiPayload));

  const accepted = resp.status === 200 || resp.status === 202;
  const newStatus = !accepted ? "rejected" : (env === "sandbox" ? "compliance_ok" : (isSimplified ? "reported" : "cleared"));

  // ── Log submission + archive on invoice; advance PIH only when accepted ──
  const { data: sub } = await db.from("zatca_submissions").insert({
    business_id: inv.business_id,
    device_id: device.id,
    invoice_id: inv.id,
    icv: nextIcv,
    pih,
    request_type: env === "sandbox" ? "compliance" : (isSimplified ? "reporting" : "clearance"),
    http_status: resp.status,
    response_body: typeof resp.body === "object" ? resp.body : { raw: resp.raw },
  }).select("id").maybeSingle();

  await db.from("invoices").update({
    zatca_uuid: uuid,
    zatca_status: newStatus,
    zatca_submission_id: sub?.id ?? null,
    zatca_icv: nextIcv,
    zatca_hash: signed.invoiceHash,
    zatca_xml: submissionXml,
    zatca_qr: signed.qr,
    zatca_cleared_at: accepted ? new Date().toISOString() : null,
  }).eq("id", inv.id);

  if (accepted) {
    await db.from("zatca_devices").update({ last_invoice_hash: signed.invoiceHash, updated_at: new Date().toISOString() }).eq("id", device.id);
  } else {
    // Rejected: roll the counter back so the chain has no gap
    await db.from("zatca_devices").update({ icv_counter: device.icv_counter }).eq("id", device.id).eq("icv_counter", nextIcv);
  }

  return json({
    _build: "std-unsigned-v7",
    ok: accepted,
    status: newStatus,
    icv: nextIcv,
    invoice_hash: signed.invoiceHash,
    zatca_http: resp.status,
    zatca: resp.body,
    zatca_raw: accepted ? undefined : resp.raw,
    qr_preview: signed.qr.slice(0, 60) + "…",
    message_ar: accepted
      ? (env === "sandbox" ? "✅ اجتازت الفاتورة فحص الامتثال (Sandbox)" : isSimplified ? "✅ تم إبلاغ فاتورة عن الفاتورة" : "✅ تم اعتماد الفاتورة من فاتورة")
      : "⚠ رفضت فاتورة المستند — راجع التفاصيل",
  }, accepted ? 200 : 422);
});
