// api/scanner-noaa.js v6
// CONFIRMED WORKING: api.weather.gov is a real public API, no key required.
// Returns GeoJSON alerts for NH/MA/ME. Filters for wind/storm events relevant
// to roof damage, maps them to territory zip codes.

import { tryEndpoints, getLastEndpoint, saveLastEndpoint } from "./resilient-fetch.js";
import { markSuccess, markFailure } from "./health.js";

const STATES = ["NH", "MA", "ME"];

const ROOFING_EVENTS = [
  "High Wind Warning","High Wind Watch","Severe Thunderstorm Warning",
  "Severe Thunderstorm Watch","Wind Advisory","Tornado Warning","Tornado Watch",
  "Winter Storm Warning","Ice Storm Warning","Blizzard Warning",
  "Special Weather Statement",
];

const BASE_SCORES = {
  "Tornado Warning":95,"High Wind Warning":90,"Ice Storm Warning":85,
  "Severe Thunderstorm Warning":85,"Tornado Watch":78,"Blizzard Warning":75,
  "High Wind Watch":75,"Winter Storm Warning":72,"Severe Thunderstorm Watch":68,
  "Wind Advisory":62,"Special Weather Statement":52,
};

// NOAA zone → center coordinates (from NOAA zone definition files)
const ZONE_CENTERS = {
  "NHZ012":[42.93,-71.55],"NHZ013":[42.97,-71.37],"NHZ014":[42.77,-71.57],
  "NHZ015":[42.95,-71.30],"NHZ016":[43.00,-70.98],"NHZ017":[42.77,-71.18],
  "NHZ008":[43.55,-71.85],"NHZ009":[43.22,-71.68],"NHZ010":[43.52,-71.48],
  "NHZ011":[43.55,-71.15],"MAZ003":[42.65,-71.35],"MAZ004":[42.63,-71.10],
  "MAZ010":[42.47,-71.37],"MAZ013":[42.62,-71.55],
};

const TERRITORY_ZONES = new Set([
  "NHZ012","NHZ013","NHZ014","NHZ015","NHZ016","NHZ017",
  "NHZ008","NHZ009","MAZ003","MAZ004","MAZ010","MAZ013",
]);

const TERRITORY_KEYWORDS = [
  "hillsborough","rockingham","merrimack","bedford","amherst","nashua",
  "manchester","derry","londonderry","windham","hollis","milford","hudson",
  "chelmsford","lowell","dracut","middlesex",
];

function buildEndpoints(state) {
  return [
    {
      label:"NOAA API v1 active alerts",
      url:`https://api.weather.gov/alerts/active?area=${state}`,
      headers:{"User-Agent":"RoofIntelligenceAI/6.0 contact@adamvaillancourt.com","Accept":"application/geo+json"},
      validate:(d)=>Array.isArray(d?.features)?null:"Missing features array",
    },
    {
      label:"NOAA API all alerts filtered",
      url:`https://api.weather.gov/alerts?area=${state}&status=actual&message_type=alert`,
      headers:{"User-Agent":"RoofIntelligenceAI/6.0","Accept":"application/geo+json"},
      validate:(d)=>Array.isArray(d?.features)?null:"Missing features",
    },
  ];
}

function isTerritory(areaDesc, zoneIds) {
  if (zoneIds.some(z=>TERRITORY_ZONES.has(z))) return true;
  const lower=(areaDesc||"").toLowerCase();
  return TERRITORY_KEYWORDS.some(t=>lower.includes(t));
}

function coordsForZones(zoneIds, areaDesc) {
  for (const z of zoneIds) { if (ZONE_CENTERS[z]) return ZONE_CENTERS[z]; }
  const lower=(areaDesc||"").toLowerCase();
  if (lower.includes("hillsborough")) return [42.93,-71.52];
  if (lower.includes("rockingham"))   return [42.95,-71.28];
  if (lower.includes("merrimack"))    return [43.22,-71.68];
  if (lower.includes("middlesex"))    return [42.65,-71.35];
  return [42.87,-71.52];
}

export async function scanNOAA() {
  const allLeads=[], allZones=new Set();
  const startIdx=await getLastEndpoint("noaa");
  let lastWorking=startIdx, anySuccess=false;
  const seen=new Set();

  for (const state of STATES) {
    try {
      const {data,endpointIndex,label}=await tryEndpoints(buildEndpoints(state),
        {startIndex:lastWorking,name:`noaa-${state}`});
      lastWorking=endpointIndex;
      anySuccess=true;

      let count=0;
      for (const feature of data.features||[]) {
        const props=feature.properties||{};
        const event=props.event||"";
        const alertId=feature.id||String(Math.random());
        if (seen.has(alertId)) continue;
        seen.add(alertId);
        if (!ROOFING_EVENTS.some(e=>event.includes(e))) continue;

        const areaDesc=props.areaDesc||"";
        const zoneIds=(props.affectedZones||[]).map(z=>z.split("/").pop()).filter(Boolean);
        if (!isTerritory(areaDesc,zoneIds)) continue;

        zoneIds.filter(z=>TERRITORY_ZONES.has(z)).forEach(z=>allZones.add(z));
        const [lat,lng]=coordsForZones(zoneIds,areaDesc);
        let score=BASE_SCORES[event]||55;
        if (props.severity==="Extreme") score=Math.min(score+10,99);
        if (props.severity==="Severe")  score=Math.min(score+5,99);
        if (props.certainty==="Likely") score=Math.min(score+5,99);

        allLeads.push({
          id:`noaa-${String(alertId).slice(-14)}`,
          address:`Alert Zone: ${areaDesc.slice(0,70)}`,
          city:areaDesc.split(";")[0]?.split(",")[0]?.trim()||"NH/MA",
          zip:"",
          lat:parseFloat(lat.toFixed(4)), lng:parseFloat(lng.toFixed(4)),
          built:null, type:"storm", tags:["storm"],
          score,
          reason:`${event} — ${(props.headline||"").slice(0,130)}`,
          source:"NOAA Weather API", sourceUrl:"https://www.weather.gov/",
          severity:props.severity, certainty:props.certainty,
          affectedZones:zoneIds,
          contact:false, foundAt:new Date().toISOString(),
        });
        count++;
      }
      console.log(`  NOAA ${state} [${label}]: ${count} territory alerts`);
    } catch(err) {
      console.error(`  NOAA ${state} failed:`,err.message);
    }
  }

  if (anySuccess) {
    await saveLastEndpoint("noaa",lastWorking);
    await markSuccess("noaa",allLeads.length,lastWorking);
  } else {
    await markFailure("noaa","All states failed",lastWorking);
  }

  return { leads:allLeads, activeZoneCodes:Array.from(allZones) };
}
