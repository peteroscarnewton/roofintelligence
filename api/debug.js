// api/debug.js
// Temporary endpoint — tests each data source and returns raw results.
// Hit /api/debug to see exactly what each source returns from Vercel's servers.
// DELETE THIS FILE after diagnosing.

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const results = {};

  // ── Test 1: VGSI Bedford ──────────────────────────────────
  try {
    const r = await fetch("https://gis.vgsi.com/bedfordnh/Search.aspx/GetSearchResults", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({
        pageNum: 1, pageSize: 5, sortField: "Location", sortDir: "ASC",
        filter: {
          location:"", owner:"", minAcres:"0", maxAcres:"3",
          minValue:"", maxValue:"", minYearBuilt:"1994", maxYearBuilt:"2008", use:"101"
        }
      }),
      signal: AbortSignal.timeout(10000),
    });
    const text = await r.text();
    results.vgsi_bedford = {
      status: r.status,
      ok: r.ok,
      bodyPreview: text.slice(0, 500),
    };
  } catch(e) {
    results.vgsi_bedford = { error: e.message };
  }

  // ── Test 2: GRANIT UNH endpoint ───────────────────────────
  try {
    const url = "https://nhgeodata.unh.edu/nhgeodata/rest/services/EP/EP_Parcels_2023/MapServer/0/query"
      + "?where=TOWN_NAME+LIKE+'BEDFORD%25'+AND+YEAR_BUILT+BETWEEN+1994+AND+2008"
      + "&outFields=SITUS_ADDRESS,YEAR_BUILT,OBJECTID&returnGeometry=false&f=json&resultRecordCount=5";
    const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
    const text = await r.text();
    results.granit_unh = {
      status: r.status,
      ok: r.ok,
      bodyPreview: text.slice(0, 500),
    };
  } catch(e) {
    results.granit_unh = { error: e.message };
  }

  // ── Test 3: GRANIT alternate domain ──────────────────────
  try {
    const url = "https://nhgranit.unh.edu/arcgis/rest/services/EP/EP_Parcels_2024/MapServer/0/query"
      + "?where=TOWN_NAME+LIKE+'BEDFORD%25'+AND+YEAR_BUILT+BETWEEN+1994+AND+2008"
      + "&outFields=SITUS_ADDRESS,YEAR_BUILT,OBJECTID&returnGeometry=false&f=json&resultRecordCount=5";
    const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
    const text = await r.text();
    results.granit_alt = {
      status: r.status,
      ok: r.ok,
      bodyPreview: text.slice(0, 500),
    };
  } catch(e) {
    results.granit_alt = { error: e.message };
  }

  // ── Test 4: NOAA alerts ───────────────────────────────────
  try {
    const r = await fetch("https://api.weather.gov/alerts/active?area=NH", {
      headers: { "User-Agent": "RoofIntelligence/1.0" },
      signal: AbortSignal.timeout(8000),
    });
    const text = await r.text();
    results.noaa = {
      status: r.status,
      ok: r.ok,
      bodyPreview: text.slice(0, 200),
    };
  } catch(e) {
    results.noaa = { error: e.message };
  }

  return res.status(200).json({
    testedAt: new Date().toISOString(),
    serverRegion: process.env.VERCEL_REGION || "unknown",
    results,
  });
}
