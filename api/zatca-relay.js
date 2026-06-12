// ═══════════════════════════════════════════════════════════════════════════
// GulfLedger · ZATCA relay  ·  /api/zatca-relay.js  (Vercel serverless)
// ───────────────────────────────────────────────────────────────────────────
// WHY THIS EXISTS: ZATCA's gateway sits behind Cloudflare bot protection,
// which JS-challenges requests from the IP ranges Supabase Edge Functions
// use. This relay re-originates those calls from the GulfLedger Vercel
// deployment. It is NOT an open proxy:
//   • only forwards to gw-fatoora.zatca.gov.sa (hard whitelist)
//   • requires a shared secret known only to the Edge Functions
//   • POST only, JSON only, response passed back verbatim
//
// SETUP (one time):
//   1. Upload this file to the repo at:  api/zatca-relay.js   (new "api" folder)
//   2. Vercel dashboard → Project → Settings → Environment Variables →
//        add  ZATCA_RELAY_SECRET  = a long random string (40+ chars)
//      → Redeploy the project (Deployments → ⋯ → Redeploy)
//   3. Supabase dashboard → Edge Functions → Secrets → add BOTH:
//        ZATCA_RELAY_URL    = https://gulfledger.vercel.app/api/zatca-relay
//        ZATCA_RELAY_SECRET = (the same random string)
// ═══════════════════════════════════════════════════════════════════════════

const ZATCA_HOST = "https://gw-fatoora.zatca.gov.sa";
const ALLOWED_HEADERS = ["otp", "authorization", "accept-version", "accept-language", "content-type", "accept"];

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST only" });
    return;
  }
  const secret = process.env.ZATCA_RELAY_SECRET || "";
  if (!secret || req.headers["x-relay-secret"] !== secret) {
    res.status(401).json({ error: "relay_unauthorized" });
    return;
  }

  let payload;
  try {
    payload = typeof req.body === "object" && req.body !== null ? req.body : JSON.parse(req.body || "{}");
  } catch {
    res.status(400).json({ error: "invalid_json" });
    return;
  }

  const path = String(payload.path || "");
  // Whitelist: must be a ZATCA e-invoicing path, no host smuggling, no traversal
  if (!path.startsWith("/e-invoicing/") || path.includes("..") || path.includes("//")) {
    res.status(400).json({ error: "path_not_allowed", path });
    return;
  }

  const fwdHeaders = { };
  for (const [k, v] of Object.entries(payload.headers || {})) {
    if (ALLOWED_HEADERS.includes(String(k).toLowerCase())) fwdHeaders[k] = String(v);
  }
  fwdHeaders["Content-Type"] = "application/json";
  fwdHeaders["Accept"] = "application/json";

  try {
    const upstream = await fetch(ZATCA_HOST + path, {
      method: "POST",
      headers: fwdHeaders,
      body: JSON.stringify(payload.body || {}),
    });
    const raw = await upstream.text();
    res.status(200).json({
      upstream_status: upstream.status,
      raw: raw.slice(0, 4000),
      server: upstream.headers.get("server") || "",
    });
  } catch (e) {
    res.status(502).json({ error: "relay_fetch_failed", detail: String(e) });
  }
};

