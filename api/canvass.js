// api/canvass.js — returns ordered canvassing stops near a location
// GET /api/canvass?lat=42.95&lng=-71.51&radius=500&minScore=75&limit=20

import { kv } from "../lib/kv.js";

const LEADS_KEY   = "leads:v1";
const CONTACT_PFX = "contact:";
const DEG_PER_M   = 1 / 111320;

function distMeters(lat1, lng1, lat2, lng2) {
  const dlat = (lat2 - lat1) * 111320;
  const dlng = (lng2 - lng1) * 111320 * Math.cos((lat1 * Math.PI) / 180);
  return Math.sqrt(dlat * dlat + dlng * dlng);
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const lat      = parseFloat(req.query.lat ?? "0");
  const lng      = parseFloat(req.query.lng ?? "0");
  const radius   = parseInt(req.query.radius   ?? "800");
  const minScore = parseInt(req.query.minScore ?? "60");
  const limit    = parseInt(req.query.limit    ?? "20");

  if (!lat || !lng) {
    return res.status(400).json({ error: "lat and lng required" });
  }

  try {
    const raw = await kv.get(LEADS_KEY);
    if (!raw) return res.status(200).json({ stops: [] });

    const { leads } = JSON.parse(raw);

    // Filter by radius + minScore + not already sold
    const nearby = leads.filter(l => {
      if (l.score < minScore)   return false;
      if (l.outcome === "job_sold") return false;
      const dist = distMeters(lat, lng, l.lat, l.lng);
      return dist <= radius;
    });

    // Sort: score desc, then distance asc
    nearby.sort((a, b) => {
      const ds = b.score - a.score;
      if (ds !== 0) return ds;
      return distMeters(lat, lng, a.lat, a.lng) - distMeters(lat, lng, b.lat, b.lng);
    });

    const stops = nearby.slice(0, limit);

    // Merge contact status
    const contactKeys = stops.map(s => CONTACT_PFX + s.id);
    const contacts    = contactKeys.length ? await kv.mget(...contactKeys) : [];
    const merged = stops.map((s, i) => {
      const c = contacts[i] ? JSON.parse(contacts[i]) : null;
      return {
        ...s,
        distMeters: Math.round(distMeters(lat, lng, s.lat, s.lng)),
        ...(c ? { contacted: c.contacted, outcome: c.outcome, notes: c.notes } : {}),
      };
    });

    return res.status(200).json({ stops: merged });
  } catch (err) {
    console.error("Canvass error:", err);
    return res.status(500).json({ error: err.message });
  }
}
