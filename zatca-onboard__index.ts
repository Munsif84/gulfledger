// ═══════════════════════════════════════════════════════════════════════════
// GulfLedger · zatca-onboard
// supabase/functions/zatca-onboard/index.ts
// ───────────────────────────────────────────────────────────────────────────
// POST { business_id, otp, environment? = "sandbox", device_name? = "EGS-1" }
// Auth: user JWT (must have access to the business).
//
// Flow:
//   1. verify caller → load business (TRN, names, address, industry)
//   2. generate secp256k1 keypair (server-side only)
//   3. build ZATCA-profile CSR
//   4. POST /compliance with OTP → compliance CSID + secret + requestID
//   5. persist: device row (client-visible state) + key row (service-only)
//
// Returns device id + status. Private key and secret are NEVER returned.
// ═══════════════════════════════════════════════════════════════════════════

import {
  buildZatcaCsr, generateKeypairHex, zatcaComplianceCsid,
  serviceClient, requireBusinessAccess, json, corsPreflight,
  type ZatcaEnvName, type CsrFields,
} from "../_shared/zatca.ts";

Deno.serve(async (req) => {
  const pre = corsPreflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let payload: { business_id?: string; otp?: string; environment?: ZatcaEnvName; device_name?: string };
  try { payload = await req.json(); } catch { return json({ error: "invalid JSON" }, 400); }

  const businessId = payload.business_id;
  const otp = (payload.otp ?? "").trim();
  const env: ZatcaEnvName = payload.environment ?? "sandbox";
  const deviceName = payload.device_name ?? "EGS-1";
  if (!businessId || !otp) return json({ error: "business_id and otp are required" }, 400);

  const access = await requireBusinessAccess(req, businessId);
  if (access instanceof Response) return access;

  const db = serviceClient();

  // ── Load business compliance identity (v3: column-agnostic) ──
  const { data: biz, error: bizErr } = await db
    .from("businesses")
    .select("*")
    .eq("id", businessId)
    .single();
  if (bizErr || !biz) {
    return json({ error: "business_not_found", detail: bizErr?.message ?? null, business_id: businessId }, 404);
  }

  // Field names vary across schema generations — read every known candidate.
  const pick = (...keys: string[]) => {
    for (const k of keys) { const v = (biz as Record<string, unknown>)[k]; if (v != null && String(v).trim() !== "") return String(v); }
    return "";
  };
  const vatRaw = pick("vat_number", "trn", "tax_number", "vat_registration_number");
  const vat = vatRaw.replace(/\D/g, "");
  if (!/^3\d{13}3$/.test(vat) && !/^\d{15}$/.test(vat)) {
    return json({
      error: "vat_number_invalid",
      message_ar: "رقم التسجيل الضريبي غير صالح — يجب أن يكون 15 رقماً. أكمله في الإعدادات ← الضرائب والامتثال أولاً.",
    }, 422);
  }

  // ── Idempotency: refuse double-onboarding of an active device ──
  const { data: existing } = await db
    .from("zatca_devices")
    .select("id, status")
    .eq("business_id", businessId)
    .eq("environment", env)
    .eq("device_name", deviceName)
    .maybeSingle();
  if (existing && ["compliance", "active"].includes(existing.status)) {
    return json({ error: "device_exists", device_id: existing.id, status: existing.status }, 409);
  }

  // ── Keys + CSR ──
  const { privHex } = generateKeypairHex();
  const fields: CsrFields = {
    commonName: `GulfLedger|${deviceName}|${businessId.slice(0, 8)}`,
    orgName: pick("name", "name_ar", "business_name", "name_en") || "Business",
    orgUnit: pick("name_en", "name", "business_name") || "Main",
    egsSerial: `1-GulfLedger|2-WebEGS|3-${crypto.randomUUID()}`,
    vatNumber: vat,
    invoiceTypes: "1100", // standard + simplified
    address: [pick("building_number","building_no"), pick("street_name","street","address"), pick("district"), pick("city")]
      .filter(Boolean).join(", ") || "Riyadh",
    businessCategory: pick("business_type", "industry", "specific_business_type") || "Other",
  };

  // SANDBOX RULE (per ZATCA community/moderators): the developer-portal
  // validates against the fixed dummy identity — real TRNs are rejected with
  // a generic "Invalid Request". Simulation/production use the real identity.
  if (env === "sandbox") {
    fields.vatNumber = "399999999900003";
    fields.commonName = "TST-886431145-399999999900003";
  }

  let csr;
  try { csr = buildZatcaCsr(privHex, fields, env); }
  catch (e) { return json({ error: "csr_build_failed", detail: String(e) }, 500); }

  // ── Compliance CSID ──
  const resp = await zatcaComplianceCsid(env, csr.csrB64, otp);
  if (!resp.ok) {
    return json({
      error: "zatca_compliance_failed",
      status: resp.status,
      zatca: resp.body,
      zatca_raw: (resp as { raw?: string }).raw ?? "",
      zatca_server: (resp as { server?: string }).server ?? "",
      message_ar: resp.status === 400
        ? "رفضت فاتورة الطلب — تحقق من رمز OTP (صلاحيته دقائق فقط) ومن بيانات المنشأة."
        : "تعذر الاتصال بفاتورة — حاول مرة أخرى.",
    }, 502);
  }

  const csid = resp.body.binarySecurityToken as string;
  const secret = resp.body.secret as string;
  const requestId = String(resp.body.requestID ?? "");
  if (!csid || !secret) return json({ error: "zatca_response_incomplete", zatca: resp.body }, 502);

  // ── Persist (device row first, then service-only key row) ──
  const deviceRow = {
    business_id: businessId,
    environment: env,
    device_name: deviceName,
    status: "compliance",
    csr_pem: csr.csrPem,
    compliance_csid: csid,
    updated_at: new Date().toISOString(),
  };
  const { data: device, error: devErr } = existing
    ? await db.from("zatca_devices").update(deviceRow).eq("id", existing.id).select().single()
    : await db.from("zatca_devices").insert(deviceRow).select().single();
  if (devErr || !device) return json({ error: "db_device_failed", detail: devErr?.message }, 500);

  const { error: keyErr } = await db.from("zatca_device_keys").upsert({
    device_id: device.id,
    private_key_hex: privHex,
    csid_secret: secret,
    compliance_secret: secret,
    compliance_request_id: requestId,
    updated_at: new Date().toISOString(),
  });
  if (keyErr) {
    // Roll back the device row so the system never holds a device without its key
    await db.from("zatca_devices").delete().eq("id", device.id);
    return json({ error: "db_key_failed", detail: keyErr.message }, 500);
  }

  return json({
    ok: true,
    device_id: device.id,
    environment: env,
    status: "compliance",
    next_ar: "تم إصدار شهادة الامتثال. الخطوة التالية: اجتياز فحوصات الامتثال ثم إصدار شهادة الإنتاج.",
    next_step: "compliance-checks → zatca-production-csid",
    _build: "r58-compliance-secret",
  });
});
