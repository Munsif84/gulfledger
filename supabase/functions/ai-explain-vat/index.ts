// ═══════════════════════════════════════════════════════════════════════════
// GulfLedger · ai-explain-vat  (Supabase Edge Function)
// ───────────────────────────────────────────────────────────────────────────
// POST { business_id, report, question?, box? }
//   report : the EXACT computed VAT report object from the app (form201 + sales
//            + purchases + period). The AI explains THIS — it never recomputes.
//   box    : optional box id the user tapped ("box1","box6","net"…)
//   question: optional free-text ("لماذا الرقم؟")
//
// Returns a plain-Arabic (or English) explanation that traces each figure to
// its components and source documents. The AI is instructed to use ONLY the
// numbers provided and to flag anything that doesn't reconcile — never to
// invent or "correct" figures.
//
// Secret: ANTHROPIC_API_KEY
// ═══════════════════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let payload: { business_id?: string; report?: Record<string, unknown>; question?: string; box?: string; lang?: string };
  try { payload = await req.json(); } catch { return json({ error: "invalid JSON" }, 400); }
  const { business_id, report } = payload;
  if (!business_id || !report) return json({ error: "business_id and report required" }, 400);

  // Auth
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!jwt) return json({ error: "unauthorized" }, 401);
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: `Bearer ${jwt}` } } },
  );
  const { data: { user }, error: authErr } = await userClient.auth.getUser(jwt);
  if (authErr || !user) return json({ error: "unauthorized" }, 401);
  const probe = await userClient.from("businesses").select("id").eq("id", business_id).maybeSingle();
  if (probe.error || !probe.data) return json({ error: "forbidden" }, 403);

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ error: "ai_not_configured", message_ar: "لم يتم إعداد مفتاح الذكاء الاصطناعي بعد." }, 500);

  const lang = payload.lang === "en" ? "en" : "ar";

  // Trim source docs to essentials to keep tokens lean (the AI needs counts +
  // a few examples, not every line).
  const r = report as Record<string, any>;
  const slim = {
    period: r.period,
    form201: r.form201,
    sales_summary: { standardNet: r.sales?.standardNet, standardVAT: r.sales?.standardVAT, zeroRated: r.sales?.zeroRated, exempt: r.sales?.exempt, returnsNet: r.sales?.returnsNet, count: r.sales?.count },
    purchases_summary: { recoverableNet: r.purchases?.recoverableNet, recoverableVAT: r.purchases?.recoverableVAT, blockedNet: r.purchases?.blockedNet, count: r.purchases?.count },
    reconciliation: r.glReconciliation,
    sample_invoices: (r.sales?.invoices || []).slice(0, 8).map((i: any) => ({ no: i.invoice_number, date: i.invoice_date || i.created_at, total: i.total, vat: i.vat_amount, type: i.vat_treatment || i.invoice_type })),
    sample_expenses: (r.purchases?.expenses || []).slice(0, 8).map((e: any) => ({ vendor: e.vendor_name || e.description, date: e.expense_date, amount: e.amount, vat: e.vat_amount, recoverable: e.vat_recoverable })),
  };

  const focus = payload.box
    ? `The user tapped on: ${payload.box}. Focus the explanation there first.`
    : payload.question
      ? `The user asks: "${payload.question}"`
      : `Give a short overall explanation of how this return was computed.`;

  const sys = `You are a Saudi VAT advisor explaining a VAT return (ZATCA Form 201) to a NON-ACCOUNTANT business owner.
Reply in ${lang === "ar" ? "clear simple Arabic" : "clear simple English"}.

ABSOLUTE RULES:
- Use ONLY the numbers in the JSON provided. NEVER invent, recompute, or "correct" a figure.
- If something does not reconcile (e.g. box1InternallyConsistent is false), SAY SO plainly and tell them to review — do not paper over it.
- Explain WHERE each number comes from: which box, what it sums, and that it traces to their invoices/expenses.
- Form 201 basics you may reference: Box 1 = standard-rated sales (15%), Box 2 = zero-rated, Box 4 = exempt, Box 6 = standard-rated purchases (recoverable input VAT), Box 14 = net VAT due (output − input). Net VAT due = Box 5 VAT (output) − Box 6 VAT (input).
- Be concrete and brief. Use the actual SAR figures. No accounting jargon unless you immediately explain it.
- End with one short line on what they should check before filing, if anything looks off.
- Never give a definitive legal guarantee; this prepares, the human files.`;

  const prompt = `${focus}

VAT return data (authoritative — explain only these numbers):
${JSON.stringify(slim, null, 2)}`;

  let aiResp: Response;
  try {
    aiResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 900,
        system: sys,
        messages: [{ role: "user", content: prompt }],
      }),
    });
  } catch (e) {
    return json({ error: "ai_unreachable", detail: String(e) }, 502);
  }
  if (!aiResp.ok) {
    const t = await aiResp.text().catch(() => "");
    return json({ error: "ai_error", status: aiResp.status, detail: t.slice(0, 400) }, 502);
  }
  const aiData = await aiResp.json();
  const text = (aiData.content ?? []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("\n").trim();
  return json({ ok: true, explanation: text });
});
