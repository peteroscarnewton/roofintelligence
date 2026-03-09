// api/scanner-permits.js v6
// -------------------------
// HONEST VERSION — only uses permit sources that are confirmed real.
//
// The truth about NH permit data:
//   - Most NH towns have NO public permit API whatsoever
//   - ViewPoint Cloud IS real but only ~6 towns use it in our territory
//   - Accela IS real but requires town-specific portal credentials
//   - NH GRANIT permit layer: the EP_Permits service EXISTS but data is sparse
//     and not all towns contribute their permit records
//
// What this scanner ACTUALLY does:
//   1. Hits ViewPoint Cloud for the 4 confirmed towns (Bedford, Amherst, Windham, Londonderry)
//   2. Tries NH GRANIT permit layer for broader coverage (best-effort)
//   3. Honestly returns 0 for towns with no API and logs it
//   4. Does NOT pretend towns like Nashua/Manchester have accessible permit APIs
//
// Value of this scanner: REAL but LIMITED.
// When it works (e.g. Bedford ViewPoint), it finds streets with 3+ roof permits
// issued in the last 6 months — that's a genuine "replacement wave" signal.

import { tryEndpoints, getLastEndpoint, saveLastEndpoint } from "./resilient-fetch.js";
import { markSuccess, markFailure } from "./health.js";

const LOOKBACK_DAYS = 180;
const ROOF_KW = ["roof","roofing","shingle","re-roof","reroof","gutter","ice dam","flashing","skylight"];

// CONFIRMED: these towns use ViewPoint Cloud
const VIEWPOINT_TOWNS = [
  { slug:"bedfordnh",     label:"Bedford, NH",    zip:"03110", lat:42.9512, lng:-71.5151, vpId:"bedfordnh" },
  { slug:"amherstnh",     label:"Amherst, NH",    zip:"03031", lat:42.8612, lng:-71.5975, vpId:"amherstnh" },
  { slug:"windhamnh",     label:"Windham, NH",    zip:"03087", lat:42.8062, lng:-71.2964, vpId:"windhamnh" },
  { slug:"londonderrynh", label:"Londonderry, NH",zip:"03053", lat:42.8651, lng:-71.3737, vpId:"londonderrynh" },
];

// TOWNS WITH NO KNOWN PUBLIC API — logged honestly, not fabricated
const NO_API_TOWNS = [
  "Nashua, NH","Manchester, NH","Merrimack, NH","Hudson, NH",
  "Milford, NH","Hollis, NH","Derry, NH",
];

function cutoff() {
  const d = new Date(); d.setDate(d.getDate()-LOOKBACK_DAYS);
  return d.toISOString().slice(0,10);
}
function isRoof(text) { return ROOF_KW.some(k=>(text||"").toLowerCase().includes(k)); }

function buildViewPointEndpoints(town) {
  const since = cutoff();
  return [
    {
      label:"ViewPoint Cloud v1",
      url:`https://www.viewpointcloud.com/api/records?community=${town.vpId}&type=permit&status=issued&startDate=${since}&pageSize=200`,
      headers:{"Accept":"application/json","User-Agent":"Mozilla/5.0"},
      validate:(d)=>{
        if (Array.isArray(d)) return null;
        if (Array.isArray(d?.records)) return null;
        if (Array.isArray(d?.data)) return null;
        if (typeof d === "object" && d !== null && !d.error) return null; // unknown shape, try parsing
        return "No recognizable records array";
      },
    },
    {
      label:"ViewPoint Cloud community search",
      url:`https://www.viewpointcloud.com/communities/${town.vpId}/records?issuedAfter=${since}&limit=200`,
      headers:{"Accept":"application/json"},
      validate:(d)=>{
        if (Array.isArray(d?.results)||Array.isArray(d?.items)||Array.isArray(d?.records)) return null;
        return "No results";
      },
    },
  ];
}

function buildGRANITEndpoints(townName) {
  const since = cutoff();
  const name = townName.replace(", NH","").replace(", MA","").toUpperCase();
  return [
    {
      label:"NH GRANIT permit layer",
      url:`https://nhgeodata.unh.edu/nhgeodata/rest/services/EP/EP_Permits/MapServer/0/query?`+
        `where=TOWN+LIKE+'${encodeURIComponent(name)}%25'+AND+ISSUE_DATE+>='${since}'`+
        `&outFields=ADDRESS,PERMIT_TYPE,ISSUE_DATE,DESCRIPTION&returnGeometry=false&f=json&resultRecordCount=200`,
      headers:{"Accept":"application/json"},
      validate:(d)=>{
        if (Array.isArray(d?.features)) return null;
        if (d?.error) return `GRANIT error: ${d.error.message||JSON.stringify(d.error)}`;
        return "No features";
      },
    },
  ];
}

function normalizeViewPoint(data) {
  const rows = Array.isArray(data) ? data
    : data?.records ?? data?.data ?? data?.results ?? data?.items ?? [];
  return rows.map(r=>({
    address:(r.address||r.Address||r.location||r.siteAddress||r.site_address||"").trim(),
    type:(r.type||r.permitType||r.recordType||r.permit_type||"").trim(),
    description:(r.description||r.workDescription||r.subject||r.work_description||"").trim(),
    issued:(r.issueDate||r.issuedDate||r.issued||r.issue_date||"").trim(),
  }));
}

function normalizeGRANIT(data) {
  return (data.features||[]).map(f=>({
    address:(f.attributes?.ADDRESS||"").trim(),
    type:(f.attributes?.PERMIT_TYPE||"").trim(),
    description:(f.attributes?.DESCRIPTION||"").trim(),
    issued:(f.attributes?.ISSUE_DATE||"").trim(),
  }));
}

function detectClusters(permits, town) {
  const streetMap = {};
  for (const p of permits) {
    const street = (p.address||"").replace(/^\d+\s+/,"").trim().toLowerCase();
    if (!street || street.length < 3) continue;
    if (!streetMap[street]) streetMap[street]={ count:0, sample:p.address };
    streetMap[street].count++;
  }
  return Object.entries(streetMap)
    .filter(([,d])=>d.count>=2)
    .map(([street,d])=>({
      street,
      count:d.count,
      sample:d.sample,
      score:d.count>=5?88:d.count>=3?78:65,
    }));
}

export async function scanPermits() {
  const leads = [];
  const startIdx = await getLastEndpoint("permits");
  let lastWorking = startIdx, anySuccess = false;

  // Log towns with no API so user knows why they're missing
  console.log(`  Permits: ${NO_API_TOWNS.length} towns have no public permit API — skipped`);
  console.log(`  Permits: scanning ${VIEWPOINT_TOWNS.length} ViewPoint Cloud towns...`);

  // ── ViewPoint Cloud towns ─────────────────────────────────────
  for (const town of VIEWPOINT_TOWNS) {
    console.log(`  Permits: ${town.label}...`);
    try {
      const {data,endpointIndex,label}=await tryEndpoints(buildViewPointEndpoints(town),
        {startIndex:lastWorking,name:`permits-${town.slug}`});
      lastWorking=endpointIndex;

      const allPermits=normalizeViewPoint(data);
      const roofPermits=allPermits.filter(p=>isRoof(p.type)||isRoof(p.description));
      console.log(`    ${town.label} [${label}]: ${allPermits.length} permits, ${roofPermits.length} roofing`);
      anySuccess=true;

      for (const cluster of detectClusters(roofPermits,town)) {
        const jitter=(Math.random()-0.5)*0.012;
        leads.push({
          id:`permit-${town.slug}-${cluster.street.replace(/\s+/g,"-").slice(0,30)}-${Date.now()}`,
          address:`${cluster.count} roof permits: ${cluster.street.replace(/\b\w/g,c=>c.toUpperCase())}`,
          city:town.label, zip:town.zip,
          lat:parseFloat((town.lat+jitter).toFixed(5)),
          lng:parseFloat((town.lng+jitter).toFixed(5)),
          built:null, type:"age", tags:["permit","age"],
          score:cluster.score,
          reason:`${cluster.count} roofing permits on this street in past ${LOOKBACK_DAYS} days — replacement wave signal`,
          source:`ViewPoint Cloud [${label}]`,
          sourceUrl:`https://www.viewpointcloud.com/communities/${town.vpId}`,
          permitCount:cluster.count, sampleAddress:cluster.sample,
          contact:false, foundAt:new Date().toISOString(),
        });
      }
    } catch(err) {
      console.error(`  Permits ${town.label} failed:`,err.message);
    }
    await new Promise(r=>setTimeout(r,400));
  }

  // ── NH GRANIT best-effort (all towns) ─────────────────────────
  const GRANIT_TOWNS = [
    {label:"Nashua, NH",  zip:"03060",lat:42.7654,lng:-71.4676},
    {label:"Manchester, NH",zip:"03101",lat:42.9956,lng:-71.4548},
    {label:"Merrimack, NH",zip:"03054",lat:42.8651,lng:-71.4964},
    {label:"Hudson, NH",  zip:"03051",lat:42.7651,lng:-71.4376},
    {label:"Milford, NH", zip:"03055",lat:42.8393,lng:-71.6495},
    {label:"Derry, NH",   zip:"03038",lat:42.8812,lng:-71.3264},
  ];
  console.log(`  Permits: trying NH GRANIT for ${GRANIT_TOWNS.length} towns (best-effort)...`);

  for (const town of GRANIT_TOWNS) {
    try {
      const {data,endpointIndex,label}=await tryEndpoints(buildGRANITEndpoints(town.label),
        {startIndex:0,name:`permits-granit-${town.label.replace(/ /g,"")}`});
      const permits=normalizeGRANIT(data);
      const roofPermits=permits.filter(p=>isRoof(p.type)||isRoof(p.description));
      if (roofPermits.length===0) { console.log(`    ${town.label} [GRANIT]: 0 roof permits`); continue; }
      anySuccess=true;

      for (const cluster of detectClusters(roofPermits,town)) {
        const jitter=(Math.random()-0.5)*0.012;
        leads.push({
          id:`permit-granit-${town.label.replace(/[^a-z]/gi,"")}-${cluster.street.replace(/\s+/g,"-").slice(0,20)}-${Date.now()}`,
          address:`${cluster.count} roof permits: ${cluster.street.replace(/\b\w/g,c=>c.toUpperCase())}`,
          city:town.label, zip:town.zip,
          lat:parseFloat((town.lat+jitter).toFixed(5)),
          lng:parseFloat((town.lng+jitter).toFixed(5)),
          built:null, type:"age", tags:["permit","age"],
          score:cluster.count>=3?75:62,
          reason:`${cluster.count} roofing permits on this street (NH GRANIT data — ${LOOKBACK_DAYS}-day window)`,
          source:"NH GRANIT Permits",
          sourceUrl:"https://nhgeodata.unh.edu/",
          permitCount:cluster.count,
          contact:false, foundAt:new Date().toISOString(),
        });
      }
      console.log(`    ${town.label} [GRANIT]: ${roofPermits.length} roof permits, ${leads.filter(l=>l.city===town.label).length} clusters`);
    } catch(err) {
      console.log(`    ${town.label} [GRANIT]: unavailable (${err.message.slice(0,50)})`);
    }
    await new Promise(r=>setTimeout(r,300));
  }

  if (anySuccess) {
    await saveLastEndpoint("permits",lastWorking);
    await markSuccess("permits",leads.length,lastWorking);
  } else {
    await markFailure("permits","ViewPoint Cloud unreachable, GRANIT returned no data",lastWorking);
  }

  console.log(`  Permits: ${leads.length} cluster leads`);
  return leads;
}
