// api/debug.js — probe correct Regrid path + field names

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const token = process.env.REGRID_API_TOKEN;
  const results = {};

  const tests = [
    // Test 1: no year filter, just get anything from NH hillsborough
    ["nh_hillsborough_raw",    `https://app.regrid.com/api/v2/parcels/query?path=/us/nh/hillsborough&limit=3&offset_id=0&return_geometry=false&token=${token}`],
    // Test 2: state-level path
    ["nh_state",               `https://app.regrid.com/api/v2/parcels/query?path=/us/nh&limit=3&offset_id=0&return_geometry=false&token=${token}`],
    // Test 3: try state2 field filter instead of path
    ["nh_state2_field",        `https://app.regrid.com/api/v2/parcels/query?fields[state2][eq]=NH&limit=3&offset_id=0&return_geometry=false&token=${token}`],
    // Test 4: try county field
    ["nh_county_field",        `https://app.regrid.com/api/v2/parcels/query?fields[county][ilike]=hillsborough&limit=3&offset_id=0&return_geometry=false&token=${token}`],
    // Test 5: bedford specifically by address
    ["bedford_address",        `https://app.regrid.com/api/v2/parcels/address?query=1+meetinghouse+rd&path=/us/nh/hillsborough&limit=3&token=${token}`],
    // Test 6: check what the verse endpoint says about NH coverage
    ["nh_verse",               `https://app.regrid.com/api/v2/us/verse?token=${token}&return_geometry=false`],
  ];

  for (const [key, url] of tests) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(12000) });
      const text = await r.text();
      results[key] = { status: r.status, preview: text.slice(0, 400) };
    } catch(e) {
      results[key] = { error: e.message };
    }
  }

  return res.status(200).json(results);
}
