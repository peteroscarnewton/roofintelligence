// api/kv.js
// ---------
// Compatibility shim: exposes the same API as @vercel/kv
// but backed by @upstash/redis (the successor service).
//
// @vercel/kv was a thin wrapper around Upstash Redis.
// Vercel deprecated it and migrated stores to Upstash directly.
//
// Environment variables (injected automatically by Vercel/Upstash integration):
//   KV_REST_API_URL
//   KV_REST_API_TOKEN
//
// Usage (drop-in for old @vercel/kv imports):
//   import { kv } from "./kv.js";

import { Redis } from "@upstash/redis";

const redis = new Redis({
  url:   process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

export const kv = {
  // ── GET ───────────────────────────────────────────────────
  async get(key) {
    return redis.get(key);
  },

  // ── SET ───────────────────────────────────────────────────
  // Supports optional { ex } TTL option, matching @vercel/kv
  async set(key, value, opts) {
    if (opts?.ex) {
      return redis.set(key, value, { ex: opts.ex });
    }
    return redis.set(key, value);
  },

  // ── DELETE ────────────────────────────────────────────────
  async del(key) {
    return redis.del(key);
  },

  // ── MGET ─────────────────────────────────────────────────
  // @vercel/kv: kv.mget(key1, key2, ...)  → array of values
  async mget(...keys) {
    if (!keys.length) return [];
    return redis.mget(...keys);
  },

  // ── KEYS ─────────────────────────────────────────────────
  async keys(pattern) {
    return redis.keys(pattern);
  },

  // ── INCR / EXPIRE (used by some health logic) ─────────────
  async incr(key) {
    return redis.incr(key);
  },

  async expire(key, seconds) {
    return redis.expire(key, seconds);
  },
};
