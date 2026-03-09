// lib/kv.js — Upstash Redis client
// Environment variables (auto-injected by Vercel/Upstash integration):
//   KV_REST_API_URL
//   KV_REST_API_TOKEN

import { Redis } from "@upstash/redis";

const redis = new Redis({
  url:   process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

export const kv = {
  async get(key)            { return redis.get(key); },
  async set(key, value, opts) {
    return opts?.ex ? redis.set(key, value, { ex: opts.ex }) : redis.set(key, value);
  },
  async del(key)            { return redis.del(key); },
  async mget(...keys)       { return keys.length ? redis.mget(...keys) : []; },
  async keys(pattern)       { return redis.keys(pattern); },
};
