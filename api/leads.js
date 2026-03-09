// api/leads.js — returns stored leads merged with contact/outcome data from KV

import { kv } from "../lib/kv.js";

const LEADS_KEY   = "leads:v1";
const CONTACT_PFX = "contact:";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=60");

  try {
    const raw = await kv.get(LEADS_KEY);
    if (!raw) {
      return res.status(200).json({ leads: [], subdivisions: [], generatedAt: null });
    }

    const { leads, subdivisions, generatedAt, activeStormZones } = JSON.parse(raw);

    // Merge contact status from KV
    const ids        = leads.map(l => CONTACT_PFX + l.id);
    const contacts   = ids.length ? await kv.mget(...ids) : [];
    const mergedLeads = leads.map((l, i) => {
      const c = contacts[i] ? JSON.parse(contacts[i]) : null;
      return c ? { ...l, contacted: c.contacted, outcome: c.outcome, notes: c.notes } : l;
    });

    return res.status(200).json({
      leads:        mergedLeads,
      subdivisions: subdivisions ?? [],
      generatedAt:  generatedAt ?? null,
      activeStormZones: activeStormZones ?? [],
    });
  } catch (err) {
    console.error("Leads error:", err);
    return res.status(500).json({ error: err.message });
  }
}
