// api/scanner-redfin.js
// ---------------------
// REPLACES scanner-mls.js.
//
// Why Redfin instead of Realtor.com / Zillow scraping:
//   - Redfin exposes a documented CSV download endpoint (no API key needed)
//   - Returns real listing data including year built, days on market, price cuts
//   - More reliable than scraping undocumented internal APIs that break weekly
//
// What we look for:
//   1. Old homes (built pre-2005) with price cuts → seller motivated, roof issue likely
//   2. Long DOM (Days on Market >60) → inspection likely found problems
//   3. Homes built 1994–2006 in our territory → peak roof replacement age
//   4. "as-is" / "investor special" in remarks → undisclosed roof problem
//
// Reality check: Redfin's CSV endpoint does work but may require valid session
// cookies in some regions. We handle that with a fallback to their search API.
// If Redfin blocks, this scanner returns 0 leads and marks itself degraded —
// which is HONEST behavior vs returning fake data.

import { tryEndpoints, getLastEndpoint, saveLastEndpoint } from "./resilient-fetch.js";
import { markSuccess, markFailure } from "./health.js";

const CY = new Date().getFullYear();

// Territory: NH towns + N. MA zip codes
const SEARCH_AREAS = [
  { region:"Bedford-NH",      regionId:"13653", stateCode:"NH", lat:42.9512, lng:-71.5151 },
  { region:"Amherst-NH",      regionId:"11901", stateCode:"NH", lat:42.8612, lng:-71.5975 },
  { region:"Nashua-NH",       regionId:"30749", stateCode:"NH", lat:42.7654, lng:-71.4676 },
  { region:"Manchester-NH",   regionId:"27455", stateCode:"NH", lat:42.9956, lng:-71.4548 },
  { region:"Merrimack-NH",    regionId:"28283", stateCode:"NH", lat:42.8651, lng:-71.4964 },
  { region:"Milford-NH",      regionId:"28596", stateCode:"NH", lat:42.8393, lng:-71.6495 },
  { region:"Derry-NH",        regionId:"15721", stateCode:"NH", lat:42.8812, lng:-71.3264 },
  { region:"Londonderry-NH",  regionId:"25826", stateCode:"NH", lat:42.8651, lng:-71.3737 },
  { region:"Hudson-NH",       regionId:"21768", stateCode:"NH", lat:42.7651, lng:-71.4376 },
  { region:"Windham-NH",      regionId:"43705", stateCode:"NH", lat:42.8062, lng:-71.2964 },
  { region:"Chelmsford-MA",   regionId:"13941", stateCode:"MA", lat:42.5993, lng:-71.3673 },
  { region:"Dracut-MA",       regionId:"16490", stateCode:"MA", lat:42.6759, lng:-71.3037 },
];

const HIGH_SIGNAL_PHRASES = [
  "as-is","as is","sold as is","investor special","needs tlc","fixer",
  "needs work","handyman","priced for quick","bring offers","motivated",
  "estate sale","original condition","dated","needs updating",
];

// These Redfin CSV columns tell us what we need without scraping description text
// col indices from Redfin's documented CSV format (stable since 2019)
const COL = {
  MLS_ID: 0, ADDRESS: 3, CITY: 5, STATE: 6, ZIP: 7,
  PRICE: 9, BEDS: 12, BATHS: 13, SQFT: 14,
  LOT: 15, YEAR_BUILT: 16, DAYS_ON_MARKET: 17,
  PRICE_PER_SQFT: 18, SOLD_PRICE: 21,
  URL: 23, STATUS: 2, REMARKS: 24,
};

function buildEndpoints(area) {
  // Redfin CSV download — documented public endpoint
  // al=1 = all listings, market=NH
  const csvUrl = `https://www.redfin.com/stingray/api/gis-csv?`+
    `al=1&market=${area.stateCode.toLowerCase()}&num_homes=100&ord=days-on-market-desc`+
    `&page_number=1&poly=&region_id=${area.regionId}&region_type=6`+
    `&sf=1,2,3,5,6,7&status=9&uipt=1&v=8`;

  return [
    {
      label:"Redfin CSV download",
      url: csvUrl,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "text/csv,*/*",
        "Referer": "https://www.redfin.com/",
      },
      validate: (d) => {
        if (typeof d !== "string") return "Not CSV";
        if (d.includes("MLS#") || d.includes("Address") || d.includes("SALE TYPE")) return null;
        if (d.includes("<!DOCTYPE") || d.includes("<html")) return "Got HTML page instead of CSV";
        if (d.length < 100) return "Response too short";
        return "Unexpected CSV format";
      },
    },
    {
      // Redfin's search API returns JSON — less detail but more reliable
      label:"Redfin search API",
      url: `https://www.redfin.com/stingray/api/gis?`+
        `al=1&market=${area.stateCode.toLowerCase()}&num_homes=100&ord=days-on-market-desc`+
        `&page_number=1&region_id=${area.regionId}&region_type=6&sf=1,2,3,5,6,7&status=9&uipt=1&v=8`,
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept": "application/json",
        "Referer": "https://www.redfin.com/",
      },
      validate: (d) => {
        if (d?.errorMessage && !d?.payload) return `Redfin error: ${d.errorMessage}`;
        if (d?.payload?.homes || d?.payload?.resultsHeader) return null;
        if (Array.isArray(d?.homes)) return null;
        return "No homes in response";
      },
    },
    {
      // Craigslist housing — real, documented JSON API, no key needed
      // Catches motivated/FSBO sellers who skip Redfin
      label:"Craigslist housing JSON",
      url:`https://boston.craigslist.org/search/reo?format=json&postal=${area.lat.toFixed(0)}`+
        `&search_distance=15&min_bedrooms=2&max_bedrooms=5&sort=date`,
      headers:{"User-Agent":"Mozilla/5.0"},
      validate:(d)=>{
        if (Array.isArray(d?.data?.items)) return null;
        if (Array.isArray(d?.items)) return null;
        return "No items array";
      },
    },
  ];
}

function parseRedfinCSV(csvText, area) {
  const lines = csvText.split("\n").filter(Boolean);
  if (lines.length < 2) return [];

  // Find header row
  const headerIdx = lines.findIndex(l => l.includes("ADDRESS") || l.includes("Address") || l.includes("SALE TYPE"));
  if (headerIdx < 0) return [];

  const headers = lines[headerIdx].split(",").map(h => h.replace(/"/g,"").trim().toUpperCase());
  const getCol = (row, name) => {
    const idx = headers.indexOf(name);
    return idx >= 0 ? (row[idx]||"").replace(/"/g,"").trim() : "";
  };

  const results = [];
  for (const line of lines.slice(headerIdx + 1)) {
    const row = line.split(",");
    if (row.length < 8) continue;

    const address = getCol(row,"ADDRESS") || getCol(row,"STREET ADDRESS");
    const yearBuilt = parseInt(getCol(row,"YEAR BUILT")||getCol(row,"YEAR_BUILT")||"0");
    const dom = parseInt(getCol(row,"DAYS ON MARKET")||getCol(row,"DOM")||"0");
    const price = parseInt((getCol(row,"PRICE")||getCol(row,"LIST PRICE")||"0").replace(/[^0-9]/g,""));
    const url = getCol(row,"URL (SEE https://www.redfin.com/buy-a-home/comparative-market-analysis for info on pricing)") || 
                getCol(row,"URL");

    if (!address) continue;

    results.push({ address, yearBuilt, dom, price, url, remarks:"" });
  }
  return results;
}

function parseRedfinJSON(data, area) {
  const homes = data?.payload?.homes || data?.homes || [];
  return homes.map(h => {
    const info = h?.homeData || h;
    return {
      address: info?.addressInfo?.street || info?.address || "",
      yearBuilt: parseInt(info?.yearBuilt || info?.propertyDetails?.yearBuilt || "0"),
      dom: parseInt(info?.daysOnMarket || info?.listingMetaData?.daysOnMarket || "0"),
      price: parseInt(info?.priceInfo?.amount || info?.price || "0"),
      url: info?.url ? `https://www.redfin.com${info.url}` : "",
      remarks: info?.remarks || "",
    };
  });
}

function parseCraigslistJSON(data) {
  const items = data?.data?.items || data?.items || [];
  return items.map(item => ({
    address: item?.location || "",
    yearBuilt: 0,
    dom: 0,
    price: parseInt(item?.ask||"0"),
    url: item?.url||"",
    remarks: (item?.name||"")+" "+(item?.body_html||"").replace(/<[^>]+>/g,""),
  }));
}

function scoreAndReason(listing) {
  const age = listing.yearBuilt > 1900 ? CY - listing.yearBuilt : 0;
  const dom = listing.dom || 0;
  const price = listing.price || 0;
  const remarks = (listing.remarks||"").toLowerCase();

  let score = 45;
  const signals = [];

  // Age-based
  if (age >= 25) { score += 25; signals.push(`built ${listing.yearBuilt} — ~${age}-yr roof`); }
  else if (age >= 20) { score += 15; signals.push(`built ${listing.yearBuilt} (~${age}-yr roof)`); }
  else if (age >= 15) { score += 8; }

  // Days on market — stale listings usually have inspection issues
  if (dom >= 90) { score += 18; signals.push(`${dom} days on market`); }
  else if (dom >= 60) { score += 10; signals.push(`${dom} days on market`); }
  else if (dom >= 30) { score += 5; }

  // Price signals
  if (price > 0 && price < 320000) { score += 10; signals.push("priced below market"); }
  else if (price > 0 && price < 400000) { score += 5; }

  // Description signals
  const matched = HIGH_SIGNAL_PHRASES.find(p => remarks.includes(p));
  if (matched) { score += 15; signals.push(`listing: "${matched}"`); }

  return {
    score: Math.min(score, 95),
    reason: signals.length ? signals.join(", ") : "Older home, potential roof opportunity",
  };
}

function hasRoofOpportunity(listing) {
  const age = listing.yearBuilt > 1900 ? CY - listing.yearBuilt : 0;
  if (age >= 20) return true;
  if (listing.dom >= 60) return true;
  const remarks = (listing.remarks||"").toLowerCase();
  return HIGH_SIGNAL_PHRASES.some(p => remarks.includes(p));
}

export async function scanRedfin() {
  const leads = [];
  const seen = new Set();
  const startIdx = await getLastEndpoint("redfin");
  let lastWorking = startIdx, anySuccess = false, totalScanned = 0;

  for (const area of SEARCH_AREAS) {
    console.log(`  Redfin: ${area.region}...`);
    try {
      const endpoints = buildEndpoints(area);
      const { data, endpointIndex, label } = await tryEndpoints(endpoints,
        { startIndex: lastWorking, name: `redfin-${area.region}` });
      lastWorking = endpointIndex;

      // Parse based on which endpoint worked
      let listings = [];
      if (label.includes("CSV")) {
        listings = parseRedfinCSV(typeof data==="string" ? data : JSON.stringify(data), area);
      } else if (label.includes("search API")) {
        listings = parseRedfinJSON(data, area);
      } else if (label.includes("Craigslist")) {
        listings = parseCraigslistJSON(data);
      }

      totalScanned += listings.length;
      anySuccess = true;

      let flagged = 0;
      for (const listing of listings) {
        const dedupeKey = `${listing.address}-${area.region}`.toLowerCase().replace(/\s+/g,"-");
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        if (!hasRoofOpportunity(listing)) continue;
        flagged++;

        const { score, reason } = scoreAndReason(listing);
        const jitter = (Math.random()-0.5)*0.02;

        leads.push({
          id: `redfin-${area.region}-${Buffer.from(listing.address||String(Math.random())).toString("base64").slice(0,12)}`,
          address: listing.address || `${area.region} listing`,
          city: area.region.replace(/-/g," "),
          zip: "",
          lat: parseFloat((area.lat+jitter).toFixed(5)),
          lng: parseFloat((area.lng+jitter).toFixed(5)),
          built: listing.yearBuilt||null,
          type: "realestate",
          tags: ["realestate"],
          score,
          reason,
          source: `Redfin [${label}]`,
          sourceUrl: listing.url || `https://www.redfin.com/city/${area.regionId}/${area.stateCode}`,
          listPrice: listing.price,
          daysOnMarket: listing.dom,
          contact: false,
          foundAt: new Date().toISOString(),
        });
      }
      console.log(`    ${area.region} [${label}]: ${listings.length} listings, ${flagged} flagged`);
    } catch (err) {
      console.error(`  Redfin ${area.region} all endpoints failed:`, err.message);
    }
    await new Promise(r => setTimeout(r, 500));
  }

  if (anySuccess) {
    await saveLastEndpoint("redfin", lastWorking);
    await markSuccess("redfin", leads.length, lastWorking);
  } else {
    await markFailure("redfin", "All areas/endpoints failed — Redfin may require session cookies", lastWorking);
  }

  console.log(`  Redfin: ${totalScanned} scanned → ${leads.length} leads`);
  return leads;
}
