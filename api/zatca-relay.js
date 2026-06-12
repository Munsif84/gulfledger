// ═══════════════════════════════════════════════════════════════════════════
// GulfLedger · ZATCA relay v2 · /api/zatca-relay.js (Vercel, ESM)
// Locked forwarder: only gw-fatoora.zatca.gov.sa, only with the shared secret.
// ═══════════════════════════════════════════════════════════════════════════

const ZATCA_HOST = "https://gw-fatoora.zatca.gov.sa";
const ALLOWED_HEADERS = ["otp", "authorization", "accept-version", "accept-language", "content-type", "accept"];

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "POST only" });
    }
    const secret = process.env.ZATCA_RELAY_SECRET || "";
    const given = req.headers["x-relay-secret"] || "";
    if (!secret || given !== secret) {
      return res.status(401).json({ error: "relay_unauthorized" });
    }

    let payload = req.body;
    if (typeof payload === "string") {
      try { payload = JSON.parse(payload); } catch { payload = null; }
    }
    if (!payload || typeof payload !== "object") {
      return res.status(400).json({ error: "invalid_json" });
    }

    const path = String(payload.path || "");
    if (!path.startsWith("/e-invoicing/") || path.includes("..") || path.includes("//")) {
      return res.status(400).json({ error: "path_not_allowed", path });
    }

    const fwdHeaders = {};
    for (const [k, v] of Object.entries(payload.headers || {})) {
      if (ALLOWED_HEADERS.includes(String(k).toLowerCase())) fwdHeaders[k] = String(v);
    }
    fwdHeaders["Content-Type"] = "application/json";
    fwdHeaders["Accept"] = "application/json";

    const upstream = await fetch(ZATCA_HOST + path, {
      method: "POST",
      headers: fwdHeaders,
      body: JSON.stringify(payload.body || {}),
    });
    const raw = await upstream.text();
    return res.status(200).json({
      upstream_status: upstream.status,
      raw: raw.slice(0, 4000),
      server: upstream.headers.get("server") || "",
    });
  } catch (e) {
    return res.status(500).json({ error: "relay_crashed", detail: String(e && e.message || e) });
  }
}
