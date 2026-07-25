// ═══════════════════════════════════════════════════════════════════════════
// GulfLedger · zatca-sweep — scheduled reporter for pending invoices
// ───────────────────────────────────────────────────────────────────────────
// WHY: simplified (B2C) invoices are legally valid the moment the customer
// receives them, but the SOFTWARE must report them to ZATCA within 24 hours.
// The in-app trigger only fires when someone opens the invoice page — a
// merchant issuing receipts all day may never do that. This function is the
// safety net: invoked by cron every few minutes, it finds pending invoices
// for businesses with an active ZATCA device and submits them.
//
// DESIGN CONSTRAINTS
//  • ZATCA chains invoices per device (PIH: each hash references the previous)
//    → submissions MUST be serial per business, oldest first. This sweep
//    processes everything serially with a per-run cap.
//  • Claim-before-submit: an invoice is atomically flipped pending→submitting
//    so the page-load trigger and overlapping cron runs never double-submit.
//    Stale 'submitting' rows (>10 min — a crashed run) are reclaimed.
//  • 'rejected' invoices are NOT auto-retried: rejection means ZATCA named a
//    data problem; retrying identical data burns quota. The invoice-view
//    trigger retries those when the user opens the invoice after fixing it.
//  • Auth: cron calls with the service-role key; anything else is refused.
// ═══════════════════════════════════════════════════════════════════════════
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CAP_PER_RUN = 20;          // stay well inside function time limits
const STALE_MINUTES = 10;        // reclaim 'submitting' older than this

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  // INTERNAL_KEY: the project's new-style secret key (sb_secret_...), set as a
  // function secret. Projects with legacy JWTs disabled reject the old
  // service-role JWT at the gateway, so cron authenticates with this instead.
  const internalKey = Deno.env.get("INTERNAL_KEY") ?? "";
  if (bearer !== serviceKey && !(internalKey && bearer === internalKey)) return json({ error: "unauthorized" }, 401);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey, { auth: { persistSession: false } });
  const submitUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/zatca-submit-invoice`;

  // Businesses that can actually submit (active device) — skip everyone else
  const { data: devices, error: devErr } = await db
    .from("zatca_devices").select("business_id, created_at").eq("status", "active");
  if (devErr) return json({ error: "devices_query_failed", detail: devErr.message }, 500);
  // Cutover rule: the Phase-2 obligation starts at ACTIVATION — invoices issued
  // before the device existed are legally out of scope and must not be
  // retro-submitted (late-reporting flags, chain pollution). Earliest active
  // device per business marks the line.
  const activatedAt = new Map<string, string>();
  for (const d of devices ?? []) {
    const prev = activatedAt.get(d.business_id);
    if (!prev || d.created_at < prev) activatedAt.set(d.business_id, d.created_at);
  }
  const bizIds = [...activatedAt.keys()];
  if (!bizIds.length) return json({ ok: true, swept: 0, note: "no active devices" });

  const staleBefore = new Date(Date.now() - STALE_MINUTES * 60_000).toISOString();
  const results: Array<{ invoice_id: string; ok: boolean; status?: string; error?: string }> = [];
  let budget = CAP_PER_RUN;

  for (const bizId of bizIds) {
    if (budget <= 0) break;

    // Oldest-first keeps the PIH chain sane and clears the 24h clock fairly.
    const { data: pending } = await db
      .from("invoices")
      .select("id, zatca_status, updated_at")
      .eq("business_id", bizId)
      .neq("status", "draft")
      .gte("created_at", activatedAt.get(bizId)!)
      .or(`zatca_status.eq.pending,and(zatca_status.eq.submitting,updated_at.lt.${staleBefore})`)
      .order("created_at", { ascending: true })
      .limit(budget);

    for (const row of pending ?? []) {
      if (budget <= 0) break;

      // Atomic claim: only proceed if WE flipped it (guards against the
      // page-load trigger and overlapping cron runs).
      const { data: claimed } = await db
        .from("invoices")
        .update({ zatca_status: "submitting", updated_at: new Date().toISOString() })
        .eq("id", row.id)
        .in("zatca_status", ["pending", "submitting"])
        .select("id");
      if (!claimed?.length) continue;

      budget--;
      try {
        const res = await fetch(submitUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${internalKey || serviceKey}` },
          body: JSON.stringify({ invoice_id: row.id }),
        });
        const out = await res.json().catch(() => ({}));
        results.push({ invoice_id: row.id, ok: !!out.ok, status: out.status ?? out.error });
        // On failure the submit function has already set rejected/failed on the
        // invoice; if it couldn't even run, un-stick our claim back to pending.
        if (!res.ok && out?.error) {
          await db.from("invoices").update({ zatca_status: "pending" }).eq("id", row.id).eq("zatca_status", "submitting");
        }
      } catch (e) {
        results.push({ invoice_id: row.id, ok: false, error: String(e) });
        await db.from("invoices").update({ zatca_status: "pending" }).eq("id", row.id).eq("zatca_status", "submitting");
      }
    }
  }

  console.log(`[zatca-sweep] processed ${results.length}:`, JSON.stringify(results));
  return json({ ok: true, swept: results.length, results });
});
