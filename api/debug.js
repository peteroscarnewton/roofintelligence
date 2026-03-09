// api/debug.js — temporary, delete after diagnosis

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const token = process.env.REGRID_API_TOKEN;
  const results = {
    hasToken: !!token,
    tokenLength: token?.length ?? 0,
    tokenPreview: token ? token.slice(0, 6) + "..." : null,
  };

  // Test one simple Regrid call
  if (token) {
    try {
      const url = `https://app.regrid.com/api/v2/parcels/query?path=/us/nh/hillsborough&fields[yearbuilt][gte]=1994&fields[yearbuilt][lte]=2008&limit=3&offset_id=0&return_geometry=false&return_matched_buildings=false&return_matched_addresses=false&return_enhanced_ownership=false&return_zoning=false&token=${token}`;
      const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
      const text = await r.text();
      results.regrid = {
        status: r.status,
        ok: r.ok,
        preview: text.slice(0, 600),
      };
    } catch(e) {
      results.regrid = { error: e.message };
    }
  }

  return res.status(200).json(results);
}
