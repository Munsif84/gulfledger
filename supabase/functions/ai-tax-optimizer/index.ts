// ═══════════════════════════════════════════════════════════════════════════
// GulfLedger · ai-tax-optimizer  (Supabase Edge Function)
// ───────────────────────────────────────────────────────────────────────────
// POST { business_id, findings, totals, lang? }
//   findings : array of DETERMINISTICALLY-detected gaps from the client
//              (the app computes these from real data — the AI does NOT detect).
//   totals   : summary numbers for context (period recoverable VAT, expense count…)
//
// The AI turns the findings into a prioritized, plain-language action list with
// riyal impact — LEGAL OPTIMIZATION ONLY. It is hard-bounded: it must never
// suggest hiding revenue, fabricating expenses, or claiming blocked/ineligible
// VAT. Every item cites the basis and notes when to consult a specialist.
//
// Detection lives in the app (exact, cheap, auditable). The AI only narrates &
// prioritizes what was already found. This keeps it grounded and safe.
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

  let payload: { business_id?: string; findings?: unknown[]; totals?: Record<string, unknown>; lang?: string };
  try { payload = await req.json(); } catch { return json({ error: "invalid JSON" }, 400); }
  const { business_id, findings, totals } = payload;
  if (!business_id || !Array.isArray(findings)) return json({ error: "business_id and findings required" }, 400);

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

  // If there are no findings, no AI call needed.
  if (findings.length === 0) {
    return json({ ok: true, summary: payload.lang === "en" ? "No optimization gaps found — your records look complete for this period." : "لا توجد فجوات — سجلاتك تبدو مكتملة لهذه الفترة.", items: [] });
  }

  const lang = payload.lang === "en" ? "en" : "ar";

  const sys = `You are a Saudi tax optimization advisor for a small business owner who has NO accountant.
Reply in ${lang === "ar" ? "clear, simple Arabic" : "clear, simple English"} as STRICT JSON, no markdown.

Your job: turn the DETECTED findings into a prioritized action list that helps the owner LEGALLY pay less tax or recover money they are owed — the value an accountant sells.

HARD ETHICAL BOUNDARIES (never cross):
- LEGAL OPTIMIZATION ONLY: claiming input VAT they are entitled to, capturing deductible expenses they forgot to record, timing purchases, recovering VAT on bad debts after the qualifying period, fixing misclassifications.
- NEVER suggest: hiding or under-reporting revenue, fabricating or inflating expenses, claiming VAT on ZATCA-blocked items (private cars, entertainment, life insurance), backdating, or anything that misrepresents reality.
- If a finding is ambiguous, advise verifying the expense is genuine and business-related, and recommend a specialist for large or uncertain amounts.
- Be honest about risk. This PREPARES; the owner decides and files.

Input: an array of findings already detected from their real data. Each has a type, a description, and an estimated SAR impact. Do NOT invent findings or numbers beyond what's given; you may sum and prioritize.

Output JSON shape:
{
  "summary": string,              // one or two sentences: total opportunity in SAR + tone of encouragement
  "total_opportunity_sar": number,// sum of item impacts you consider solid
  "items": [
    {
      "title": string,            // short action, e.g. "Claim VAT on 6 unrecorded expenses"
      "impact_sar": number,       // estimated riyal benefit
      "action": string,           // what to do, concretely, in plain language
      "basis": string,            // why it's legal / the rule it rests on
      "confidence": "high"|"medium"|"low",
      "caution": string|null      // when to double-check or consult a specialist
    }
  ]
}
Order items by impact_sar descending. Keep each field tight.`;

  const prompt = `Findings detected from the business's real records:
${JSON.stringify({ findings, totals }, null, 2)}

Produce the optimization action list as specified.`;

  let aiResp: Response;
  try {
    aiResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1500,
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
  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(clean); } catch { return json({ error: "ai_parse_failed", raw: clean.slice(0, 400) }, 502); }

  return json({ ok: true, ...parsed });
});
