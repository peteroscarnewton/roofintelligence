// api/contact.js — persists contact status + outcome for a lead
// POST body: { id, contacted, outcome?, notes? }
// outcome values: "no_answer" | "not_interested" | "quote_given" | "job_sold" | null

import { kv } from "../lib/kv.js";

const CONTACT_PFX = "contact:";
const TTL_SECS    = 60 * 60 * 24 * 90; // 90 days

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")    return res.status(405).end();

  try {
    const { id, contacted, outcome, notes } = req.body ?? {};
    if (!id) return res.status(400).json({ error: "id required" });

    const record = {
      id,
      contacted: !!contacted,
      outcome:   outcome ?? null,
      notes:     notes   ?? "",
      updatedAt: new Date().toISOString(),
    };

    await kv.set(CONTACT_PFX + id, JSON.stringify(record), { ex: TTL_SECS });
    return res.status(200).json({ ok: true, record });
  } catch (err) {
    console.error("Contact error:", err);
    return res.status(500).json({ error: err.message });
  }
}
