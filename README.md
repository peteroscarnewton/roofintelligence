# Roof Intelligence v6
## Adam Vaillancourt Roofing — Southern NH Lead Finder

---

## What This Tool Actually Does

### Primary Source — VGSI Assessor (REAL, confirmed working)
- Hits `gis.vgsi.com` for 15 NH towns — this is the real NH CAMA system
- Returns actual parcel records: address, year built, owner sale history
- Filters single-family homes built 1994–2006 (18–30 yr roof age window)
- ~2,000–5,000 real addresses per full scan

### Subdivision Clustering (REAL, address-based algorithm)
- Groups parcels by street name root (e.g. "Ridgewood Dr", "Ridgewood Ct" → same development)
- Finds cohorts built within the same 7-year window
- A cluster of 40 homes built 1997–2001 = one subdivision lead scored 85+
- Works on address strings — does NOT require precise GPS coordinates
- Typical output: 20–80 subdivision clusters covering hundreds of homes

### NOAA Storm Alerts (REAL, confirmed working)
- `api.weather.gov` public API, no key needed
- Filters NH/MA/ME alerts for wind, ice, severe thunderstorm events
- Maps territory impact zones to lead score boost

### Permit Clusters (PARTIAL — 4 of 15 towns)
- ViewPoint Cloud works for: Bedford, Amherst, Windham, Londonderry
- Other NH towns have no public permit API (Nashua, Manchester use Accela which is not publicly accessible)
- NH GRANIT permit layer tried for remaining towns — data is sparse

### Redfin Stale Listings (WORKS IF Redfin doesn't block)
- Redfin has a documented CSV endpoint — real, not scraping
- Looks for: old homes (20+ yr), long DOM (60+ days), motivated seller signals
- May return 0 if Redfin requires session cookies on the server

### Reddit (REAL but LOW VOLUME)
- r/nashua, r/newhampshire, r/manchester_nh, r/frugalnh, r/newengland
- Expect 0–5 high-intent posts per scan — this is normal
- Only high-score posts (50+) are included to reduce noise

---

## Honest Capability Assessment

| Source | Data Quality | Volume | Reliability |
|--------|-------------|--------|-------------|
| VGSI Assessor | ✅ Real parcel data | High (2k–5k/scan) | High |
| Subdivision Detection | ✅ Real algorithm on real data | Medium (20–80 clusters) | High |
| NOAA Alerts | ✅ Confirmed public API | Varies (0–20) | Very High |
| Permit Clusters | ⚠️ 4 towns only | Low (0–15) | Medium |
| Redfin Listings | ⚠️ Works if not blocked | Low–Medium (0–30) | Medium |
| Reddit | ⚠️ Very low volume | Very Low (0–5) | High |

---

## What You Will Realistically Get

After a full scan you should see:
- **20–80 subdivision clusters** like "38 homes on Ridgewood area, built 1999–2002, score 88"
- **500–2,000 individual aging homes** like "12 Ridgewood Dr, Bedford NH, built 2001, score 82"
- **0–20 storm leads** after wind/ice events
- **0–15 permit cluster leads** (Bedford/Amherst area)
- **0–30 Redfin stale listings**
- **0–5 Reddit posts**

The subdivision clusters are the biggest value — they surface entire neighborhoods where roofs are aging together, letting you canvass a whole street efficiently.

---

## Geocoding Reality

- ~100 NH streets pre-cached (instant, no API call)
- Census batch geocoder: 100 addresses per request, ~2–5s per batch
- Nominatim fallback: max 15/scan (1/sec rate limit)
- Remainder: deterministic centroid (same street always same pin, useful for routing)
- Full scan of 2,000 addresses: ~30–60 seconds geocoding time

---

## Deploy

1. Push to private GitHub repo
2. Vercel → New Project → import → deploy
3. Vercel → Storage → Create KV → name `roof-leads` → Connect
4. Visit `yourapp.vercel.app/api/scan` once to seed
5. Auto-scans daily at 7am EST, self-heals broken endpoints at 3am
