// api/neighborhood-cluster.js v6.1 — Phase 1
// -------------------------------------------
// Uses unified scoring from scoring.js (scoreSubdivision).
// Address-string clustering — works without GPS coords.

import { scoreSubdivision, ownerTenure, CY } from "./scoring.js";

const MAX_YEAR_SPREAD = 7;
const MIN_COHORT_HOMES = 5;
const MIN_STREET_HOMES = 2;

const TYPE_MAP = {
  "avenue":"ave","boulevard":"blvd","circle":"cir","court":"ct","drive":"dr",
  "highway":"hwy","lane":"ln","place":"pl","road":"rd","square":"sq",
  "street":"st","terrace":"ter","trail":"trl","way":"way","parkway":"pkwy",
  "ave":"ave","blvd":"blvd","cir":"cir","ct":"ct","dr":"dr",
  "hwy":"hwy","ln":"ln","pl":"pl","rd":"rd","sq":"sq","st":"st",
  "ter":"ter","trl":"trl","way":"way","pkwy":"pkwy",
};

function parseAddress(address) {
  const s = (address || "").toLowerCase().trim();
  const numMatch = s.match(/^(\d+)\s+(.+)/);
  if (!numMatch) return { number: 0, streetName: s, streetType: "", full: s };
  const number = parseInt(numMatch[1]);
  const rest = numMatch[2].trim();
  const parts = rest.split(/\s+/);
  const lastPart = parts[parts.length - 1];
  const streetType = TYPE_MAP[lastPart] || lastPart;
  const streetName = parts.length > 1 ? parts.slice(0, -1).join(" ") : rest;
  return { number, streetName, streetType, full: `${streetName} ${streetType}`.trim() };
}

function streetsAreRelated(streetA, streetB) {
  const a = streetA.toLowerCase();
  const b = streetB.toLowerCase();
  const wordsA = a.split(/\s+/);
  const wordsB = b.split(/\s+/);
  const rootA = wordsA[0];
  const rootB = wordsB[0];
  if (rootA.length >= 5 && rootA === rootB) return true;
  const setA = new Set(wordsA.slice(0, -1));
  const setB = new Set(wordsB.slice(0, -1));
  let shared = 0;
  for (const w of setA) { if (setB.has(w) && w.length >= 4) shared++; }
  if (shared >= 2) return true;
  return false;
}

function groupStreets(parcels) {
  const byStreet = new Map();
  for (const p of parcels) {
    const parsed = parseAddress(p.address);
    const key = parsed.full;
    if (!key || key.length < 3) continue;
    if (!byStreet.has(key)) byStreet.set(key, []);
    byStreet.get(key).push(p);
  }
  const streets = [...byStreet.entries()]
    .filter(([, homes]) => homes.length >= MIN_STREET_HOMES)
    .map(([street, homes]) => ({ street, homes }));

  const merged = [];
  const used = new Set();
  for (let i = 0; i < streets.length; i++) {
    if (used.has(i)) continue;
    const group = { streets: [streets[i].street], homes: [...streets[i].homes] };
    used.add(i);
    for (let j = i + 1; j < streets.length; j++) {
      if (used.has(j)) continue;
      if (streetsAreRelated(streets[i].street, streets[j].street)) {
        group.streets.push(streets[j].street);
        group.homes.push(...streets[j].homes);
        used.add(j);
      }
    }
    merged.push(group);
  }
  return merged;
}

function detectCohorts(homes) {
  const withYear = homes
    .filter(p => p.built && p.built >= 1970 && p.built <= CY - 15)
    .sort((a, b) => a.built - b.built);
  if (withYear.length < MIN_COHORT_HOMES) return [];
  const cohorts = [];
  const used = new Set();
  for (let i = 0; i < withYear.length; i++) {
    if (used.has(i)) continue;
    const startYear = withYear[i].built;
    const endYear = startYear + MAX_YEAR_SPREAD;
    const cohort = withYear.filter((p, idx) =>
      p.built >= startYear && p.built <= endYear && !used.has(idx));
    if (cohort.length >= MIN_COHORT_HOMES) {
      cohort.forEach((_, idx) => {
        const origIdx = withYear.indexOf(cohort[idx]);
        if (origIdx >= 0) used.add(origIdx);
      });
      cohorts.push(cohort);
    }
  }
  return cohorts.sort((a, b) => b.length - a.length);
}

function subdivCenter(cohort, townLat, townLng) {
  const geocoded = cohort.filter(p =>
    p.lat && p.lng && p.coordSource !== "centroid-hashed" && !isNaN(p.lat) && !isNaN(p.lng));
  const sample = geocoded.length >= 3 ? geocoded : cohort.filter(p => p.lat && p.lng);
  if (sample.length === 0) return { lat: townLat, lng: townLng, reliable: false };
  const lat = sample.reduce((s, p) => s + p.lat, 0) / sample.length;
  const lng = sample.reduce((s, p) => s + p.lng, 0) / sample.length;
  return { lat, lng, reliable: geocoded.length >= 3 };
}

export function detectSubdivisions(parcels, options = {}) {
  const { activeStormZones = [], isInStormZoneFn = null, townLat = 42.87, townLng = -71.52 } = options;
  if (!parcels || parcels.length < MIN_COHORT_HOMES) return [];
  console.log(`  Subdivision detection: ${parcels.length} parcels...`);

  const streetGroups = groupStreets(parcels);
  console.log(`  Street groups: ${streetGroups.length} (${streetGroups.filter(g => g.homes.length >= MIN_COHORT_HOMES).length} with 5+ homes)`);

  const subdivisions = [];

  for (const group of streetGroups) {
    const cohorts = detectCohorts(group.homes);
    for (const cohort of cohorts) {
      const years     = cohort.map(p => p.built);
      const minYear   = Math.min(...years);
      const maxYear   = Math.max(...years);
      const avgAge    = Math.round(cohort.reduce((s, p) => s + (CY - p.built), 0) / cohort.length);
      const avgTenure = Math.round(cohort.reduce((s, p) => s + ownerTenure(p.built, p.lastSale), 0) / cohort.length);
      const yearRange = minYear === maxYear ? String(minYear) : `${minYear}–${maxYear}`;

      const center   = subdivCenter(cohort, townLat, townLng);
      const stormHit = isInStormZoneFn ? isInStormZoneFn(center.lat, center.lng, activeStormZones) : false;

      // Use unified scoring formula
      const score = scoreSubdivision({ cohort, stormHit, nearPermitCluster: false });

      // Name
      const rootCounts = {};
      for (const s of group.streets) {
        const root = s.split(/\s+/)[0];
        rootCounts[root] = (rootCounts[root] || 0) + 1;
      }
      const topRoot = Object.entries(rootCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || group.streets[0];
      const name = group.streets.length > 1
        ? `${cohort.length} homes — ${topRoot.charAt(0).toUpperCase() + topRoot.slice(1)} subdivision`
        : `${cohort.length} homes on ${group.streets[0].replace(/\b\w/g, c => c.toUpperCase())}`;

      const cityCounts = {};
      for (const p of cohort) { cityCounts[p.city] = (cityCounts[p.city] || 0) + 1; }
      const city = Object.entries(cityCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
      const zip  = cohort.find(p => p.zip)?.zip || "";

      cohort.forEach(p => { p.inSubdivision = true; });

      // Count original owners in cluster (tenure >= built year)
      const originalOwners = cohort.filter(p => ownerTenure(p.built, p.lastSale) >= (CY - p.built - 2)).length;

      subdivisions.push({
        id:             `subdiv-${city.replace(/[^a-z]/gi, "").toLowerCase()}-${topRoot}-${minYear}-${cohort.length}`,
        address:        name,
        city, zip,
        lat:            parseFloat(center.lat.toFixed(5)),
        lng:            parseFloat(center.lng.toFixed(5)),
        built:          Math.round(cohort.reduce((s, p) => s + p.built, 0) / cohort.length),
        type:           stormHit ? "storm" : "age",
        tags:           stormHit ? ["age", "storm", "subdivision"] : ["age", "subdivision"],
        score,
        reason:         `${cohort.length} homes built ${yearRange} — avg ${avgAge}-yr roof — replacement wave`,
        source:         "Neighborhood Analysis",
        sourceUrl:      null,
        coordSource:    center.reliable ? "cluster-centroid-geocoded" : "cluster-centroid-approx",
        houseCount:     cohort.length,
        yearRange,
        avgAge,
        avgTenure,
        originalOwners,
        streets:        group.streets,
        parcelIds:      cohort.map(p => p.id),
        stormHit,
        contact:        false,
        foundAt:        new Date().toISOString(),
      });
    }
  }

  subdivisions.sort((a, b) => b.score - a.score || b.houseCount - a.houseCount);
  const totalHomes = subdivisions.reduce((s, d) => s + d.houseCount, 0);
  console.log(`  Found ${subdivisions.length} subdivisions covering ${totalHomes} homes`);
  return subdivisions;
}
