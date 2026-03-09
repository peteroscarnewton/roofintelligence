// api/scanner-reddit.js v6.1
// --------------------------
// Expanded: 12 subreddits × 14 search terms = 168 API calls per scan.
// National subreddits use strict territory filtering so they don't flood with noise.
// Local NH subs (nashua, newhampshire, etc.) are always relevant, no filter needed.

import { tryEndpoints, getLastEndpoint, saveLastEndpoint } from "./resilient-fetch.js";
import { markSuccess, markFailure } from "./health.js";

// ── SUBREDDITS ────────────────────────────────────────────────
// local:true  = NH/MA focused, every post is potentially relevant
// local:false = national/regional, requires strict territory keyword match
const SUBREDDITS = [
  // Local NH — no territory filter needed
  { name:"nashua",             local:true  },
  { name:"newhampshire",       local:true  },
  { name:"manchester_nh",      local:true  },
  { name:"frugalnh",           local:true  },
  { name:"merrimacknh",        local:true  },
  // Regional — filter to NH/MA mentions
  { name:"newengland",         local:false },
  { name:"massachusetts",      local:false },
  { name:"boston",             local:false }, // catches Chelmsford, Dracut, Lowell area
  // National — strict filter, only named NH/MA city gets through
  { name:"HomeImprovement",    local:false },
  { name:"DIY",                local:false },
  { name:"FirstTimeHomeBuyer", local:false },
  { name:"RealEstate",         local:false },
];

// ── SEARCH TERMS ──────────────────────────────────────────────
// Intent-focused: people actively looking to hire + damage signals
const SEARCHES = [
  // Actively looking to hire
  "roofer nh",
  "roofing contractor",
  "need a roofer",
  "roof replacement nh",
  // Damage signals — homeowner just discovered a problem
  "roof repair",
  "ice dam",
  "roof leak",
  "missing shingles",
  "wind damage roof",
  "hail damage",
  // Life events that lead to roof work
  "new roof",
  "buying house roof",
  "home inspection roof",
  "storm damage",
];

// For local subs: any of these = in territory
const TERRITORY_LOOSE = [
  "nashua","manchester","bedford","amherst","milford","merrimack","hollis",
  "derry","londonderry","hudson","windham","pelham","chelmsford","lowell","dracut",
  "tyngsborough","goffstown","litchfield","brookline",
  " nh ","new hampshire","southern nh",
];

// For national subs: must match a specific NH/MA city name or state
const TERRITORY_STRICT = [
  "nashua","manchester","bedford","amherst","milford","merrimack","hollis",
  "derry","londonderry","hudson","windham","pelham","chelmsford","lowell","dracut",
  "new hampshire"," nh,","nh 0",
];

const HIGH_INTENT = [
  "recommend","looking for","need a roofer","hire","who does","good contractor",
  "estimate","quote","can anyone suggest","best roofer","reputable",
];
const MEDIUM_INTENT = [
  "roof damage","ice dam","leaking","shingles","storm damage",
  "roof is","my roof","the roof","new roof","replace the roof",
];

function isTerritory(text, strict) {
  const lower = text.toLowerCase();
  const list = strict ? TERRITORY_STRICT : TERRITORY_LOOSE;
  return list.some(c => lower.includes(c));
}

function scorePost(title, body, isLocal) {
  const text = (title + " " + body).toLowerCase();
  let s = isLocal ? 44 : 38; // local subs start higher

  if (HIGH_INTENT.some(k => text.includes(k)))  s += 28;
  if (MEDIUM_INTENT.some(k => text.includes(k))) s += 15;
  if (/urgent|asap|emergency|leaking now|roof is leaking/.test(text)) s += 20;
  if (/storm|hail|wind damage/.test(text)) s += 12;
  // Bonus for naming a specific local town
  if (/bedford|amherst|milford|merrimack|windham|londonderry|derry|hollis/.test(text)) s += 10;
  if (/nashua|manchester/.test(text)) s += 6;

  return Math.min(s, 92);
}

function detectCity(text) {
  const lower = text.toLowerCase();
  const cityCoords = {
    "bedford":     [42.9512,-71.5151], "amherst":    [42.8612,-71.5975],
    "nashua":      [42.7654,-71.4676], "manchester":  [42.9956,-71.4548],
    "merrimack":   [42.8651,-71.4964], "milford":     [42.8393,-71.6495],
    "hollis":      [42.7462,-71.5864], "derry":       [42.8812,-71.3264],
    "londonderry": [42.8651,-71.3737], "hudson":      [42.7651,-71.4376],
    "windham":     [42.8062,-71.2964], "pelham":      [42.7312,-71.3337],
    "goffstown":   [43.0126,-71.5876], "litchfield":  [42.8262,-71.4764],
    "chelmsford":  [42.5993,-71.3673], "lowell":      [42.6354,-71.3165],
    "dracut":      [42.6759,-71.3037], "tyngsborough":[42.6726,-71.4264],
  };
  for (const [city, coords] of Object.entries(cityCoords)) {
    if (lower.includes(city)) {
      const state = ["chelmsford","lowell","dracut","tyngsborough"].includes(city) ? "MA" : "NH";
      return { city:`${city.charAt(0).toUpperCase()+city.slice(1)}, ${state}`, coords };
    }
  }
  return { city:"Southern NH", coords:[42.87,-71.52] };
}

function buildEndpoints(subName, query) {
  return [
    {
      label:"Reddit .json",
      url:`https://www.reddit.com/r/${subName}/search.json?q=${encodeURIComponent(query)}&sort=new&limit=15&restrict_sr=true&t=month`,
      headers:{"User-Agent":"RoofIntelligenceAI/6.1"},
      validate:(d)=>{
        if (Array.isArray(d?.data?.children)) return null;
        if (d?.error===429 || d?.message?.includes("rate")) return "Rate limited";
        return "No children array";
      },
    },
    {
      label:"old.reddit .json",
      url:`https://old.reddit.com/r/${subName}/search.json?q=${encodeURIComponent(query)}&sort=new&limit=15&restrict_sr=true&t=month`,
      headers:{"User-Agent":"RoofIntelligenceAI/6.1"},
      validate:(d)=>Array.isArray(d?.data?.children)?null:"No children",
    },
    {
      label:"Arctic Shift archive",
      url:`https://arctic-shift.photon-reddit.com/api/posts/search?subreddit=${subName}&q=${encodeURIComponent(query)}&limit=15&after=${Math.floor(Date.now()/1000)-(30*24*3600)}`,
      headers:{"User-Agent":"RoofIntelligenceAI/6.1"},
      validate:(d)=>Array.isArray(d?.data)||Array.isArray(d?.posts)?null:"No data",
    },
  ];
}

export async function scanReddit() {
  const leads = [];
  const seen = new Set();
  const startIdx = await getLastEndpoint("reddit");
  let lastWorking = startIdx, anySuccess = false;

  const totalCalls = SUBREDDITS.length * SEARCHES.length;
  console.log(`  Reddit: ${SUBREDDITS.length} subreddits × ${SEARCHES.length} searches = ${totalCalls} queries`);

  for (const sub of SUBREDDITS) {
    let subHits = 0;
    for (const query of SEARCHES) {
      try {
        const { data, endpointIndex, label } = await tryEndpoints(
          buildEndpoints(sub.name, query),
          { startIndex:lastWorking, name:`reddit-${sub.name}` }
        );
        lastWorking = endpointIndex;
        anySuccess = true;

        const posts = Array.isArray(data?.data?.children)
          ? data.data.children.map(c => c.data)
          : (data?.data ?? data?.posts ?? []);

        for (const d of posts) {
          if (seen.has(d.id)) continue;
          seen.add(d.id);

          const title = d.title || "";
          const body  = d.selftext || "";
          const fullText = title + " " + body;

          // Territory check — strict for national subs
          if (!isTerritory(fullText, !sub.local)) continue;

          const score = scorePost(title, body, sub.local);
          if (score < 50) continue; // skip low-intent noise

          const { city, coords } = detectCity(fullText);
          subHits++;
          leads.push({
            id:         `reddit-${d.id}`,
            address:    title.slice(0,70) + (title.length>70?"…":""),
            city:       `r/${sub.name} — ${city}`,
            zip:        "",
            lat:        coords[0],
            lng:        coords[1],
            built:      null,
            type:       "social",
            tags:       ["social"],
            score,
            reason:     `r/${sub.name}: "${title.slice(0,100)}"`,
            source:     `Reddit [${label}]`,
            sourceUrl:  `https://reddit.com${d.permalink||""}`,
            author:     d.author   || "",
            upvotes:    d.score    || 0,
            comments:   d.num_comments || 0,
            posted:     d.created_utc
              ? new Date(d.created_utc*1000).toLocaleDateString("en-US",{month:"short",day:"numeric"})
              : "",
            contact:    false,
            foundAt:    new Date().toISOString(),
          });
        }
        // Reddit rate limit: ~1 req/sec to stay polite
        await new Promise(r => setTimeout(r, 1000));
      } catch(err) {
        console.error(`  Reddit r/${sub.name} "${query}" failed:`, err.message);
      }
    }
    if (subHits > 0) console.log(`    r/${sub.name}: ${subHits} leads`);
  }

  if (anySuccess) {
    await saveLastEndpoint("reddit", lastWorking);
    await markSuccess("reddit", leads.length, lastWorking);
  } else {
    await markFailure("reddit", "All subreddits failed", lastWorking);
  }

  console.log(`  Reddit complete: ${leads.length} leads from ${SUBREDDITS.length} subreddits`);
  return leads;
}
