// ═══════════════════════════════════════════════════════════════════════════
// GulfLedger · ai-scan-receipt  (Supabase Edge Function)
// ───────────────────────────────────────────────────────────────────────────
// POST { business_id, image_base64, media_type }   (image: jpeg/png/webp/pdf)
// Auth: user JWT with access to the business.
//
// Sends the receipt to Claude (vision) with the GulfLedger SOCPA expense
// categories + ZATCA VAT-recoverability rules, and returns STRUCTURED data the
// expense form drops straight in. The model NEVER decides recoverability on its
// own beyond the documented rule per category — it extracts facts and proposes
// a category; the app applies the rule and the human confirms.
//
// Secret required (Supabase Edge Function secret): ANTHROPIC_API_KEY
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

// The categories the model must choose from (code + when to use it).
const CATEGORY_GUIDE = `
rent: commercial/residential rent
salaries: salaries, wages, payroll
utilities: electricity, water
communications: phone, internet, mobile, telecom (e.g. STC, Mobily, Zain)
supplies: office supplies, stationery, printing
professional: accounting, legal, consulting, audit fees
marketing: advertising, ads, social media, design, printing of marketing
vehicle: fuel, petrol, car maintenance, vehicle rental
travel: flights, hotels for business travel, taxi, transport
maintenance: repairs, maintenance of equipment/premises
insurance: insurance premiums
bank_charges: bank fees, transfer charges, POS fees
gov_fees: government fees, Zakat, GOSI, fines, municipality
entertainment: restaurants, cafes, hospitality, events (usually VAT-blocked)
other: anything that does not clearly fit above`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let payload: { business_id?: string; image_base64?: string; media_type?: string };
  try { payload = await req.json(); } catch { return json({ error: "invalid JSON" }, 400); }
  const { business_id, image_base64, media_type } = payload;
  if (!business_id || !image_base64 || !media_type) {
    return json({ error: "business_id, image_base64, media_type required" }, 400);
  }

  // ── Auth: verify user + business access ──
  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
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

  const isPdf = media_type === "application/pdf";
  const sourceBlock = isPdf
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: image_base64 } }
    : { type: "image", source: { type: "base64", media_type, data: image_base64 } };

  const prompt = `You are a Saudi accounting assistant reading a purchase receipt or invoice for VAT bookkeeping.
Extract the data and respond with ONLY a JSON object, no other text, no markdown fences.

Categories to choose from (use the code exactly):${CATEGORY_GUIDE}

JSON shape:
{
  "vendor_name": string,            // merchant/supplier name as printed
  "vendor_trn": string|null,        // 15-digit VAT/tax number if present
  "date": "YYYY-MM-DD"|null,        // invoice/receipt date
  "invoice_number": string|null,    // the document number if present
  "currency": string,               // e.g. "SAR"
  "total": number|null,             // grand total incl VAT
  "vat_amount": number|null,        // VAT shown; null if none shown
  "subtotal": number|null,          // amount excl VAT
  "category": string,               // one category code from the list
  "confidence": "high"|"medium"|"low",
  "language": "ar"|"en",
  "notes": string|null              // anything ambiguous a human should check
}

Rules:
- Read Arabic and English receipts. Amounts may use Arabic-Indic digits — convert to Western.
- If VAT is shown as 15%, ensure subtotal + vat_amount ≈ total.
- If only the total is visible and VAT is implied at 15%, set vat_amount and subtotal by back-calculation and note it.
- Never invent a TRN. If unsure, use null and lower the confidence.
- Pick the single best category code; if genuinely unclear use "other".`;

  let aiResp: Response;
  try {
    aiResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        messages: [{ role: "user", content: [sourceBlock, { type: "text", text: prompt }] }],
      }),
    });
  } catch (e) {
    return json({ error: "ai_unreachable", detail: String(e) }, 502);
  }

  if (!aiResp.ok) {
    const errText = await aiResp.text().catch(() => "");
    return json({ error: "ai_error", status: aiResp.status, detail: errText.slice(0, 400) }, 502);
  }

  const aiData = await aiResp.json();
  const text = (aiData.content ?? []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("\n");
  const clean = text.replace(/```json|```/g, "").trim();

  let extracted: Record<string, unknown>;
  try {
    extracted = JSON.parse(clean);
  } catch {
    return json({ error: "ai_parse_failed", raw: clean.slice(0, 400) }, 502);
  }

  return json({ ok: true, extracted });
});
