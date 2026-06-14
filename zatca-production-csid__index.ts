// ═══════════════════════════════════════════════════════════════════════════
// GulfLedger · zatca-production-csid
// supabase/functions/zatca-production-csid/index.ts
// ───────────────────────────────────────────────────────────────────────────
// POST { device_id }
// Auth: user JWT with access to the device's business.
//
// Exchanges the compliance CSID for a PRODUCTION CSID via
// POST /production/csids { compliance_request_id }.
//
// NOTE (simulation/production): ZATCA requires the compliance CHECKS
// (signed sample documents for every enabled invoice subtype) to pass
// BEFORE production CSID issuance. Sandbox is lenient. The checks runner
// ships in Sprint 2 with the signer (it needs XML signing). The function
// surfaces ZATCA's error verbatim if checks are still pending.
// ═══════════════════════════════════════════════════════════════════════════

import {
  zatcaProductionCsid, serviceClient, requireBusinessAccess, json, corsPreflight,
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
  const { data: device, error: devErr } = await db
    .from("zatca_devices")
    .select("id, business_id, environment, status, compliance_csid")
    .eq("id", payload.device_id)
    .single();
  if (devErr || !device) return json({ error: "device not found" }, 404);

  const access = await requireBusinessAccess(req, device.business_id);
  if (access instanceof Response) return access;

  if (device.status === "active") return json({ ok: true, status: "active", note: "already issued" });
  if (device.status !== "compliance") return json({ error: "device_not_in_compliance_stage", status: device.status }, 409);

  const { data: keys, error: keyErr } = await db
    .from("zatca_device_keys")
    .select("csid_secret, compliance_secret, compliance_request_id")
    .eq("device_id", device.id)
    .single();
  if (keyErr || !keys?.csid_secret || !keys?.compliance_request_id) {
    return json({ error: "device_credentials_missing" }, 500);
  }

  const resp = await zatcaProductionCsid(
    device.environment as ZatcaEnvName,
    device.compliance_csid,
    keys.compliance_secret || keys.csid_secret,
    keys.compliance_request_id,
  );
  if (!resp.ok) {
    return json({
      error: "zatca_production_failed",
      status: resp.status,
      zatca: resp.body,
      message_ar: "تعذر إصدار شهادة الإنتاج — في بيئة المحاكاة/الإنتاج يجب اجتياز فحوصات الامتثال أولاً (Sprint 2).",
    }, 502);
  }

  const prodCsid = resp.body.binarySecurityToken as string;
  const prodSecret = resp.body.secret as string;
  if (!prodCsid || !prodSecret) return json({ error: "zatca_response_incomplete", zatca: resp.body }, 502);

  const { error: upErr } = await db.from("zatca_devices").update({
    production_csid: prodCsid,
    status: "active",
    updated_at: new Date().toISOString(),
  }).eq("id", device.id);
  if (upErr) return json({ error: "db_update_failed", detail: upErr.message }, 500);

  const { error: ksErr } = await db.from("zatca_device_keys").update({
    csid_secret: prodSecret,
    production_secret: prodSecret,
    updated_at: new Date().toISOString(),
  }).eq("device_id", device.id);
  if (ksErr) return json({ error: "db_secret_failed", detail: ksErr.message }, 500);

  return json({
    ok: true,
    device_id: device.id,
    status: "active",
    message_ar: "✅ تم تفعيل الفوترة الإلكترونية — الجهاز جاهز لاعتماد الفواتير.",
  });
});
