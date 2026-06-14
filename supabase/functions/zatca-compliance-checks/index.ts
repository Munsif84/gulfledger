// ═══════════════════════════════════════════════════════════════════════════
// GulfLedger · zatca-compliance-checks
// ───────────────────────────────────────────────────────────────────────────
// POST { device_id }
// Runs ZATCA's pre-production qualification: signed sample documents for
// every type the device declared (title 1100 → standard + simplified,
// invoice + credit + debit = 6 documents) against /compliance/invoices
// using the COMPLIANCE CSID. All-pass → device.compliance_checks_passed.
//
// Required before production CSID issuance in simulation/production.
// Samples use the business's real identity but synthetic line data and a
// dedicated ICV/PIH chain starting at the initial hash (compliance chain
// is independent of the production chain).
// ═══════════════════════════════════════════════════════════════════════════

import {
  buildInvoiceXml, signInvoice, parseCsidCertificate, INITIAL_PIH,
  zatcaComplianceInvoiceCheck, serviceClient, requireBusinessAccess, json, corsPreflight,
  type ZatcaEnvName,
} from "../_shared/zatca.ts";

Deno.serve(async (req) => {
  const pre = corsPreflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let payload: { device_id?: string };
  try { payload = await req.json(); } catch { return json({ error: "invalid JSON" }, 400); }
  if (!payload.device_id) return json({ error: "device_id required" }, 400);

  const db = serviceClient();
  const { data: device } = await db.from("zatca_devices").select("*").eq("id", payload.device_id).single();
  if (!device) return json({ error: "device_not_found" }, 404);

  const access = await requireBusinessAccess(req, device.business_id);
  if (access instanceof Response) return access;

  const { data: keys } = await db.from("zatca_device_keys").select("*").eq("device_id", device.id).single();
  if (!keys?.private_key_hex || !keys?.csid_secret) return json({ error: "device_credentials_missing" }, 500);

  const { data: biz } = await db.from("businesses").select("*").eq("id", device.business_id).single();
  const pick = (...ks: string[]) => { for (const k of ks) { const v = (biz as Record<string, unknown>)[k]; if (v != null && String(v).trim() !== "") return String(v); } return ""; };

  const env = device.environment as ZatcaEnvName;
  // Sandbox onboarding substitutes the fixture identity into the CSR;
  // compliance samples must carry the SAME VAT the certificate was issued to.
  const vat = env === "sandbox" ? "399999999900003" : pick("vat_number", "trn", "tax_number").replace(/\D/g, "");
  const sellerName = pick("name", "name_ar", "business_name") || "Business";
  const seller = {
    name: sellerName, vat,
    street: pick("street_name", "street", "address") || "Street",
    building: pick("building_number", "building_no") || "0000",
    city: pick("city") || "Riyadh",
    district: pick("district") || "District",
    postal: pick("postal_code", "zip") || "00000",
  };
  const cert = parseCsidCertificate(String(device.compliance_csid));
  const today = new Date().toISOString().slice(0, 10);

  const docs: Array<{ label: string; sub: "standard" | "simplified"; code: "388" | "381" | "383" }> = [
    { label: "standard-invoice",   sub: "standard",   code: "388" },
    { label: "standard-credit",    sub: "standard",   code: "381" },
    { label: "standard-debit",     sub: "standard",   code: "383" },
    { label: "simplified-invoice", sub: "simplified", code: "388" },
    { label: "simplified-credit",  sub: "simplified", code: "381" },
    { label: "simplified-debit",   sub: "simplified", code: "383" },
  ];

  let pih = INITIAL_PIH;
  const results: Array<{ doc: string; status: number; ok: boolean; detail?: unknown }> = [];
  let icv = 0;

  for (const d of docs) {
    icv += 1;
    const uuid = crypto.randomUUID();
    const xml = buildInvoiceXml({
      invoiceNumber: `CHK-${d.label}-${icv}`,
      uuid, issueDate: today, issueTime: "09:30:00",
      invoiceTypeCode: d.code, subType: d.sub, icv, pih,
      seller,
      buyer: d.sub === "standard"
        ? { name: "Sample Buyer Co", vat: "399999999800003", street: "Olaya St", city: "Riyadh" }
        : { name: "Walk-in Customer" },
      lines: [{ name: "Compliance check item", quantity: 1, unitPrice: 100, vatCategory: "S", vatRate: 15 }],
      billingReferenceId: d.code !== "388" ? `CHK-ref-${icv}` : undefined,
      note: d.code !== "388" ? "Compliance check correction" : undefined,
    });
    const signed = signInvoice(xml, String(keys.private_key_hex), cert, {
      sellerName, sellerVat: vat, issueDateTime: `${today}T09:30:00`,
      total: "115.00", vat: "15.00", isSimplified: d.sub === "simplified",
    });
    const resp = await zatcaComplianceInvoiceCheck(env, String(device.compliance_csid), String(keys.csid_secret), {
      invoiceHash: signed.invoiceHash, uuid,
      invoice: btoa(unescape(encodeURIComponent(signed.signedXml))),
    });
    const ok = resp.status === 200 || resp.status === 202;
    results.push({ doc: d.label, status: resp.status, ok, detail: ok ? undefined : (resp.body && Object.keys(resp.body as object).length ? resp.body : resp.raw) });
    if (ok) pih = signed.invoiceHash; // chain advances only on acceptance
    else break;                        // stop at first failure for clear diagnosis
  }

  const allOk = results.length === docs.length && results.every((r) => r.ok);
  if (allOk) {
    await db.from("zatca_devices").update({ compliance_checks_passed: true, updated_at: new Date().toISOString() }).eq("id", device.id);
  }

  return json({
    ok: allOk,
    passed: results.filter((r) => r.ok).length,
    total: docs.length,
    results,
    message_ar: allOk
      ? "✅ اجتاز الجهاز جميع فحوصات الامتثال — يمكن الآن إصدار شهادة الإنتاج."
      : "⚠ توقفت الفحوصات عند أول مستند مرفوض — التفاصيل في النتائج.",
  }, allOk ? 200 : 422);
});
