// api/debug.js — probe individual town assessor databases

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const results = {};

  const probes = [
    // Avitar Associates — used by many NH towns (different platform from VGSI)
    ["avitar_bedford",    "https://www.avitarassociates.com/AssessorDatabase/bedfordnh/Search.aspx"],
    ["avitar_amherst",    "https://www.avitarassociates.com/AssessorDatabase/amherstnh/Search.aspx"],

    // Vision Government Solutions (different from VGSI)
    ["vision_bedford",    "https://gis.vgsi.com/bedfordnh/"],
    
    // AxisGIS — another NH assessor platform
    ["axisgis_bedford",   "https://www.axisgis.com/BedfordNH/"],
    ["axisgis_amherst",   "https://www.axisgis.com/AmherstNH/"],
    ["axisgis_api",       "https://www.axisgis.com/BedfordNH/api/parcels?limit=3"],

    // NH CAMA (Computer Assisted Mass Appraisal) open data
    ["nh_cama",           "https://www.nhes.nh.gov/elmi/products/bp/documents/bedford-nhes.pdf"],

    // Patriot Properties — another assessor platform used in NH
    ["patriot_bedford",   "https://www.patriotproperties.com/bedfordnh/default.asp"],
    ["patriot_api",       "https://www.patriotproperties.com/bedfordnh/api/search?yearBuiltMin=1994&yearBuiltMax=2008&use=101&limit=5"],

    // ProperlyNH — NH property search
    ["properlync",        "https://www.properly.com/nh/bedford/"],

    // NH BTLA (Board of Tax and Land Appeals) open data
    ["nh_btla",           "https://www.nh.gov/btla/documents/"],

    // Spatialest (formerly Tyler Technologies) — used by Bedford NH specifically
    ["spatialest_bedford","https://spatialest.com/nh/bedford/"],
    ["tyler_bedford",     "https://assessor.tylerhost.net/apps/selfservice/search;jsessionid=?searchBy=address&town=bedford&state=nh"],
  ];

  for (const [key, url] of probes) {
    try {
      const r = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          "Accept": "text/html,application/json,*/*",
        },
        signal: AbortSignal.timeout(8000),
        redirect: "follow",
      });
      const text = await r.text();
      results[key] = {
        status: r.status,
        ok: r.ok,
        finalUrl: r.url,
        cors: r.headers.get("access-control-allow-origin"),
        preview: text.slice(0, 300),
      };
    } catch(e) {
      results[key] = { error: e.message };
    }
  }

  return res.status(200).json({ testedAt: new Date().toISOString(), results });
}
