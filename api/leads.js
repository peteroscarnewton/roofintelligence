// api/leads.js v5 — Phase 3c
// Merges contact status, outcome, notes, and history from KV into leads.

import { kv } from "@vercel/kv";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
  if (req.method !== "GET") return res.status(405).end();
  try {
    const data = await kv.get("leads");
    if (!data?.leads?.length) {
      return res.status(200).json({ generated: new Date().toISOString(), total:0, leads:[], note:"No leads yet. POST /api/scan to run first scan." });
    }
    const leads = data.leads;
    // Merge contact records (status + outcome + notes + history)
    try {
      for (let i = 0; i < leads.length; i += 100) {
        const chunk  = leads.slice(i, i+100);
        const values = await kv.mget(...chunk.map(l=>`contact:${l.id}`));
        values.forEach((v, j) => {
          if (v) {
            leads[i+j].contact    = v.contacted ?? false;
            leads[i+j].contactedAt = v.updatedAt ?? null;
            leads[i+j].outcome    = v.outcome  ?? null;
            leads[i+j].notes      = v.notes    ?? '';
            leads[i+j].history    = v.history  ?? [];
          }
        });
      }
    } catch(e) { /* non-fatal — return leads without contact state */ }
    return res.status(200).json({ ...data, leads });
  } catch(err) {
    return res.status(500).json({ error: err.message });
  }
}
