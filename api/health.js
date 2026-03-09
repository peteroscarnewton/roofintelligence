// api/health.js — returns system status
// GET /api/health

import { kv } from "../lib/kv.js";

const LEADS_KEY = "leads:v1";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=30");

  try {
    const raw  = await kv.get(LEADS_KEY);
    const data = raw ? JSON.parse(raw) : null;

    const hasToken = !!process.env.REGRID_API_TOKEN;
    const leadCount = data?.leads?.length ?? 0;
    const lastScan  = data?.generatedAt   ?? null;
    const ok        = hasToken && leadCount > 0;

    return res.status(200).json({
      overall:    ok ? "ok" : (hasToken ? "no_data" : "missing_token"),
      leadCount,
      lastScan,
      hasRegridToken: hasToken,
      checkedAt:  new Date().toISOString(),
    });
  } catch (err) {
    return res.status(200).json({
      overall:   "error",
      error:     err.message,
      checkedAt: new Date().toISOString(),
    });
  }
}
