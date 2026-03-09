// lib/scanner-noaa.js — fetches active NOAA storm alerts for NH + MA
// Returns array of polygon coordinates for storm zones.

const STATES   = ["NH", "MA"];
const BASE_URL = "https://api.weather.gov/alerts/active";
const HEADERS  = { "User-Agent": "RoofIntelligence/1.0 (contact@roofintelligence.app)" };

export async function scanNOAA() {
  const zones = [];

  for (const state of STATES) {
    try {
      const r = await fetch(`${BASE_URL}?area=${state}`, {
        headers: HEADERS,
        signal:  AbortSignal.timeout(8000),
      });
      if (!r.ok) continue;

      const data     = await r.json();
      const features = data?.features ?? [];

      for (const f of features) {
        const event = f.properties?.event ?? "";
        const isStorm = /hail|wind|thunder|tornado|storm/i.test(event);
        if (!isStorm) continue;

        const geom = f.geometry;
        if (!geom) continue;

        const polys = geom.type === "Polygon"      ? [geom.coordinates[0]]
                    : geom.type === "MultiPolygon" ? geom.coordinates.map(c => c[0])
                    : [];

        zones.push(...polys);
      }
    } catch (e) {
      console.warn(`  NOAA ${state} failed: ${e.message}`);
    }
  }

  console.log(`  NOAA: ${zones.length} active storm zones`);
  return zones;
}
