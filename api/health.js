// api/health.js
// -------------
// Central health registry for all scanners.
// Tracks: last success, last failure, failure streak, active endpoint version.
// Dashboard calls /api/health to show scanner status.
// Scanners call markSuccess() / markFailure() after every run.

import { kv } from "./kv.js";

export const SCANNERS = ["noaa", "assessor", "permits", "mls", "reddit"];

// ── READ ──────────────────────────────────────────────────────
export async function getHealth() {
  try {
    const data = await kv.get("scanner:health");
    return data || {};
  } catch {
    return {};
  }
}

export async function getScannerHealth(name) {
  const all = await getHealth();
  return all[name] || {
    name,
    status: "unknown",
    lastSuccess: null,
    lastFailure: null,
    failureStreak: 0,
    totalRuns: 0,
    successRuns: 0,
    activeEndpoint: 0,
    lastLeadCount: 0,
    lastError: null,
  };
}

// ── WRITE ─────────────────────────────────────────────────────
export async function markSuccess(name, leadCount, endpointIndex = 0) {
  const all = await getHealth();
  const prev = all[name] || {};
  all[name] = {
    ...prev,
    name,
    status: "ok",
    lastSuccess: new Date().toISOString(),
    failureStreak: 0,
    totalRuns: (prev.totalRuns || 0) + 1,
    successRuns: (prev.successRuns || 0) + 1,
    activeEndpoint: endpointIndex,
    lastLeadCount: leadCount,
    lastError: null,
  };
  await kv.set("scanner:health", all, { ex: 60 * 60 * 24 * 30 });
  return all[name];
}

export async function markFailure(name, error, endpointIndex = 0) {
  const all = await getHealth();
  const prev = all[name] || {};
  const streak = (prev.failureStreak || 0) + 1;
  all[name] = {
    ...prev,
    name,
    status: streak >= 3 ? "down" : "degraded",
    lastFailure: new Date().toISOString(),
    failureStreak: streak,
    totalRuns: (prev.totalRuns || 0) + 1,
    successRuns: prev.successRuns || 0,
    activeEndpoint: endpointIndex,
    lastLeadCount: 0,
    lastError: String(error).slice(0, 200),
  };
  await kv.set("scanner:health", all, { ex: 60 * 60 * 24 * 30 });
  return all[name];
}

// ── HTTP HANDLER ──────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=30");

  if (req.method !== "GET") return res.status(405).end();

  const health = await getHealth();

  const summary = SCANNERS.map(name => ({
    name,
    ...(health[name] || { status:"never_run", failureStreak:0, lastLeadCount:0 }),
  }));

  const allOk      = summary.every(s => s.status === "ok" || s.status === "never_run");
  const anyDown    = summary.some(s => s.status === "down");
  const anyDegraded = summary.some(s => s.status === "degraded");

  return res.status(200).json({
    overall: anyDown ? "degraded" : anyDegraded ? "degraded" : allOk ? "ok" : "unknown",
    scanners: summary,
    checkedAt: new Date().toISOString(),
  });
}
