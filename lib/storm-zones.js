// api/storm-zones.js
// Shared storm zone bounding boxes used by assessor + neighborhood clusterer.

const ZONE_BOUNDS = {
  "NHZ012":{ latMin:42.75,latMax:43.05,lngMin:-71.70,lngMax:-71.40 },
  "NHZ013":{ latMin:42.80,latMax:43.15,lngMin:-71.55,lngMax:-71.20 },
  "NHZ014":{ latMin:42.70,latMax:42.95,lngMin:-71.75,lngMax:-71.35 },
  "NHZ015":{ latMin:42.80,latMax:43.10,lngMin:-71.50,lngMax:-71.10 },
  "NHZ016":{ latMin:42.90,latMax:43.15,lngMin:-71.15,lngMax:-70.90 },
  "NHZ017":{ latMin:42.65,latMax:42.90,lngMin:-71.45,lngMax:-71.05 },
  "NHZ008":{ latMin:43.30,latMax:43.80,lngMin:-72.00,lngMax:-71.60 },
  "NHZ009":{ latMin:42.95,latMax:43.35,lngMin:-71.90,lngMax:-71.55 },
  "MAZ003":{ latMin:42.50,latMax:42.75,lngMin:-71.60,lngMax:-71.20 },
  "MAZ004":{ latMin:42.55,latMax:42.75,lngMin:-71.30,lngMax:-70.95 },
  "MAZ010":{ latMin:42.35,latMax:42.60,lngMin:-71.55,lngMax:-71.25 },
  "MAZ013":{ latMin:42.45,latMax:42.75,lngMin:-71.75,lngMax:-71.45 },
};

export function isInStormZone(lat, lng, activeZones) {
  if (!activeZones?.length) return false;
  for (const zone of activeZones) {
    const b = ZONE_BOUNDS[zone];
    if (b && lat>=b.latMin && lat<=b.latMax && lng>=b.lngMin && lng<=b.lngMax) return true;
  }
  return false;
}
