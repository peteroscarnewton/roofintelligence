// api/scanner-assessor.js v7 — Phase 4a + 4b
// -------------------------------------------
// 4a: GRANIT statewide fallback for any town that returns 0 from VGSI
// 4b: 5 new towns added — Hooksett, New Boston, Weare, Raymond, Candia

import { geocodeBatch }       from "./geocoder.js";
import { detectSubdivisions } from "./neighborhood-cluster.js";
import { tryEndpoints, getLastEndpoint, saveLastEndpoint } from "./resilient-fetch.js";
import { markSuccess, markFailure } from "./health.js";
import { isInStormZone }      from "./storm-zones.js";
import { scoreParcel, buildReason, ownerTenure, CY } from "./scoring.js";
import { scanGranitForTown }  from "./scanner-granit.js";

const BUILT_FROM = CY - 30;
const BUILT_TO   = CY - 18;

// ── TOWN LIST ─────────────────────────────────────────────────
// Original 15 NH + 3 MA towns, plus 5 new Phase 4b towns.
// GRANIT-only flag: towns that have no VGSI slug — skip VGSI, go straight to GRANIT.
export const TOWNS = [
  // ── Original territory ───────────────────────────────────────
  { slug:"bedfordnh",     label:"Bedford, NH",     zip:"03110", lat:42.9512, lng:-71.5151, state:"NH" },
  { slug:"amherstnh",     label:"Amherst, NH",     zip:"03031", lat:42.8612, lng:-71.5975, state:"NH" },
  { slug:"milfordnh",     label:"Milford, NH",      zip:"03055", lat:42.8393, lng:-71.6495, state:"NH" },
  { slug:"merrimacknh",   label:"Merrimack, NH",    zip:"03054", lat:42.8651, lng:-71.4964, state:"NH" },
  { slug:"hollisnh",      label:"Hollis, NH",       zip:"03049", lat:42.7462, lng:-71.5864, state:"NH" },
  { slug:"londonderrynh", label:"Londonderry, NH",  zip:"03053", lat:42.8651, lng:-71.3737, state:"NH" },
  { slug:"derrynh",       label:"Derry, NH",        zip:"03038", lat:42.8812, lng:-71.3264, state:"NH" },
  { slug:"hudsonnh",      label:"Hudson, NH",       zip:"03051", lat:42.7651, lng:-71.4376, state:"NH" },
  { slug:"windhamnh",     label:"Windham, NH",      zip:"03087", lat:42.8062, lng:-71.2964, state:"NH" },
  { slug:"nashuanh",      label:"Nashua, NH",       zip:"03060", lat:42.7654, lng:-71.4676, state:"NH" },
  { slug:"pelhamnh",      label:"Pelham, NH",       zip:"03076", lat:42.7312, lng:-71.3337, state:"NH" },
  { slug:"manchesternh",  label:"Manchester, NH",   zip:"03101", lat:42.9956, lng:-71.4548, state:"NH" },
  { slug:"goffstownnh",   label:"Goffstown, NH",    zip:"03045", lat:43.0126, lng:-71.5876, state:"NH" },
  { slug:"litchfieldnh",  label:"Litchfield, NH",   zip:"03052", lat:42.8262, lng:-71.4764, state:"NH" },
  { slug:"brooklinenh",   label:"Brookline, NH",    zip:"03033", lat:42.7312, lng:-71.6595, state:"NH" },
  // MA supplemental
  { slug:"chelmsfordma",  label:"Chelmsford, MA",   zip:"01824", lat:42.5993, lng:-71.3673, state:"MA" },
  { slug:"dracut",        label:"Dracut, MA",        zip:"01826", lat:42.6759, lng:-71.3037, state:"MA" },
  { slug:"tyngsborough",  label:"Tyngsborough, MA", zip:"01879", lat:42.6726, lng:-71.4264, state:"MA" },

  // ── Phase 4b: 5 new towns ────────────────────────────────────
  // All have 1990s–2000s subdivisions now hitting peak roof age.
  // No VGSI slugs confirmed for these — using GRANIT primary, VGSI attempted as bonus.
  { slug:"hooksettnh",    label:"Hooksett, NH",     zip:"03106", lat:43.0976, lng:-71.4648, state:"NH", granitPrimary:true },
  { slug:"newbostonnh",   label:"New Boston, NH",    zip:"03070", lat:42.9612, lng:-71.7095, state:"NH", granitPrimary:true },
  { slug:"wearnh",        label:"Weare, NH",         zip:"03281", lat:43.0812, lng:-71.7195, state:"NH", granitPrimary:true },
  { slug:"raymondnh",     label:"Raymond, NH",       zip:"03077", lat:43.0312, lng:-71.1895, state:"NH", granitPrimary:true },
  { slug:"candianh",      label:"Candia, NH",        zip:"03034", lat:43.0712, lng:-71.2995, state:"NH", granitPrimary:true },
];

// ── VGSI ENDPOINT BUILDER ─────────────────────────────────────
function buildEndpoints(town, pageNum, pageSize) {
  const f = { location:"",owner:"",minAcres:"0",maxAcres:"3",minValue:"",maxValue:"",
    minYearBuilt:String(BUILT_FROM),maxYearBuilt:String(BUILT_TO),use:"101" };
  return [
    { label:"VGSI Search.aspx POST",
      url:`https://gis.vgsi.com/${town.slug}/Search.aspx/GetSearchResults`,
      method:"POST", body:{ pageNum,pageSize,sortField:"Location",sortDir:"ASC",filter:f },
      headers:{"Content-Type":"application/json","Accept":"application/json"},
      validate:(d)=>{ const r=(d?.d??d); const rows=r?.Rows??r?.rows??(Array.isArray(r)?r:null); return rows?"No rows":null; }
    },
    { label:"VGSI api/search",
      url:`https://gis.vgsi.com/${town.slug}/api/search`,
      method:"POST", body:{page:pageNum,pageSize,filter:f},
      headers:{"Content-Type":"application/json"},
      validate:(d)=>{ return(Array.isArray(d?.results)||Array.isArray(d?.data)||Array.isArray(d))?null:"No results"; }
    },
  ];
}

function normalizeRows(data) {
  const d    = data?.d ?? data;
  const rows = d?.Rows ?? d?.rows ?? d?.results ?? d?.data ?? (Array.isArray(d) ? d : []);
  const total = d?.TotalCount ?? d?.totalCount ?? d?.total ?? rows.length;
  return { rows: rows.map(r => ({
    address:   (r.Location||r.location||r.Address||r.situs||"").trim(),
    yearBuilt: parseInt(r.YearBuilt||r.yearBuilt||r.YEAR_BUILT||"0"),
    lastSale:  parseInt(r.SaleYear||r.saleYear||r.SALE_YEAR||"0"),
    parcelId:  r.PID||r.Pid||r.pid||r.ParcelID||String(Math.random()),
    geoLat: null, geoLng: null,
  })), total };
}

// ── MAIN SCAN ─────────────────────────────────────────────────
export async function scanAssessor({ activeStormZones=[], geocode=true }={}) {
  const allParcels   = [];
  const startIndex   = await getLastEndpoint("assessor");
  let   lastWorking  = startIndex;
  let   anySuccess   = false;
  let   granitFills  = 0;  // count of towns filled by GRANIT

  for (const town of TOWNS) {
    console.log(`  Assessor: ${town.label}...`);
    let townRaw = [];

    // ── Try VGSI first (skip for granitPrimary towns) ─────────
    if (!town.granitPrimary) {
      try {
        let pageNum = 1, totalKnown = Infinity;
        while (townRaw.length < totalKnown && pageNum <= 20) {
          const eps = buildEndpoints(town, pageNum, 100);
          const { data, endpointIndex } = await tryEndpoints(eps, { startIndex:lastWorking, name:`assessor-${town.slug}` });
          lastWorking = endpointIndex;
          const norm  = normalizeRows(data);
          const rows  = norm.rows;
          const total = norm.total;
          if (pageNum === 1) { totalKnown = total; console.log(`    VGSI ${town.label}: ${total} parcels`); }
          townRaw.push(...rows.filter(r => r.address && r.yearBuilt >= BUILT_FROM && r.yearBuilt <= BUILT_TO));
          if (rows.length < 100) break;
          pageNum++;
          await new Promise(r => setTimeout(r, 120));
        }
        anySuccess = true;
      } catch(err) {
        console.warn(`    VGSI ${town.label} failed (${err.message}) — trying GRANIT fallback`);
      }
    }

    // ── 4a: GRANIT fallback if VGSI returned nothing ──────────
    if (townRaw.length === 0) {
      try {
        const granitParcels = await scanGranitForTown(town, { activeStormZones });
        if (granitParcels.length > 0) {
          // GRANIT parcels are already fully built lead objects — push directly
          allParcels.push(...granitParcels);
          granitFills++;
          anySuccess = true;
          console.log(`    ✓ GRANIT filled ${town.label}: ${granitParcels.length} parcels`);
          await new Promise(r => setTimeout(r, 300));
          continue; // skip the VGSI geocode+assemble path below
        }
      } catch(e) {
        console.warn(`    GRANIT ${town.label} also failed: ${e.message}`);
      }
    }

    if (!townRaw.length) {
      console.log(`    ${town.label}: 0 parcels from both VGSI and GRANIT`);
      continue;
    }

    // ── Geocode VGSI rows ─────────────────────────────────────
    let geoR = {};
    if (geocode) {
      const toGeo = townRaw.map(p => ({
        address:  p.address,
        city:     town.label.replace(/, NH$|, MA$/, ""),
        state:    town.state,
        zip:      town.zip,
        townSlug: town.slug,
      }));
      geoR = await geocodeBatch(toGeo);
    }

    for (let i = 0; i < townRaw.length; i++) {
      const p        = townRaw[i];
      const geo      = geoR[i] || null;
      const lat      = geo?.lat ?? (town.lat + (Math.random()-0.5)*0.03);
      const lng      = geo?.lng ?? (town.lng + (Math.random()-0.5)*0.03);
      const stormHit = isInStormZone(lat, lng, activeStormZones);
      const tenure   = ownerTenure(p.yearBuilt, p.lastSale);

      allParcels.push({
        id:           `vgsi-${town.slug}-${p.parcelId}`,
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
        source:       "VGSI Assessor",
        sourceUrl:    `https://gis.vgsi.com/${town.slug}/`,
        coordSource:  geo?.source || "centroid",
        parcelId:     p.parcelId,
        stormHit,
        inSubdivision: false,
        contact:      false,
        foundAt:      new Date().toISOString(),
      });
    }
    await new Promise(r => setTimeout(r, 300));
  }

  // ── SUBDIVISION DETECTION ─────────────────────────────────────
  console.log(`\n  Running subdivision detection on ${allParcels.length} parcels...`);
  console.log(`  (${granitFills} town(s) provided by GRANIT fallback)`);

  const subdivisions = detectSubdivisions(allParcels, {
    activeStormZones,
    isInStormZoneFn: isInStormZone,
    townLat: 42.95,   // shifted north slightly to center the expanded territory
    townLng: -71.52,
  });

  const subdivIds = new Set(subdivisions.flatMap(s => s.parcelIds || []));

  // ── SCORE ALL PARCELS ─────────────────────────────────────────
  const finalLeads = allParcels.map(p => {
    const inS    = subdivIds.has(p.id);
    const score  = scoreParcel({ built:p.built, lastSale:p.lastSale, inSubdivision:inS, stormHit:p.stormHit });
    const reason = buildReason(p.built, p.lastSale, inS, p.stormHit);
    const tags   = ["age"];
    if (inS)        tags.push("subdivision");
    if (p.stormHit) tags.push("storm");
    return { ...p, score, reason, tags, inSubdivision:inS };
  });

  if (anySuccess) {
    await saveLastEndpoint("assessor", lastWorking);
    await markSuccess("assessor", finalLeads.length + subdivisions.length, lastWorking);
  } else {
    await markFailure("assessor", "All towns failed", lastWorking);
  }

  const vgsiCount   = finalLeads.filter(p => p.source === "VGSI Assessor").length;
  const granitCount = finalLeads.filter(p => p.source === "NH GRANIT").length;
  console.log(`  Assessor total: ${finalLeads.length} parcels (${vgsiCount} VGSI + ${granitCount} GRANIT) + ${subdivisions.length} subdivisions`);

  return { parcels: finalLeads, subdivisions };
}
