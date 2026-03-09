// api/canvass.js
// --------------
// GET /api/canvass?lat=42.95&lng=-71.51&radius=500&minScore=75&limit=20
//
// Returns up to `limit` leads sorted by score desc, then distance asc,
// within `radius` meters of the given coordinates.
// Skips subdivision cluster leads (they're area markers, not knockable doors).
// Skips already-contacted leads.
//
// Used by:
//   - "Start Canvassing" route builder (3a) — returns full list for route display
//   - "Next Best House" card mode (3b)     — returns top 1 via ?limit=1

import { kv } from "./kv.js";

const DEG_PER_METER_LAT = 1 / 111320;
const DEG_PER_METER_LNG = (lat) => 1 / (111320 * Math.cos(lat * Math.PI / 180));

function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 +
    Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function formatDistance(m) {
  if (m < 100)  return `${Math.round(m)}m`;
  if (m < 1000) return `${Math.round(m/10)*10}m`;
  return `${(m/1609.34).toFixed(1)} mi`;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method !== "GET") return res.status(405).json({ error:"GET only" });

  const lat       = parseFloat(req.query.lat);
  const lng       = parseFloat(req.query.lng);
  const radius    = Math.min(parseInt(req.query.radius   || "500"),  2000); // max 2km
  const minScore  = Math.max(parseInt(req.query.minScore || "70"),   40);
  const limit     = Math.min(parseInt(req.query.limit    || "20"),   40);
  const clusterId = req.query.cluster || null; // optional: filter to specific subdivision

  if (isNaN(lat) || isNaN(lng)) {
    return res.status(400).json({ error:"lat and lng required" });
  }

  // Load leads from KV
  let data;
  try { data = await kv.get("leads"); } catch(e) { return res.status(500).json({ error:e.message }); }
  if (!data?.leads?.length) return res.status(200).json({ route:[], total:0, note:"No leads yet" });

  // Load contact statuses
  const allLeads = data.leads;
  try {
    for (let i=0; i<allLeads.length; i+=100) {
      const chunk  = allLeads.slice(i, i+100);
      const values = await kv.mget(...chunk.map(l=>`contact:${l.id}`));
      values.forEach((v,j) => { if(v) { allLeads[i+j].contact=v.contacted??false; }});
    }
  } catch(e) { /* non-fatal */ }

  // Filter: individual homes only (not subdivision area markers), not contacted, score >= min
  let candidates = allLeads.filter(l => {
    if (l.contact) return false;                          // already knocked
    if (!l.lat || !l.lng) return false;                   // no coords
    if (l.score < minScore) return false;                 // below threshold
    if (l.id.startsWith("subdiv-")) return false;         // cluster marker, not a door
    if (clusterId && l.subdivisionId !== clusterId) return false; // cluster filter
    return true;
  });

  // Compute distance for each candidate
  candidates = candidates.map(l => ({
    ...l,
    _dist: distanceMeters(lat, lng, l.lat, l.lng),
  })).filter(l => l._dist <= radius);

  // Sort: score desc, then distance asc
  candidates.sort((a, b) => {
    const scoreDiff = b.score - a.score;
    if (Math.abs(scoreDiff) > 5) return scoreDiff; // prefer higher score
    return a._dist - b._dist;                       // then closer
  });

  const route = candidates.slice(0, limit).map((l, i) => ({
    stopNumber:   i + 1,
    id:           l.id,
    address:      l.address,
    city:         l.city,
    zip:          l.zip || "",
    lat:          l.lat,
    lng:          l.lng,
    score:        l.score,
    built:        l.built,
    reason:       l.reason,
    tenure:       l.tenure || 0,
    lastSale:     l.lastSale || 0,
    stormHit:     l.stormHit || false,
    inSubdivision:l.inSubdivision || false,
    tags:         l.tags || [],
    distanceM:    Math.round(l._dist),
    distanceLabel:formatDistance(l._dist),
    contact:      l.contact || false,
  }));

  return res.status(200).json({
    route,
    total:       route.length,
    searched:    candidates.length + allLeads.filter(l=>l.contact).length,
    centerLat:   lat,
    centerLng:   lng,
    radiusM:     radius,
    minScore,
    generatedAt: new Date().toISOString(),
  });
}
