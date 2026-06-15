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

import {
  buildInvoiceXml, signInvoice, parseCsidCertificate, computeInvoiceHash,
  INITIAL_PIH, zatcaComplianceInvoiceCheck, zatcaClearInvoice, zatcaReportInvoice,
  serviceClient, requireBusinessAccess, json, corsPreflight,
  type ZatcaEnvName, type UblLine,
} from "../_shared/zatca.ts";

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

  // ── Sign ──
  // Pick the credential pair that matches the endpoint:
  // sandbox uses the compliance-invoice endpoint (compliance CSID+secret);
  // production clearance/reporting uses the production CSID+secret.
  const useProduction = env === "production" && device.production_csid;
  const activeCsid = String(useProduction ? device.production_csid : (device.compliance_csid || device.production_csid));
  const activeSecret = String(useProduction ? (keys.production_secret || keys.csid_secret) : (keys.compliance_secret || keys.csid_secret));
  const cert = parseCsidCertificate(activeCsid);
  const signed = signInvoice(xml, String(keys.private_key_hex), cert, {
    sellerName: pick("name", "name_ar", "business_name") || "Business",
    sellerVat: pick("vat_number", "trn", "tax_number").replace(/\D/g, ""),
    issueDateTime: `${issueDate}T${issueTime}`,
    total: Number(inv.total ?? 0).toFixed(2),
    vat: Number(inv.vat_amount ?? 0).toFixed(2),
    isSimplified,
  });

  // ── Submit ──
  const apiPayload = { invoiceHash: signed.invoiceHash, uuid, invoice: btoa(unescape(encodeURIComponent(signed.signedXml))) };
  
  
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
    zatca_xml: signed.signedXml,
    zatca_qr: signed.qr,
    zatca_cleared_at: accepted ? new Date().toISOString() : null,
  }).eq("id", inv.id);

  if (accepted) {
    await db.from("zatca_devices").update({ last_invoice_hash: signed.invoiceHash,
    _build: "c14n-hash-v2", updated_at: new Date().toISOString() }).eq("id", device.id);
  } else {
    // Rejected: roll the counter back so the chain has no gap
    await db.from("zatca_devices").update({ icv_counter: device.icv_counter }).eq("id", device.id).eq("icv_counter", nextIcv);
  }

  return json({
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
