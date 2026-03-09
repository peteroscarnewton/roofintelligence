// lib/scanner-regrid.js — NH + MA parcel data via Regrid API v2
//
// Uses the Query by Fields endpoint with path parameter per the official docs.
// Pagination uses offset_id = the `id` of the last feature returned.
//
// Required env var: REGRID_API_TOKEN
// Get token at: https://app.regrid.com → API Access
// Free trial: 2,000 parcel records

import { scoreParcel, buildReason, ownerTenure, CY } from "./scoring.js";
import { isInStormZone } from "./storm-zones.js";
import { detectSubdivisions } from "./neighborhood-cluster.js";

const BASE_URL   = "https://app.regrid.com/api/v2/parcels/query";
const BUILT_FROM = CY - 30;
const BUILT_TO   = CY - 18;
const PAGE_SIZE  = 1000; // Regrid max per request

// Regrid path format: /us/<state>/<county-slug>
// Covers NH Hillsborough + Rockingham + MA Middlesex
const COUNTIES = [
  { path: "/us/nh/hillsborough", label: "NH Hillsborough", state: "NH" },
  { path: "/us/nh/rockingham",   label: "NH Rockingham",   state: "NH" },
  { path: "/us/ma/middlesex",    label: "MA Middlesex",    state: "MA" },
];

function buildUrl(countyPath, offsetId, token) {
  const params = new URLSearchParams({
    "fields[yearbuilt][gte]": String(BUILT_FROM),
    "fields[yearbuilt][lte]": String(BUILT_TO),
    path:                     countyPath,
    limit:                    String(PAGE_SIZE),
    offset_id:                String(offsetId),
    return_geometry:          "false",
    return_matched_buildings:  "false",
    return_matched_addresses:  "false",
    return_enhanced_ownership: "false",
    return_zoning:             "false",
    token,
  });
  return `${BASE_URL}?${params}`;
}

function parseFeature(feature, state) {
  const f  = feature?.properties?.fields ?? {};
  const ll = feature?.properties?.ll_uuid ?? String(Math.random());

  // Regrid centroid fields
  const lat = parseFloat(f.ll_lat ?? f.lat ?? "0");
  const lng = parseFloat(f.ll_lon ?? f.lon ?? "0");

  // saledate format: "YYYY/MM/DD"
  let lastSale = 0;
  const rawSale = f.saledate || "";
  if (rawSale) {
    const y = parseInt(String(rawSale).slice(0, 4));
    if (y > 1900 && y <= CY) lastSale = y;
  }

  return {
    id:       `regrid-${ll}`,
    address:  (f.address  || f.saddress  || "").trim(),
    city:     (f.scity    || f.mail_city || "").trim(),
    zip:      (f.szip     || f.szip5     || "").trim(),
    lat:      lat || null,
    lng:      lng || null,
    built:    parseInt(f.yearbuilt || "0") || 0,
    lastSale,
    state,
    parcelId: f.parcelnumb || ll,
    owner:    (f.owner || "").trim(),
  };
}

export async function scanRegrid({ activeStormZones = [] } = {}) {
  const token = process.env.REGRID_API_TOKEN;
  if (!token) {
    console.warn("  Regrid: REGRID_API_TOKEN not set — skipping");
    return { parcels: [], subdivisions: [] };
  }

  const rawParcels = [];

  for (const county of COUNTIES) {
    console.log(`  Regrid: ${county.label}...`);
    // Per docs: start with offset_id=0, then use `id` of last feature for next page
    let offsetId = 0;
    let fetched  = 0;

    while (fetched < 2000) { // cap at free trial limit
      try {
        const url = buildUrl(county.path, offsetId, token);
        const r   = await fetch(url, { signal: AbortSignal.timeout(20000) });

        if (r.status === 401) { console.warn("  Regrid: Invalid or expired token"); break; }
        if (r.status === 429) { console.warn("  Regrid: Rate limited — stopping");  break; }
        if (!r.ok) {
          const text = await r.text();
          console.warn(`  Regrid: HTTP ${r.status} for ${county.label}: ${text.slice(0, 200)}`);
          break;
        }

        const data     = await r.json();
        const features = data?.parcels?.features ?? [];
        if (!features.length) { console.log(`    ${county.label}: no more results`); break; }

        console.log(`    ${county.label} page: ${features.length} features (offset_id=${offsetId})`);

        for (const f of features) {
          const p = parseFeature(f, county.state);
          if (p.built >= BUILT_FROM && p.built <= BUILT_TO && p.address) {
            rawParcels.push(p);
          }
        }

        fetched += features.length;

        // Per Regrid docs: next offset_id = the `id` of the last feature in this page
        const lastId = features[features.length - 1]?.id;
        if (!lastId || features.length < PAGE_SIZE) break;
        offsetId = lastId;

        await new Promise(r => setTimeout(r, 300)); // polite delay
      } catch (e) {
        console.warn(`  Regrid ${county.label} error: ${e.message}`);
        break;
      }
    }
  }

  console.log(`  Regrid raw: ${rawParcels.length} parcels`);

  // Drop parcels missing coordinates
  const withCoords = rawParcels.filter(p => p.lat && p.lng);
  console.log(`  Regrid with coords: ${withCoords.length}`);

  // Detect subdivisions
  const subdivisions = detectSubdivisions(withCoords, {
    activeStormZones,
    isInStormZoneFn: isInStormZone,
  });
  const subdivIds = new Set(subdivisions.flatMap(s => s.parcelIds ?? []));

  // Score all parcels
  const parcels = withCoords.map(p => {
    const inSubdivision = subdivIds.has(p.id);
    const stormHit      = isInStormZone(p.lat, p.lng, activeStormZones);
    const score         = scoreParcel({ built: p.built, lastSale: p.lastSale, inSubdivision, stormHit });
    const reason        = buildReason(p.built, p.lastSale, inSubdivision, stormHit);
    const tenure        = ownerTenure(p.built, p.lastSale);
    const tags          = ["age"];
    if (inSubdivision) tags.push("subdivision");
    if (stormHit)      tags.push("storm");

    return {
      ...p,
      score,
      reason,
      tenure,
      tags,
      type:         stormHit ? "storm" : "age",
      inSubdivision,
      stormHit,
      contact:      false,
      source:       "Regrid",
      coordSource:  "regrid",
      foundAt:      new Date().toISOString(),
    };
  });

  console.log(`  Regrid scored: ${parcels.length} parcels, ${subdivisions.length} subdivisions`);
  return { parcels, subdivisions };
}
