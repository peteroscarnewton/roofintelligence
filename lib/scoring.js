// lib/scoring.js — Lead scoring engine

export const CY = new Date().getFullYear();

// ── OWNER TENURE ──────────────────────────────────────────────
// Years since last sale. High tenure = original owner = no recent work done.
export function ownerTenure(yearBuilt, lastSaleYear) {
  if (!lastSaleYear || lastSaleYear < 1900) return CY - yearBuilt;
  return CY - lastSaleYear;
}

// ── PARCEL SCORE ──────────────────────────────────────────────
// Max 100 pts:
//   40 — roof age (based on year built)
//   30 — subdivision membership
//   20 — storm exposure
//   10 — owner tenure
export function scoreParcel({ built, lastSale, inSubdivision, stormHit }) {
  let score = 0;

  // Roof age (40 pts max)
  const age = CY - built;
  if      (age >= 27) score += 40;
  else if (age >= 24) score += 34;
  else if (age >= 21) score += 27;
  else if (age >= 18) score += 20;
  else if (age >= 15) score += 10;

  // Subdivision (30 pts)
  if (inSubdivision) score += 30;

  // Storm exposure (20 pts)
  if (stormHit) score += 20;

  // Owner tenure (10 pts max)
  const tenure = ownerTenure(built, lastSale);
  if      (tenure >= 20) score += 10;
  else if (tenure >= 15) score += 7;
  else if (tenure >= 10) score += 4;

  return Math.min(Math.max(score, 35), 99);
}

// ── SUBDIVISION SCORE ─────────────────────────────────────────
export function scoreSubdivision(homes) {
  if (!homes.length) return 0;
  const avg = homes.reduce((s, h) => s + h.score, 0) / homes.length;
  return Math.min(Math.round(avg), 99);
}

// ── REASON STRING ─────────────────────────────────────────────
export function buildReason(built, lastSale, inSubdivision, stormHit) {
  const age    = CY - built;
  const tenure = ownerTenure(built, lastSale);
  const parts  = [];

  if (age >= 15)         parts.push(`${age}-yr-old roof`);
  if (inSubdivision)     parts.push("subdivision cluster");
  if (stormHit)          parts.push("storm exposure");
  if (tenure >= 10)      parts.push(`${tenure}-yr owner`);

  return parts.join(" · ") || "Aging roof";
}
