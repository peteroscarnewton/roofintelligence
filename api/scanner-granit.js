// api/scanner-granit.js — Phase 4a
// ---------------------------------
// NH GRANIT statewide parcel layer as fallback for towns where VGSI returns nothing.
// VGSI is always primary — GRANIT only fills gaps.
//
// NH GRANIT ArcGIS REST endpoint:
//   https://nhgeodata.unh.edu/nhgeodata/rest/services/EP/EP_Parcels_2023/MapServer/0/query
//
// Key differences from the GRANIT fallback baked into scanner-assessor:
//   - Called town-by-town ONLY for towns that got 0 parcels from VGSI
//   - Handles pagination (GRANIT returns max 1000 records per request)
//   - Returns real WGS84 geometry (lat/lng) embedded in each feature
//   - Normalizes to the same parcel shape as VGSI so scoring works identically

import { isInStormZone }  from "./storm-zones.js";
import { scoreParcel, buildReason, ownerTenure, CY } from "./scoring.js";

const BUILT_FROM = CY - 30;
const BUILT_TO   = CY - 18;
const PAGE_SIZE  = 1000; // GRANIT max per request
const BASE_URL   = "https://nhgeodata.unh.edu/nhgeodata/rest/services/EP/EP_Parcels_2023/MapServer/0/query";

// Fields we need: address, year built, last sale date, parcel ID, geometry
const FIELDS = "SITUS_ADDRESS,YEAR_BUILT,LAST_SALE_DATE,OBJECTID,TOWN_NAME";

function buildGranitUrl(townNameUpper, offset) {
  const where = [
    `TOWN_NAME LIKE '${townNameUpper}%'`,
    `YEAR_BUILT BETWEEN ${BUILT_FROM} AND ${BUILT_TO}`,
    `USE_CODE = '101'`,         // single-family residential
  ].join(" AND ");

  const params = new URLSearchParams({
    where,
    outFields:          FIELDS,
    returnGeometry:     "true",
    outSR:              "4326",   // WGS84 lat/lng
    f:                  "json",
    resultOffset:       String(offset),
    resultRecordCount:  String(PAGE_SIZE),
    orderByFields:      "OBJECTID ASC",
  });
  return `${BASE_URL}?${params}`;
}

function parseGranitFeature(f) {
  const attrs = f.attributes || {};
  const geom  = f.geometry  || {};

  const rawDate = attrs.LAST_SALE_DATE;
  let lastSale  = 0;
  if (rawDate) {
    // GRANIT stores epoch ms
    const d = new Date(typeof rawDate === "number" ? rawDate : parseInt(rawDate));
    if (!isNaN(d.getFullYear())) lastSale = d.getFullYear();
  }

  return {
    address:   (attrs.SITUS_ADDRESS || "").trim(),
    yearBuilt: parseInt(attrs.YEAR_BUILT || "0") || 0,
    lastSale,
    parcelId:  String(attrs.OBJECTID || Math.random()),
    // GRANIT returns x=lng, y=lat in WGS84
    geoLat:    typeof geom.y === "number" ? geom.y : null,
    geoLng:    typeof geom.x === "number" ? geom.x : null,
  };
}

export async function scanGranitForTown(town, { activeStormZones = [] } = {}) {
  const townNameUpper = town.label.replace(/, NH$|, MA$/, "").toUpperCase();
  console.log(`    GRANIT fallback: ${town.label} (${townNameUpper})...`);

  const parcels = [];
  let offset    = 0;
  let exceeded  = true; // GRANIT sets exceededTransferLimit when there are more records

  while (exceeded) {
    let data;
    try {
      const url = buildGranitUrl(townNameUpper, offset);
      const res = await fetch(url, {
        headers: { "User-Agent": "RoofIntelligence/1.0 (NH roofing sales tool)" },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) {
        console.warn(`    GRANIT ${town.label} HTTP ${res.status} — skipping`);
        break;
      }
      data = await res.json();
    } catch(e) {
      console.warn(`    GRANIT ${town.label} fetch error: ${e.message}`);
      break;
    }

    if (data?.error) {
      console.warn(`    GRANIT ${town.label} error: ${data.error.message || JSON.stringify(data.error)}`);
      break;
    }

    const features = data?.features || [];
    const raw = features
      .map(parseGranitFeature)
      .filter(p => p.address && p.yearBuilt >= BUILT_FROM && p.yearBuilt <= BUILT_TO);

    parcels.push(...raw);
    exceeded = data?.exceededTransferLimit === true;
    offset  += PAGE_SIZE;

    if (features.length < PAGE_SIZE) break; // last page
    await new Promise(r => setTimeout(r, 200)); // be polite
  }

  console.log(`    GRANIT ${town.label}: ${parcels.length} parcels found`);

  // Convert to lead shape (same as scanner-assessor)
  return parcels.map(p => {
    const lat     = p.geoLat ?? (town.lat + (Math.random() - 0.5) * 0.03);
    const lng     = p.geoLng ?? (town.lng + (Math.random() - 0.5) * 0.03);
    const stormHit = isInStormZone(lat, lng, activeStormZones);
    const tenure   = ownerTenure(p.yearBuilt, p.lastSale);
    return {
      id:           `granit-${town.slug}-${p.parcelId}`,
      address:      p.address,
      city:         town.label,
      zip:          town.zip,
      lat:          parseFloat(lat.toFixed(6)),
      lng:          parseFloat(lng.toFixed(6)),
      built:        p.yearBuilt,
      lastSale:     p.lastSale || 0,
      tenure,
      type:         stormHit ? "storm" : "age",
      tags:         ["age"],
      score:        0,
      reason:       "",
      source:       "NH GRANIT",
      sourceUrl:    "https://nhgeodata.unh.edu/",
      coordSource:  p.geoLat ? "granit-geocoded" : "centroid",
      parcelId:     p.parcelId,
      stormHit,
      inSubdivision: false,
      contact:      false,
      foundAt:      new Date().toISOString(),
    };
  });
}
