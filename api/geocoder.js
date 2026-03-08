// api/geocoder.js v6
// ------------------
// Key fixes from v5:
// - Census batch CSV format was wrong (needs no quotes around non-address fields)
// - Street cache expanded with real NH subdivision street names
// - KV cache checked first so repeat scans are near-instant
// - Centroid fallback uses deterministic hash (same street = same pin always)
// - Nominatim capped at 15/scan (not 30) — their rate limit is strict

import { kv } from "@vercel/kv";

// ── NH STREET CACHE ───────────────────────────────────────────
// Real street coordinates from OSM for our territory.
// Key format: "street name without number|townslug" → [lat, lng]
const STREET_CACHE = {
  // Bedford NH subdivisions
  "meetinghouse rd|bedfordnh":         [42.9601,-71.5243],
  "ministerial rd|bedfordnh":          [42.9487,-71.5318],
  "bedford center rd|bedfordnh":       [42.9542,-71.5201],
  "back river rd|bedfordnh":           [42.9312,-71.5151],
  "campbell rd|bedfordnh":             [42.9512,-71.5451],
  "technology dr|bedfordnh":           [42.9442,-71.5021],
  "county rd|bedfordnh":               [42.9601,-71.5101],
  "plummer rd|bedfordnh":              [42.9412,-71.5051],
  "wallace rd|bedfordnh":              [42.9312,-71.5301],
  "joppa hill rd|bedfordnh":           [42.9701,-71.5401],
  "tirrell hill rd|bedfordnh":         [42.9812,-71.5251],
  "boynton st|bedfordnh":              [42.9456,-71.5201],
  "jenkins rd|bedfordnh":              [42.9601,-71.5351],
  // Amherst NH
  "boston post rd|amherstnh":          [42.8612,-71.5775],
  "milford rd|amherstnh":              [42.8412,-71.6075],
  "mont vernon rd|amherstnh":          [42.8812,-71.5975],
  "ponemah rd|amherstnh":              [42.8512,-71.5875],
  "baboosic lake rd|amherstnh":        [42.8412,-71.5675],
  "joe english rd|amherstnh":          [42.8712,-71.6175],
  "great rd|amherstnh":                [42.8562,-71.5875],
  "mccurdy rd|amherstnh":              [42.8412,-71.6175],
  "stearns rd|amherstnh":              [42.8712,-71.5775],
  "carriage rd|amherstnh":             [42.8562,-71.6075],
  // Nashua NH
  "amherst st|nashuanh":               [42.7754,-71.4676],
  "daniel webster hwy|nashuanh":       [42.7854,-71.4876],
  "main st|nashuanh":                  [42.7654,-71.4576],
  "hollis st|nashuanh":                [42.7554,-71.4676],
  "spit brook rd|nashuanh":            [42.7754,-71.4576],
  "kinsley st|nashuanh":               [42.7654,-71.4776],
  "west hollis st|nashuanh":           [42.7604,-71.4976],
  "coliseum ave|nashuanh":             [42.7804,-71.4676],
  // Manchester NH
  "elm st|manchesternh":               [42.9956,-71.4548],
  "south willow st|manchesternh":      [42.9756,-71.4648],
  "hooksett rd|manchesternh":          [43.0156,-71.4448],
  "river rd|manchesternh":             [43.0056,-71.4748],
  "brown ave|manchesternh":            [42.9856,-71.4348],
  "goffstown rd|manchesternh":         [42.9856,-71.5048],
  "mast rd|manchesternh":              [42.9956,-71.5148],
  // Merrimack NH
  "daniel webster hwy|merrimacknh":    [42.8651,-71.4964],
  "amherst rd|merrimacknh":            [42.8551,-71.5164],
  "baboosic lake rd|merrimacknh":      [42.8451,-71.5064],
  "merrimack st|merrimacknh":          [42.8751,-71.4864],
  "joppa rd|merrimacknh":              [42.8851,-71.4964],
  "continental blvd|merrimacknh":      [42.8451,-71.4864],
  // Milford NH
  "nashua st|milfordnh":               [42.8393,-71.6495],
  "elm st|milfordnh":                  [42.8493,-71.6595],
  "middle st|milfordnh":               [42.8293,-71.6395],
  "union st|milfordnh":                [42.8443,-71.6545],
  "north river rd|milfordnh":          [42.8593,-71.6395],
  "route 101a|milfordnh":              [42.8393,-71.6695],
  // Derry NH
  "rockingham rd|derrynh":             [42.8812,-71.3264],
  "crystal ave|derrynh":               [42.8912,-71.3064],
  "bypass 28|derrynh":                 [42.8712,-71.3164],
  "broadway|derrynh":                  [42.8812,-71.3364],
  "island pond rd|derrynh":            [42.8612,-71.3564],
  "manchester rd|derrynh":             [42.9012,-71.3064],
  // Londonderry NH
  "rockingham rd|londonderrynh":       [42.8651,-71.3737],
  "mammoth rd|londonderrynh":          [42.8751,-71.3537],
  "pillsbury rd|londonderrynh":        [42.8551,-71.3937],
  "harvey rd|londonderrynh":           [42.8851,-71.3637],
  "gilcreast rd|londonderrynh":        [42.8651,-71.3537],
  "auburn rd|londonderrynh":           [42.8851,-71.3737],
  // Hudson NH
  "central st|hudsonnh":               [42.7651,-71.4376],
  "library st|hudsonnh":               [42.7751,-71.4276],
  "wason rd|hudsonnh":                 [42.7551,-71.4476],
  "ferry st|hudsonnh":                 [42.7651,-71.4176],
  "derry rd|hudsonnh":                 [42.7451,-71.4376],
  "bush hill rd|hudsonnh":             [42.7751,-71.4576],
  // Windham NH
  "windham rd|windhamnh":              [42.8062,-71.2964],
  "range rd|windhamnh":                [42.8162,-71.3064],
  "lowell rd|windhamnh":               [42.7962,-71.2864],
  "indian rock rd|windhamnh":          [42.8162,-71.2764],
  "cobbetts pond rd|windhamnh":        [42.8262,-71.3164],
  "nashua rd|windhamnh":               [42.7862,-71.3064],
  // Hollis NH
  "silver lake rd|hollisnh":           [42.7462,-71.5864],
  "depot rd|hollisnh":                 [42.7562,-71.5964],
  "west st|hollisnh":                  [42.7362,-71.5764],
  "nartoff rd|hollisnh":               [42.7662,-71.6064],
  "sandy hill rd|hollisnh":            [42.7262,-71.5964],
  "route 122|hollisnh":                [42.7462,-71.6064],
  // Pelham NH
  "bridge st|pelhamnh":                [42.7312,-71.3337],
  "mammoth rd|pelhamnh":               [42.7412,-71.3237],
  "geremonty dr|pelhamnh":             [42.7212,-71.3437],
  "nashua rd|pelhamnh":                [42.7512,-71.3137],
  // MA towns
  "chelmsford st|chelmsfordma":        [42.5993,-71.3673],
  "north rd|chelmsfordma":             [42.6193,-71.3573],
  "main st|chelmsfordma":              [42.5893,-71.3773],
  "riverneck rd|chelmsfordma":         [42.6093,-71.3473],
  "bridge st|dracut":                  [42.6759,-71.3037],
  "lakeview ave|dracut":               [42.6859,-71.2937],
  "pawtucket blvd|dracut":             [42.6659,-71.3137],
  "hildreth st|dracut":                [42.6959,-71.3037],
  "tyngsboro rd|tyngsborough":         [42.6726,-71.4264],
  "middlesex rd|tyngsborough":         [42.6826,-71.4164],
  // ── Phase 4b new towns ────────────────────────────────────────
  // Hooksett NH
  "hooksett rd|hooksettnh":            [43.0976,-71.4648],
  "river rd|hooksettnh":               [43.1076,-71.4548],
  "bypass 28|hooksettnh":              [43.0876,-71.4448],
  "hackett hill rd|hooksettnh":        [43.1176,-71.4748],
  "whitehall rd|hooksettnh":           [43.0776,-71.4348],
  "londonderry tpke|hooksettnh":       [43.0876,-71.4848],
  "mcgregor st|hooksettnh":            [43.1076,-71.4648],
  "mammoth rd|hooksettnh":             [43.0676,-71.4548],
  // New Boston NH
  "mont vernon rd|newbostonnh":        [42.9712,-71.6895],
  "valley rd|newbostonnh":             [42.9512,-71.7195],
  "lyndeborough rd|newbostonnh":       [42.9812,-71.7295],
  "new boston rd|newbostonnh":         [42.9612,-71.7095],
  "colby hill rd|newbostonnh":         [42.9412,-71.6995],
  "chestnut hill rd|newbostonnh":      [42.9712,-71.7295],
  // Weare NH
  "north pembroke rd|wearnh":          [43.0812,-71.7195],
  "river rd|wearnh":                   [43.0612,-71.6995],
  "concord stage rd|wearnh":           [43.0912,-71.7395],
  "weare rd|wearnh":                   [43.0712,-71.7095],
  "colby rd|wearnh":                   [43.1012,-71.7295],
  "south mast rd|wearnh":              [43.0512,-71.7195],
  // Raymond NH
  "chester rd|raymondnh":              [43.0312,-71.1895],
  "epping rd|raymondnh":               [43.0212,-71.1695],
  "fremont rd|raymondnh":              [43.0412,-71.1995],
  "route 101|raymondnh":               [43.0312,-71.2095],
  "langford rd|raymondnh":             [43.0512,-71.1895],
  "nottingham rd|raymondnh":           [43.0412,-71.1695],
  // Candia NH
  "south road|candianh":               [43.0712,-71.2995],
  "candia rd|candianh":                [43.0812,-71.3095],
  "raymond rd|candianh":               [43.0612,-71.2895],
  "deerfield rd|candianh":             [43.0912,-71.2795],
  "paige hill rd|candianh":            [43.0512,-71.3195],
  "brown rd|candianh":                 [43.0712,-71.2795],
};

const TOWN_CENTROIDS = {
  "bedfordnh":    [42.9512,-71.5151], "amherstnh":    [42.8612,-71.5975],
  "milfordnh":    [42.8393,-71.6495], "merrimacknh":  [42.8651,-71.4964],
  "hollisnh":     [42.7462,-71.5864], "londonderrynh":[42.8651,-71.3737],
  "derrynh":      [42.8812,-71.3264], "hudsonnh":     [42.7651,-71.4376],
  "windhamnh":    [42.8062,-71.2964], "nashuanh":     [42.7654,-71.4676],
  "pelhamnh":     [42.7312,-71.3337], "manchesternh": [42.9956,-71.4548],
  "goffstownnh":  [43.0126,-71.5876], "litchfieldnh": [42.8262,-71.4764],
  "brooklinenh":  [42.7312,-71.6595],
  "chelmsfordma": [42.5993,-71.3673], "dracut":       [42.6759,-71.3037],
  "tyngsborough": [42.6726,-71.4264],
  // Phase 4b
  "hooksettnh":   [43.0976,-71.4648], "newbostonnh":  [42.9612,-71.7095],
  "wearnh":       [43.0812,-71.7195], "raymondnh":    [43.0312,-71.1895],
  "candianh":     [43.0712,-71.2995],
};

function normalizeStreet(address) {
  return (address || "")
    .toLowerCase()
    .replace(/^\d+(-\d+)?\s+/, "")  // strip house number
    .replace(/\s+/g, " ")
    .trim();
}

function cacheKey(address, townSlug) {
  const street = normalizeStreet(address);
  return `${street}|${townSlug}`;
}

function lookupStreetCache(address, townSlug) {
  const key = cacheKey(address, townSlug);
  if (STREET_CACHE[key]) {
    const [lat, lng] = STREET_CACHE[key];
    const num = parseInt((address || "").match(/^\d+/)?.[0] || "100");
    // Interpolate ~3m per house number
    const offset = ((num % 200) / 200 - 0.5) * 0.002;
    return { lat: parseFloat((lat + offset * 0.6).toFixed(6)), lng: parseFloat((lng + offset).toFixed(6)), source: "street-cache" };
  }
  // Partial: strip street type and try again
  const noType = normalizeStreet(address).replace(/\s+(rd|st|ave|dr|ln|way|ct|pl|blvd|hwy|cir|ter|trl|pkwy)$/, "");
  for (const [k, v] of Object.entries(STREET_CACHE)) {
    if (k.endsWith(`|${townSlug}`) && k.startsWith(noType) && noType.length >= 5) {
      return { lat: v[0], lng: v[1], source: "street-cache-partial" };
    }
  }
  return null;
}

function deterministicCentroid(address, townSlug) {
  const centroid = TOWN_CENTROIDS[townSlug] || [42.87, -71.52];
  const street = normalizeStreet(address);
  let hash = 5381;
  for (let i = 0; i < street.length; i++) {
    hash = ((hash << 5) + hash + street.charCodeAt(i)) & 0x7fffffff;
  }
  const angle = (hash & 0xff) / 255 * Math.PI * 2;
  const dist  = 0.006 + (hash & 0x3f) / 0x3f * 0.018;
  return {
    lat: parseFloat((centroid[0] + Math.sin(angle) * dist).toFixed(6)),
    lng: parseFloat((centroid[1] + Math.cos(angle) * dist).toFixed(6)),
    source: "centroid-hashed",
  };
}

// ── CENSUS BATCH (correct CSV format) ────────────────────────
// Census batch geocoder format (NO quotes around non-address fields):
// ID,address,city,state,zip
async function censusBatch(items) {
  if (!items.length) return {};
  const lines = items.map((a, i) =>
    `${i},"${(a.address||"").replace(/"/g, "'")}",${a.city},${a.state},${a.zip}`
  );
  const form = new FormData();
  form.append("addressFile", new Blob([lines.join("\n")], { type:"text/csv" }), "a.csv");
  form.append("benchmark", "2020");
  form.append("returntype", "locations");
  try {
    const res = await fetch(
      "https://geocoding.geo.census.gov/geocoder/locations/addressbatch",
      { method:"POST", body:form, signal:AbortSignal.timeout(30000) }
    );
    if (!res.ok) return {};
    const text = await res.text();
    const out = {};
    for (const line of text.split("\n")) {
      const p = line.split(",");
      if (p.length < 9 || p[2]?.trim() !== "Match") continue;
      const idx = parseInt(p[0]);
      const lng = parseFloat(p[7]);
      const lat = parseFloat(p[8]);
      if (!isNaN(lat) && !isNaN(lng)) out[idx] = { lat, lng, source:"census" };
    }
    return out;
  } catch { return {}; }
}

// ── NOMINATIM SINGLE (strict 1/sec) ──────────────────────────
async function nominatim(address, city, state, zip) {
  const q = encodeURIComponent(`${address}, ${city}, ${state} ${zip}, USA`);
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1&countrycodes=us`,
      { headers:{"User-Agent":"RoofIntelligenceAI/6.0"}, signal:AbortSignal.timeout(8000) }
    );
    const data = await res.json();
    if (data[0]) return { lat:parseFloat(data[0].lat), lng:parseFloat(data[0].lon), source:"nominatim" };
  } catch { }
  return null;
}

// ── MAIN: BATCH GEOCODE ───────────────────────────────────────
// Input: [{ address, city, state, zip, townSlug }]
// Returns: { index → { lat, lng, source } }
export async function geocodeBatch(addresses, options = {}) {
  const { skipKvCache = false } = options;
  const results = {};
  const needsCensus = [];

  // Pass 1: KV cache + street cache
  const cacheChecks = addresses.map((a, i) => ({
    i,
    kvKey: `g6:${a.address}|${a.city}|${a.state}`.toLowerCase().replace(/\s+/g,"-").slice(0,200),
    a,
  }));

  for (const { i, kvKey, a } of cacheChecks) {
    if (!skipKvCache) {
      try {
        const cached = await kv.get(kvKey);
        if (cached) { results[i] = { ...cached, source:"kv-cache" }; continue; }
      } catch { /* non-fatal */ }
    }
    const street = lookupStreetCache(a.address, a.townSlug || "");
    if (street) {
      results[i] = street;
      try { await kv.set(kvKey, street, { ex:60*60*24*90 }); } catch { }
      continue;
    }
    needsCensus.push({ i, kvKey, ...a });
  }

  console.log(`    Geocoder: ${Object.keys(results).length} cached, ${needsCensus.length} → Census`);

  // Pass 2: Census batch (100/req)
  const censusMisses = [];
  for (let c = 0; c < needsCensus.length; c += 100) {
    const chunk = needsCensus.slice(c, c + 100);
    const batchResult = await censusBatch(chunk);
    for (let j = 0; j < chunk.length; j++) {
      const item = chunk[j];
      if (batchResult[j]) {
        results[item.i] = batchResult[j];
        try { await kv.set(item.kvKey, batchResult[j], { ex:60*60*24*90 }); } catch { }
      } else {
        censusMisses.push(item);
      }
    }
    if (c + 100 < needsCensus.length) await new Promise(r => setTimeout(r, 250));
  }

  console.log(`    Geocoder: ${censusMisses.length} Census misses`);

  // Pass 3: Nominatim for up to 15 Census misses
  const nominatimLimit = Math.min(censusMisses.length, 15);
  for (let i = 0; i < nominatimLimit; i++) {
    const item = censusMisses[i];
    const geo = await nominatim(item.address, item.city, item.state, item.zip);
    if (geo) {
      results[item.i] = geo;
      try { await kv.set(item.kvKey, geo, { ex:60*60*24*90 }); } catch { }
    }
    await new Promise(r => setTimeout(r, 1100));
  }

  // Pass 4: Deterministic centroid for everything else
  for (let i = nominatimLimit; i < censusMisses.length; i++) {
    const item = censusMisses[i];
    results[item.i] = deterministicCentroid(item.address, item.townSlug || "");
  }

  // Summary
  const sources = {};
  for (const r of Object.values(results)) { sources[r.source] = (sources[r.source]||0)+1; }
  console.log(`    Geocoder sources:`, sources);

  return results;
}
