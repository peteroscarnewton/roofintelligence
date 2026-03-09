// api/scan.js — orchestrates all scanners, deduplicates, stores results in KV
// GET /api/scan  — run a full scan (also called by daily cron)

import { kv }          from "../lib/kv.js";
import { scanNOAA }    from "../lib/scanner-noaa.js";
import { scanRegrid }  from "../lib/scanner-regrid.js";

const LEADS_KEY = "leads:v1";
const TTL_SECS  = 60 * 60 * 24 * 7; // 7 days

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const start = Date.now();
  console.log("Scan started");

  try {
    // ── 1. NOAA storm zones ───────────────────────────────────
    console.log("[1/2] NOAA storm zones...");
    const activeStormZones = await scanNOAA();

    // ── 2. Regrid parcel scan ─────────────────────────────────
    console.log("[2/2] Regrid parcel scan...");
    const { parcels, subdivisions } = await scanRegrid({ activeStormZones });

    // ── 3. Deduplicate by address ─────────────────────────────
    const seen  = new Set();
    const leads = [];
    for (const p of parcels) {
      const key = (p.address + p.zip).toLowerCase().replace(/\s/g, "");
      if (!seen.has(key)) {
        seen.add(key);
        leads.push(p);
      }
    }

    // ── 4. Store in KV ────────────────────────────────────────
    const payload = {
      leads,
      subdivisions,
      generatedAt:  new Date().toISOString(),
      activeStormZones,
    };
    await kv.set(LEADS_KEY, JSON.stringify(payload), { ex: TTL_SECS });

    const duration = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`Scan complete: ${leads.length} leads, ${subdivisions.length} subdivisions in ${duration}s`);

    return res.status(200).json({
      ok:      true,
      count:   leads.length,
      sources: {
        noaa:          activeStormZones.length,
        subdivisions:  subdivisions.length,
        regrid:        parcels.length,
      },
      subdivisionHomesTotal: subdivisions.reduce((s, c) => s + c.homeCount, 0),
      activeStormZones:      activeStormZones.length,
      generated:             payload.generatedAt,
      durationSeconds:       parseFloat(duration),
    });
  } catch (err) {
    console.error("Scan error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
