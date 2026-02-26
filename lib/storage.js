/**
 * lib/storage.js
 */
const KV_URL   = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

async function kv(command, ...args) {
  if (!KV_URL || !KV_TOKEN) {
    throw new Error("KV_REST_API_URL atau KV_REST_API_TOKEN tidak ditemukan.");
  }
  const path = [command, ...args].map(encodeURIComponent).join("/");
  const res = await fetch(`${KV_URL}/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "(no body)");
    throw new Error(`KV HTTP ${res.status}: ${text}`);
  }
  const json = await res.json();
  if (json.error) throw new Error(`KV error: ${json.error}`);
  return json.result;
}

// ── Token management ──────────────────────────────────────────────────────────
async function addToken(token) {
  const result = await kv("SADD", "jkt48_tokens", token);
  console.log(`[STORAGE] addToken result: ${result}`);
  return result;
}

async function removeToken(token) {
  await kv("SREM", "jkt48_tokens", token);
}

async function getAllTokens() {
  const result = await kv("SMEMBERS", "jkt48_tokens");
  return Array.isArray(result) ? result : [];
}

// ── Cache dengan atomic lock (fix double notif) ───────────────────────────────
//
// MASALAH LAMA:
//   hasInCache() → false (belum ada)
//   addToCache()  ← 3 request semua masuk sini sebelum ada yang selesai
//   → 3x notif terkirim
//
// SOLUSI BARU:
//   tryAcquireCache() pakai SET NX EX (atomic) — hanya 1 yang berhasil,
//   sisanya return false dan skip kirim notif.

const PREFIX = "jkt48_sent_";
const CACHE_TTL_SECONDS = 3600; // 1 jam

/**
 * Atomic check-and-set.
 * Return true  → belum ada di cache, BERHASIL di-set (boleh kirim notif)
 * Return false → sudah ada di cache ATAU race condition kalah (skip notif)
 */
async function tryAcquireCache(setName, id) {
  // SET key value NX EX ttl
  // NX = only set if Not eXists → atomic, tidak ada race condition
  const key = `${PREFIX}${setName}:${id}`;
  const result = await kv("SET", key, "1", "NX", "EX", String(CACHE_TTL_SECONDS));
  // Redis SET NX return "OK" jika berhasil, null jika key sudah ada
  return result === "OK";
}

/**
 * Cek apakah sudah ada di cache (tanpa set)
 */
async function hasInCache(setName, id) {
  const key = `${PREFIX}${setName}:${id}`;
  try {
    const result = await kv("EXISTS", key);
    return result === 1;
  } catch {
    return false;
  }
}

/**
 * Set cache manual (untuk backward compat)
 */
async function addToCache(setName, id) {
  const key = `${PREFIX}${setName}:${id}`;
  await kv("SET", key, "1", "EX", String(CACHE_TTL_SECONDS));
}

async function removeFromCache(setName, id) {
  const key = `${PREFIX}${setName}:${id}`;
  await kv("DEL", key);
}

async function getAllFromCache(setName) {
  // KEYS pattern — untuk live cleanup
  const pattern = `${PREFIX}${setName}:*`;
  const keys = await kv("KEYS", pattern);
  if (!Array.isArray(keys)) return [];
  // Ekstrak id dari key name
  return keys.map((k) => k.replace(`${PREFIX}${setName}:`, ""));
}

module.exports = {
  addToken,
  removeToken,
  getAllTokens,
  hasInCache,
  addToCache,
  removeFromCache,
  getAllFromCache,
  tryAcquireCache, // ← NEW: gunakan ini di cron untuk fix double notif
};
