// api/scoring.js
// --------------
// Single source of truth for all lead scoring across the app.
// Phase 1 rewrite: implements the formula ChatGPT recommended:
//   40 pts — roof age
//   30 pts — cluster / subdivision
//   20 pts — storm exposure
//   10 pts — owner tenure (new in Phase 1)
//
// Also exports waveLabel() used by the Top 10 panel and detail cards.

export const CY = new Date().getFullYear();

// ── INDIVIDUAL PARCEL SCORE ───────────────────────────────────
// All four signals combined into one clean formula.
export function scoreParcel({ built, lastSale, inSubdivision, stormHit, nearPermitCluster }) {
  let score = 0;

  // ── 40 pts: Roof Age ──────────────────────────────
  const age = built ? CY - built : 0;
  if      (age >= 27) score += 40;
  else if (age >= 24) score += 34;
  else if (age >= 21) score += 27;
  else if (age >= 18) score += 20;
  else if (age >= 15) score += 10;

  // ── 30 pts: Subdivision / Cluster ────────────────
  if (inSubdivision) score += 30;

  // ── 20 pts: Storm Exposure ────────────────────────
  if (stormHit) score += 20;

  // ── 10 pts: Owner Tenure ─────────────────────────
  const tenure = ownerTenure(built, lastSale);
  if      (tenure >= 20) score += 10;
  else if (tenure >= 15) score += 7;
  else if (tenure >= 10) score += 4;

  // Bonus: permit cluster nearby
  if (nearPermitCluster) score += 5;

  return Math.min(Math.max(score, 35), 99);
}

// ── SUBDIVISION CLUSTER SCORE ─────────────────────────────────
// Same four-signal formula scaled for clusters.
export function scoreSubdivision({ cohort, stormHit, nearPermitCluster }) {
  const count  = cohort.length;
  const avgAge = cohort.reduce((s, p) => s + (CY - p.built), 0) / count;
  const years  = cohort.map(p => p.built);
  const spread = Math.max(...years) - Math.min(...years);

  // Avg tenure across cohort
  const avgTenure = cohort.reduce((s, p) => s + ownerTenure(p.built, p.lastSale), 0) / count;

  let score = 0;

  // ── 40 pts: Roof Age ──────────────────────────────
  if      (avgAge >= 27) score += 40;
  else if (avgAge >= 24) score += 34;
  else if (avgAge >= 21) score += 27;
  else if (avgAge >= 18) score += 20;
  else if (avgAge >= 15) score += 10;

  // ── 30 pts: Cluster Size ─────────────────────────
  if      (count >= 100) score += 30;
  else if (count >=  50) score += 26;
  else if (count >=  25) score += 20;
  else if (count >=  15) score += 15;
  else if (count >=   8) score += 10;
  else if (count >=   5) score += 5;

  // Tight year spread bonus (same developer = same roof age)
  if      (spread <= 1) score += 4;
  else if (spread <= 3) score += 2;

  // ── 20 pts: Storm Exposure ────────────────────────
  if (stormHit) score += 20;

  // ── 10 pts: Owner Tenure ─────────────────────────
  if      (avgTenure >= 20) score += 10;
  else if (avgTenure >= 15) score += 7;
  else if (avgTenure >= 10) score += 4;

  if (nearPermitCluster) score += 5;

  return Math.min(score, 99);
}

// ── OWNER TENURE ──────────────────────────────────────────────
// Returns number of years the current owner has likely had the house.
// If lastSale is 0 or missing, fall back to built year (likely original owner).
export function ownerTenure(built, lastSale) {
  if (!built) return 0;
  const saleYear = (lastSale && lastSale > built) ? lastSale : built;
  return Math.max(0, CY - saleYear);
}

// ── TENURE LABEL ──────────────────────────────────────────────
export function tenureLabel(built, lastSale) {
  const t = ownerTenure(built, lastSale);
  if (t === 0) return null;
  const likely = (!lastSale || lastSale <= (built||0) + 2) ? ' — likely original owner' : '';
  return `${t} yrs${likely}`;
}

// ── WAVE LABEL ────────────────────────────────────────────────
// Human-readable replacement wave probability used in Top 10 panel.
export function waveLabel(score) {
  if (score >= 90) return { label: 'CRITICAL WAVE',  color: '#c94135', bg: '#fdf1ef' };
  if (score >= 80) return { label: 'VERY HIGH',       color: '#c94135', bg: '#fdf1ef' };
  if (score >= 70) return { label: 'HIGH',            color: '#b87028', bg: '#fdf5ea' };
  if (score >= 60) return { label: 'MODERATE',        color: '#b87028', bg: '#fdf5ea' };
  return                  { label: 'WATCH LIST',      color: '#2e7a54', bg: '#ecf6f1' };
}

// ── REASON STRING ─────────────────────────────────────────────
export function buildReason(built, lastSale, inSubdivision, stormHit) {
  if (!built) return '';
  const age = CY - built;
  const tenure = ownerTenure(built, lastSale);
  const parts = [`Built ${built} — ~${age}-yr roof`];
  if (tenure >= 10) {
    const orig = (!lastSale || lastSale <= built + 2) ? ', likely original owner' : '';
    parts.push(`owned ${tenure} yrs${orig}`);
  }
  if (inSubdivision) parts.push('subdivision cluster');
  if (stormHit)      parts.push('storm path');
  return parts.join(' · ');
}
