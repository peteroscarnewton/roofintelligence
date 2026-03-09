// lib/neighborhood-cluster.js — clusters parcels into subdivisions
// Uses spatial proximity + year-built similarity to detect subdivisions.

import { scoreSubdivision, ownerTenure, CY } from "./scoring.js";

const CLUSTER_RADIUS_DEG = 0.008; // ~0.5 mile
const MIN_CLUSTER_SIZE   = 4;

export function detectSubdivisions(parcels, { activeStormZones = [], isInStormZoneFn } = {}) {
  if (!parcels.length) return [];

  const used       = new Set();
  const clusters   = [];

  for (let i = 0; i < parcels.length; i++) {
    if (used.has(i)) continue;
    const seed = parcels[i];
    const group = [i];

    for (let j = i + 1; j < parcels.length; j++) {
      if (used.has(j)) continue;
      const p = parcels[j];
      const dlat = Math.abs(p.lat - seed.lat);
      const dlng = Math.abs(p.lng - seed.lng);
      const builtDiff = Math.abs(p.built - seed.built);
      if (dlat <= CLUSTER_RADIUS_DEG && dlng <= CLUSTER_RADIUS_DEG && builtDiff <= 5) {
        group.push(j);
      }
    }

    if (group.length >= MIN_CLUSTER_SIZE) {
      group.forEach(idx => used.add(idx));
      const homes     = group.map(idx => parcels[idx]);
      const centerLat = homes.reduce((s, h) => s + h.lat, 0) / homes.length;
      const centerLng = homes.reduce((s, h) => s + h.lng, 0) / homes.length;
      const avgBuilt  = Math.round(homes.reduce((s, h) => s + h.built, 0) / homes.length);
      const avgTenure = Math.round(homes.reduce((s, h) => s + ownerTenure(h.built, h.lastSale), 0) / homes.length);
      const stormHit  = isInStormZoneFn ? isInStormZoneFn(centerLat, centerLng, activeStormZones) : false;

      // Pre-score homes for subdivision scoring
      const scoredHomes = homes.map(h => ({ ...h, score: h.score || 50 }));

      clusters.push({
        id:          `cluster-${Math.round(centerLat * 1e5)}-${Math.round(centerLng * 1e5)}`,
        type:        "subdivision",
        lat:         parseFloat(centerLat.toFixed(6)),
        lng:         parseFloat(centerLng.toFixed(6)),
        homeCount:   homes.length,
        avgBuilt,
        avgTenure,
        stormHit,
        score:       scoreSubdivision(scoredHomes),
        parcelIds:   homes.map(h => h.id),
        tags:        ["subdivision", ...(stormHit ? ["storm"] : [])],
        source:      "cluster",
        foundAt:     new Date().toISOString(),
      });
    }
  }

  return clusters;
}
