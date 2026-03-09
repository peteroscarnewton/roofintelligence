// api/debug.js — test CORS headers from VGSI and GRANIT

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const results = {};

  // Test VGSI with browser-like headers to see what response we get
  const probes = [
    ["vgsi_options", "https://gis.vgsi.com/bedfordnh/Search.aspx/GetSearchResults", "OPTIONS"],
    ["granit_catalog", "https://nhgeodata.unh.edu/nhgeodata/rest/services?f=json", "GET"],
    ["granit_ep", "https://nhgeodata.unh.edu/nhgeodata/rest/services/EP?f=json", "GET"],
    ["granit_2024", "https://nhgeodata.unh.edu/nhgeodata/rest/services/EP/EP_Parcels_2024/MapServer/0?f=json", "GET"],
    ["granit_2025", "https://nhgeodata.unh.edu/nhgeodata/rest/services/EP/EP_Parcels_2025/MapServer/0?f=json", "GET"],
    ["granit_no_year", "https://nhgeodata.unh.edu/nhgeodata/rest/services/EP/EP_Parcels/MapServer/0?f=json", "GET"],
  ];

  for (const [key, url, method] of probes) {
    try {
      const r = await fetch(url, {
        method,
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          "Origin": "https://roofintelligence.vercel.app",
          "Accept": "application/json, text/plain, */*",
        },
        signal: AbortSignal.timeout(8000),
      });
      const text = await r.text();
      const corsHeader = r.headers.get("access-control-allow-origin");
      results[key] = {
        status: r.status,
        ok: r.ok,
        cors: corsHeader,
        preview: text.slice(0, 400),
      };
    } catch(e) {
      results[key] = { error: e.message };
    }
  }

  return res.status(200).json({ testedAt: new Date().toISOString(), results });
}
