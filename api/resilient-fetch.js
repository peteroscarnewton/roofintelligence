// api/resilient-fetch.js
// ----------------------
// Core self-healing fetch utility.
// 
// How it works:
//   1. Each scanner defines an ordered list of endpoints (primary + fallbacks)
//   2. tryEndpoints() tries them in order until one works
//   3. On failure it records which endpoint failed + why
//   4. On success it records which endpoint index worked
//   5. Next run starts from the last working endpoint (persisted in KV)
//   6. If ALL endpoints fail, it returns [] and marks the scanner as "down"
//      so the dashboard shows a warning instead of silently returning nothing
//
// Validation:
//   Each endpoint definition includes a validate() function.
//   This checks that the response looks like real data, not an error page,
//   rate limit response, or restructured API returning unexpected shape.

import { kv } from "@vercel/kv";

const DEFAULT_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Accept": "application/json, text/html, */*",
  "Accept-Language": "en-US,en;q=0.9",
};

// ── FETCH WITH TIMEOUT ────────────────────────────────────────
export async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...options,
      headers: { ...DEFAULT_HEADERS, ...(options.headers || {}) },
      signal: controller.signal,
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// ── TRY ENDPOINTS IN ORDER ────────────────────────────────────
// endpoints: array of { url|buildUrl, method, body, headers, validate, label }
// Returns: { data, endpointIndex, label } or throws if all fail
export async function tryEndpoints(endpoints, options = {}) {
  const {
    startIndex = 0,    // try this index first (from last successful run)
    name = "unknown",  // for logging
  } = options;

  // Re-order to start from last known-good endpoint
  const ordered = [
    ...endpoints.slice(startIndex),
    ...endpoints.slice(0, startIndex),
  ].map((ep, i) => ({ ...ep, _originalIndex: (startIndex + i) % endpoints.length }));

  const errors = [];

  for (const endpoint of ordered) {
    const idx = endpoint._originalIndex;
    const label = endpoint.label || `endpoint-${idx}`;

    try {
      const url = typeof endpoint.buildUrl === "function"
        ? endpoint.buildUrl()
        : endpoint.url;

      const fetchOptions = {
        method: endpoint.method || "GET",
        headers: endpoint.headers || {},
        ...(endpoint.body ? { body: JSON.stringify(endpoint.body) } : {}),
      };

      if (endpoint.body) {
        fetchOptions.headers["Content-Type"] = fetchOptions.headers["Content-Type"] || "application/json";
      }

      console.log(`    [${name}] Trying ${label}: ${url.slice(0, 80)}...`);

      const res = await fetchWithTimeout(url, fetchOptions, endpoint.timeout || 15000);

      // Check HTTP status
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }

      // Parse response
      const contentType = res.headers.get("content-type") || "";
      let data;

      if (contentType.includes("application/json")) {
        data = await res.json();
      } else {
        const text = await res.text();
        // Try to parse as JSON even if content-type is wrong
        try { data = JSON.parse(text); }
        catch { data = text; }
      }

      // Validate the response looks like real data
      if (endpoint.validate) {
        const validationError = endpoint.validate(data);
        if (validationError) {
          throw new Error(`Validation failed: ${validationError}`);
        }
      }

      console.log(`    [${name}] ✓ ${label} succeeded`);
      return { data, endpointIndex: idx, label };

    } catch (err) {
      const msg = err.name === "AbortError" ? "Timeout" : err.message;
      console.warn(`    [${name}] ✗ ${label} failed: ${msg}`);
      errors.push({ label, error: msg, index: idx });
    }
  }

  throw new Error(
    `All ${endpoints.length} endpoints failed for ${name}:\n` +
    errors.map(e => `  ${e.label}: ${e.error}`).join("\n")
  );
}

// ── GET LAST WORKING ENDPOINT INDEX ──────────────────────────
export async function getLastEndpoint(scannerName) {
  try {
    const val = await kv.get(`endpoint:${scannerName}`);
    return val?.index ?? 0;
  } catch {
    return 0;
  }
}

export async function saveLastEndpoint(scannerName, index) {
  try {
    await kv.set(`endpoint:${scannerName}`, { index, updatedAt: new Date().toISOString() }, { ex: 60 * 60 * 24 * 7 });
  } catch { /* non-fatal */ }
}

// ── RATE LIMIT DETECTION ──────────────────────────────────────
export function isRateLimited(res) {
  return res.status === 429 || res.status === 503;
}

export function isBlockedOrRedirected(data) {
  if (typeof data !== "string") return false;
  const lower = data.toLowerCase();
  return (
    lower.includes("captcha") ||
    lower.includes("access denied") ||
    lower.includes("cloudflare") ||
    lower.includes("rate limit") ||
    lower.includes("too many requests") ||
    lower.includes("blocked")
  );
}
