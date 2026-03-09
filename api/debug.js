// api/debug.js — probe GRANIT folders + alternative NH parcel sources

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const results = {};

  const probes = [
    // Probe every GRANIT folder for parcel-like services
    ["granit_apb",    "https://nhgeodata.unh.edu/nhgeodata/rest/services/APB?f=json"],
    ["granit_lgn",    "https://nhgeodata.unh.edu/nhgeodata/rest/services/LGN?f=json"],
    ["granit_topical","https://nhgeodata.unh.edu/nhgeodata/rest/services/Topical?f=json"],
    ["granit_oc",     "https://nhgeodata.unh.edu/nhgeodata/rest/services/OC?f=json"],
    ["granit_csd",    "https://nhgeodata.unh.edu/nhgeodata/rest/services/CSD?f=json"],

    // NH ESRI Open Data Hub — public parcel layer
    ["nh_esri_hub",   "https://opendata.arcgis.com/api/v3/datasets?filter%5BspatialReference%5D=4326&q=NH+parcels&page%5Bsize%5D=5"],

    // ArcGIS Living Atlas — NH parcels
    ["living_atlas",  "https://services.arcgis.com/rYz782eMbySr2srL/arcgis/rest/services/NH_Parcels/FeatureServer/0/query?where=1%3D1&f=json&resultRecordCount=1"],

    // Regrid — public parcel API (no key needed for basic queries)
    ["regrid",        "https://app.regrid.com/api/v2/parcels/query?path=%2Fus%2Fnh%2Fhillsborough%2Fbedford&limit=3&fields=address,year_built&token="],

    // NH PDIP open data
    ["nh_pdip",       "https://nhpdip.unh.edu/arcgis/rest/services?f=json"],

    // VGSI direct page load (not the API — just see if the site responds at all)
    ["vgsi_homepage", "https://gis.vgsi.com/bedfordnh/"],

    // Try VGSI with full browser headers
    ["vgsi_post_browser", "POST:https://gis.vgsi.com/bedfordnh/Search.aspx/GetSearchResults"],
  ];

  for (const [key, urlRaw] of probes) {
    const isPost = urlRaw.startsWith("POST:");
    const url = isPost ? urlRaw.slice(5) : urlRaw;
    try {
      const opts = {
        method: isPost ? "POST" : "GET",
        headers: {
          "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
          "Accept": "application/json, text/html, */*",
          "Accept-Language": "en-US,en;q=0.9",
          "Origin": "https://roofintelligence.vercel.app",
          "Referer": "https://roofintelligence.vercel.app/",
        },
        ...(isPost ? { body: JSON.stringify({pageNum:1,pageSize:5,sortField:"Location",sortDir:"ASC",filter:{location:"",owner:"",minAcres:"0",maxAcres:"3",minValue:"",maxValue:"",minYearBuilt:"1994",maxYearBuilt:"2008",use:"101"}}) } : {}),
        signal: AbortSignal.timeout(8000),
      };
      if (isPost) opts.headers["Content-Type"] = "application/json";
      const r = await fetch(url, opts);
      const text = await r.text();
      results[key] = { status: r.status, ok: r.ok, cors: r.headers.get("access-control-allow-origin"), preview: text.slice(0, 400) };
    } catch(e) {
      results[key] = { error: e.message };
    }
  }

  return res.status(200).json({ testedAt: new Date().toISOString(), results });
}
