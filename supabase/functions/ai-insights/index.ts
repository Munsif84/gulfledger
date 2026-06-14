// ═══════════════════════════════════════════════════════════════════════════
// GulfLedger · ai-insights  (Supabase Edge Function)
// ───────────────────────────────────────────────────────────────────────────
// POST { business_id, signals, lang? }
//   signals : DETERMINISTICALLY-computed facts from the client browser —
//             tax findings, cash-flow numbers, overdue invoices, VAT deadline.
//             The AI does NOT compute or detect; it prioritizes & phrases.
//
// Returns up to 3 insight cards for the dashboard Smart Insights panel:
//   { type, icon, title, body, action_label, action_url }
//   type ∈ info | warning | action | success
//
// Covers: tax savings · cash flow · overdue invoices · compliance reminders.
// Legal-only on tax; never fabricates numbers; concise, plain-language.
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

  let payload: { business_id?: string; signals?: Record<string, unknown>; lang?: string };
  try { payload = await req.json(); } catch { return json({ error: "invalid JSON" }, 400); }
  const { business_id, signals } = payload;
  if (!business_id || !signals) return json({ error: "business_id and signals required" }, 400);

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

  const sys = `You are a financial assistant for a Saudi small business owner with NO accountant.
From the SIGNALS provided (already computed from their real data), produce up to 3 dashboard insight cards — the most important, actionable things right now.
Reply in ${lang === "ar" ? "clear simple Arabic" : "clear simple English"} as STRICT JSON, no markdown.

Cover these areas, choosing the 3 most relevant:
- Tax savings (legal VAT recovery / missed deductions from tax_findings)
- Cash flow (receivables vs payables balance)
- Overdue invoices (money owed to them, past due)
- Compliance reminders (VAT filing deadline approaching)

RULES:
- The dashboard ALREADY shows these tiles: revenue, expenses, net profit, VAT payable, total receivables, total payables. NEVER produce an insight that merely restates one of these numbers — that is useless duplication. Each insight must tell the owner something to DO or a gap to FIX that the tiles do NOT show (e.g. unclaimed VAT, a specific overdue invoice to chase, a deadline approaching, receipts missing).
- Use ONLY numbers in the signals. Never invent or recompute. If a number is given, you may phrase it (round to whole SAR).
- An insight is only worth showing if it implies an ACTION. If a signal is just a balance with nothing to do, skip it.
- Tax suggestions = LEGAL optimization only (claiming entitled VAT, capturing deductions). Never suggest hiding revenue or fabricating expenses.
- Each card: a clear title, a one-sentence body with the concrete number, and an action link from the allowed list.
- Prioritize by urgency + money impact. A deadline within 14 days or a large overdue amount outranks a small saving.
- Be encouraging, not alarming. Concise.

Allowed action_url values (use the matching one, or omit):
- "finance.html" (expenses / tax savings)
- "invoices.html?filter=unpaid" (overdue / receivables)
- "finance.html?tab=bills" (payables)
- "accounting.html?sub=vat&filing=return" (VAT return)

Output JSON: { "insights": [ { "type": "info|warning|action|success", "icon": "<one emoji>", "title": string, "body": string, "action_label": string|null, "action_url": string|null } ] }
Return 1 to 3 insights, best first.`;

  const prompt = `Signals computed from the business's real data:
${JSON.stringify(signals, null, 2)}

Produce the dashboard insight cards.`;

  let aiResp: Response;
  try {
    aiResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1200,
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
  const text = (aiData.content ?? []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("\n");
  const clean = text.replace(/```json|```/g, "").trim();
  let parsed: { insights?: unknown[] };
  try { parsed = JSON.parse(clean); } catch { return json({ error: "ai_parse_failed", raw: clean.slice(0, 400) }, 502); }

  return json({ ok: true, insights: Array.isArray(parsed.insights) ? parsed.insights.slice(0, 3) : [] });
});
