// lib/storm-zones.js — checks if a coordinate falls within a NOAA storm alert polygon

export function isInStormZone(lat, lng, activeStormZones = []) {
  if (!activeStormZones.length) return false;
  for (const zone of activeStormZones) {
    if (pointInPolygon([lng, lat], zone)) return true;
  }
  return false;
}

// Ray-casting algorithm for point-in-polygon
function pointInPolygon(point, polygon) {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersect = ((yi > y) !== (yj > y)) &&
      (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}
