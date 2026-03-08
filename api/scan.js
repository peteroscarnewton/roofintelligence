// api/scan.js v7 — Phase 4a + 4b
import { kv } from "@vercel/kv";
import { scanNOAA }     from "./scanner-noaa.js";
import { scanAssessor } from "./scanner-assessor.js";
import { scanPermits }  from "./scanner-permits.js";
import { scanRedfin }   from "./scanner-redfin.js";

export default async function handler(req, res) {
  if (req.method!=="GET" && req.method!=="POST")
    return res.status(405).json({error:"Method not allowed"});

  const start=Date.now();
  console.log(`\n=== Roof Intelligence v7 Scan: ${new Date().toISOString()} ===`);
  console.log(`Territory: 23 towns — Southern NH + Northern MA`);
  console.log(`Primary: VGSI assessor (18 towns) + NH GRANIT fallback (5 new towns)`);
  console.log(`Supplemental: NOAA storm alerts, Redfin stale listings, permit clusters`);

  // 1. NOAA first — storm zones feed into assessor scoring
  console.log("\n[1/5] NOAA weather alerts...");
  let noaaLeads=[], activeZones=[];
  try {
    const r=await scanNOAA();
    noaaLeads=r.leads; activeZones=r.activeZoneCodes;
    console.log(`  → ${noaaLeads.length} storm leads, ${activeZones.length} active zones`);
  } catch(e) { console.error("NOAA fatal:",e.message); }

  // 2. Assessor — VGSI primary, GRANIT fallback for zero-return towns + 5 new towns
  console.log("\n[2/5] Assessor scan (VGSI primary + GRANIT fallback)...");
  let parcels=[], subdivisions=[];
  try {
    const r=await scanAssessor({activeStormZones:activeZones,geocode:true});
    parcels=r.parcels||[]; subdivisions=r.subdivisions||[];
    console.log(`  → ${parcels.length} parcels, ${subdivisions.length} subdivisions detected`);
  } catch(e) { console.error("Assessor fatal:",e.message); }

  // 3. Supplemental scanners in parallel
  console.log("\n[3-4/4] Permits, Redfin (supplemental)...");
  const [permitLeads,redfinLeads] =
    await Promise.allSettled([scanPermits(),scanRedfin()])
    .then(rs=>rs.map((r,i)=>{
      if(r.status==="fulfilled") return r.value;
      console.error(["permits","redfin"][i],"fatal:",r.reason?.message);
      return [];
    }));

  // Count GRANIT parcels separately for logging
  const granitCount  = parcels.filter(p=>p.source==="NH GRANIT").length;
  const vgsiCount    = parcels.filter(p=>p.source==="VGSI Assessor").length;

  console.log(`\n--- Source breakdown ---`);
  console.log(`  NOAA storm:          ${noaaLeads.length}`);
  console.log(`  Subdivisions:        ${subdivisions.length} (covering ~${subdivisions.reduce((s,d)=>s+d.houseCount,0)} homes)`);
  console.log(`  VGSI parcels:        ${vgsiCount}`);
  console.log(`  GRANIT parcels:      ${granitCount}`);
  console.log(`  Permit clusters:     ${permitLeads.length}`);
  console.log(`  Redfin listings:     ${redfinLeads.length}`);

  // Deduplicate — subdivisions first (highest value)
  const seen=new Set();
  const deduped=[
    ...noaaLeads,...subdivisions,...parcels,...permitLeads,...redfinLeads
  ].filter(l=>{
    const key=String(l.id);
    if(seen.has(key)) return false;
    seen.add(key); return true;
  });

  // Merge contact statuses
  try {
    for(let i=0;i<deduped.length;i+=100) {
      const chunk=deduped.slice(i,i+100);
      const values=await kv.mget(...chunk.map(l=>`contact:${l.id}`));
      values.forEach((v,j)=>{if(v){deduped[i+j].contact=v.contacted??false;deduped[i+j].contactedAt=v.updatedAt??null;}});
    }
  } catch(e) { console.error("Contact merge:",e.message); }

  deduped.sort((a,b)=>b.score-a.score);

  const payload={
    generated:new Date().toISOString(),
    scanDurationMs:Date.now()-start,
    total:deduped.length,
    storm_count:     deduped.filter(l=>l.type==="storm").length,
    age_count:       deduped.filter(l=>l.type==="age").length,
    realestate_count:deduped.filter(l=>l.type==="realestate").length,
    social_count:    deduped.filter(l=>l.type==="social").length,
    sources:{
      noaa:        noaaLeads.length,
      subdivisions:subdivisions.length,
      assessor:    vgsiCount,
      granit:      granitCount,
      permits:     permitLeads.length,
      redfin:      redfinLeads.length,
    },
    subdivisionHomesTotal: subdivisions.reduce((s,d)=>s+d.houseCount,0),
    activeStormZones:activeZones,
    leads:deduped,
  };

  await kv.set("leads",payload,{ex:60*60*26});

  const duration=((Date.now()-start)/1000).toFixed(1);
  console.log(`\n=== Scan complete: ${deduped.length} total leads in ${duration}s ===\n`);

  return res.status(200).json({
    ok:true,count:deduped.length,sources:payload.sources,
    subdivisionHomesTotal:payload.subdivisionHomesTotal,
    activeStormZones:activeZones,generated:payload.generated,
    durationSeconds:parseFloat(duration),
  });
}
