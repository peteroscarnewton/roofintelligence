// api/contact.js v2 — Phase 3c
// Persists contact status + outcome for a lead.
// POST body: { id, contacted, outcome? }
// outcome values: "no_answer" | "not_interested" | "quote_given" | "job_sold" | null
// 90-day TTL on all records.

import { kv } from "@vercel/kv";

const VALID_OUTCOMES = new Set(["no_answer","not_interested","quote_given","job_sold"]);
const TTL = 60 * 60 * 24 * 90; // 90 days

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error:"POST only" });

  const { id, contacted, outcome, notes } = req.body || {};
  if (!id) return res.status(400).json({ error:"id required" });

  const key = `contact:${id}`;
  const now = new Date().toISOString();

  // Load existing record to preserve history
  let existing = {};
  try { existing = (await kv.get(key)) || {}; } catch(e) { /* fresh record */ }

  const record = {
    id,
    contacted: contacted ?? existing.contacted ?? false,
    outcome:   (outcome && VALID_OUTCOMES.has(outcome)) ? outcome : (existing.outcome || null),
    notes:     notes !== undefined ? notes : (existing.notes || ""),
    updatedAt: now,
    createdAt: existing.createdAt || now,
    // History: append each outcome change
    history: [
      ...(existing.history || []),
      ...(outcome && outcome !== existing.outcome ? [{
        outcome,
        notes: notes || "",
        timestamp: now,
      }] : []),
    ].slice(-10), // keep last 10 interactions
  };

  try {
    await kv.set(key, record, { ex: TTL });
    return res.status(200).json({ ok:true, record });
  } catch(err) {
    return res.status(500).json({ error: err.message });
  }
}
