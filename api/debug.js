export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const results = {};

  const CY = new Date().getFullYear();
  const BUILT_FROM = CY - 30;
  const BUILT_TO   = CY - 18;

  const tests = [
    // CAD/ParcelMosiac — the public parcel layer found in search
    ["parcel_mosaic_info",
      "https://nhgeodata.unh.edu/nhgeodata/rest/services/CAD/ParcelMosiac/MapServer/0?f=json"],

    // Query it with year built filter + Bedford town
    ["parcel_mosaic_query",
      `https://nhgeodata.unh.edu/nhgeodata/rest/services/CAD/ParcelMosiac/MapServer/0/query?where=TOWN+LIKE+'BEDFORD'+AND+YEAR_BUILT+BETWEEN+${BUILT_FROM}+AND+${BUILT_TO}&outFields=*&returnGeometry=false&f=json&resultRecordCount=5`],

    // Also try the CAMA related table (layer 3) which may have year built
    ["cama_table",
      "https://nhgeodata.unh.edu/nhgeodata/rest/services/CAD/ParcelMosiac/MapServer/3?f=json"],

    // Try the hosted parcel service
    ["hosted_parcel",
      "https://nhgeodata.unh.edu/nhgeodata/rest/services/Hosted/NHParcelMosaic_CAMA/FeatureServer/0?f=json"],
  ];

  for (const [key, url] of tests) {
    try {
      const r = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(10000),
      });
      const text = await r.text();
      results[key] = { status: r.status, preview: text.slice(0, 500) };
    } catch(e) {
      results[key] = { error: e.message };
    }
  }

  return res.status(200).json(results);
}
