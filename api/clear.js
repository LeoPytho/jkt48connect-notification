/**
 * api/clear-tokens.js
 *
 * Hapus SEMUA token dan cache dari KV storage.
 * ⚠️ HAPUS FILE INI SETELAH DIPAKAI!
 *
 * Usage: GET /api/clear-tokens?secret=jkt48admin
 */

const KV_URL   = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

async function kv(command, ...args) {
  const path = [command, ...args].map(encodeURIComponent).join("/");
  const res = await fetch(`${KV_URL}/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
  });
  const json = await res.json();
  return json.result;
}

module.exports = async (req, res) => {
  if (req.query.secret !== "jkt48admin") {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const deleted = [];

    // 1. Hapus semua push tokens
    await kv("DEL", "jkt48_tokens");
    deleted.push("jkt48_tokens");

    // 2. Cari dan hapus semua cache keys (jkt48_sent_*)
    const cacheKeys = await kv("KEYS", "jkt48_sent_*");
    if (Array.isArray(cacheKeys) && cacheKeys.length > 0) {
      for (const key of cacheKeys) {
        await kv("DEL", key);
        deleted.push(key);
      }
    }

    return res.status(200).json({
      success: true,
      deleted,
      message: "Semua token dan cache dihapus. Hapus file ini sekarang!",
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
