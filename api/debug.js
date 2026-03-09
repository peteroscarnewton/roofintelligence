export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const token = process.env.REGRID_API_TOKEN;
  const results = {};

  const tests = [
    ["nh_raw",       `https://app.regrid.com/api/v2/parcels/query?path=/us/nh/hillsborough&limit=3&offset_id=0&return_geometry=false&token=${token}`],
    ["nh_state",     `https://app.regrid.com/api/v2/parcels/query?path=/us/nh&limit=3&offset_id=0&return_geometry=false&token=${token}`],
    ["nh_state2",    `https://app.regrid.com/api/v2/parcels/query?fields[state2][eq]=NH&limit=3&offset_id=0&return_geometry=false&token=${token}`],
    ["bedford_addr", `https://app.regrid.com/api/v2/parcels/address?query=1+meetinghouse+rd&path=/us/nh&limit=2&token=${token}`],
  ];

  for (const [key, url] of tests) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
      const text = await r.text();
      results[key] = { status: r.status, preview: text.slice(0, 400) };
    } catch(e) {
      results[key] = { error: e.message };
    }
  }

  return res.status(200).json(results);
}
