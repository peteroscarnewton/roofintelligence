// lib/scanner-regrid.js — NH + MA parcel data via Regrid API v2
//
// Uses the Query by Fields endpoint to fetch single-family homes
// built between 1994–2008 (peak roof replacement age) per town.
//
// Required env var: REGRID_API_TOKEN
// Sign up free at: https://app.regrid.com/users/sign_up?flow=api_sandbox
// Free tier: 2,000 parcels/month

import { scoreParcel, buildReason, ownerTenure, CY } from "./scoring.js";
import { isInStormZone } from "./storm-zones.js";
import { detectSubdivisions } from "./neighborhood-cluster.js";

const BASE_URL   = "https://app.regrid.com/api/v2/parcels/query";
const BUILT_FROM = CY - 30;
const BUILT_TO   = CY - 18;
const PAGE_SIZE  = 100;

// NH Hillsborough + Rockingham counties cover all target towns
// FIPS geoids: Hillsborough=33011, Rockingham=33015, Middlesex MA=25017
const COUNTIES = [
  { geoid: "33011", label: "NH Hillsborough", state: "NH" },
  { geoid: "33015", label: "NH Rockingham",   state: "NH" },
  { geoid: "25017", label: "MA Middlesex",    state: "MA" },
];

function buildUrl(geoid, offset, token) {
  const params = new URLSearchParams({
    "fields[geoid][eq]":         geoid,
    "fields[yearbuilt][gte]":    String(BUILT_FROM),
    "fields[yearbuilt][lte]":    String(BUILT_TO),
    "fields[usecode][eq]":       "1000", // single family residential
    limit:                       String(PAGE_SIZE),
    offset_id:                   String(offset),
    return_geometry:             "false", // save quota — we use centroid lat/lon
    token,
  });
  return `${BASE_URL}?${params}`;
}

function parseFeature(feature, state) {
  const f  = feature?.properties?.fields ?? {};
  const ll = feature?.properties?.ll_uuid ?? String(Math.random());

  const lat = parseFloat(f.lat ?? f.ll_lat ?? "0");
  const lng = parseFloat(f.lon ?? f.ll_lon ?? "0");

  const rawSaleDate = f.saledatemonth || f.saledate || "";
  let lastSale = 0;
  if (rawSaleDate) {
    const y = parseInt(String(rawSaleDate).slice(0, 4));
    if (y > 1900 && y <= CY) lastSale = y;
  }

  return {
    id:       `regrid-${ll}`,
    address:  (f.address || f.saddress || "").trim(),
    city:     (f.scity   || f.mail_city || "").trim(),
    zip:      (f.szip    || f.szip5     || "").trim(),
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
    let offset = 0;
    let fetched = 0;
    let total = Infinity;

    while (fetched < total && fetched < 2000) {
      try {
        const url = buildUrl(county.geoid, offset, token);
        const r   = await fetch(url, { signal: AbortSignal.timeout(15000) });

        if (r.status === 401) {
          console.warn("  Regrid: Invalid or expired token");
          break;
        }
        if (r.status === 429) {
          console.warn("  Regrid: Rate limited — stopping");
          break;
        }
        if (!r.ok) {
          console.warn(`  Regrid: HTTP ${r.status} for ${county.label}`);
          break;
        }

        const data     = await r.json();
        const features = data?.parcels?.features ?? [];
        if (!features.length) break;

        if (total === Infinity) {
          total = data?.parcels?.count ?? features.length;
          console.log(`    ${county.label}: ${total} matching parcels`);
        }

        for (const f of features) {
          const p = parseFeature(f, county.state);
          if (p.built >= BUILT_FROM && p.built <= BUILT_TO && p.address) {
            rawParcels.push(p);
          }
        }

        fetched += features.length;
        offset  += features.length;

        if (features.length < PAGE_SIZE) break;
        await new Promise(r => setTimeout(r, 200)); // polite delay
      } catch (e) {
        console.warn(`  Regrid ${county.label} error: ${e.message}`);
        break;
      }
    }
  }

  console.log(`  Regrid raw: ${rawParcels.length} parcels`);

  // Filter out parcels with no coordinates
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
      type:          stormHit ? "storm" : "age",
      inSubdivision,
      stormHit,
      contact:       false,
      source:        "Regrid",
      coordSource:   "regrid",
      foundAt:       new Date().toISOString(),
    };
  });

  console.log(`  Regrid scored: ${parcels.length} parcels, ${subdivisions.length} subdivisions`);
  return { parcels, subdivisions };
}
