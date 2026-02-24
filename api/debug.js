/**
 * api/debug.js
 *
 * Endpoint SEMENTARA untuk diagnosa masalah KV storage.
 * ⚠️  HAPUS FILE INI setelah masalah teratasi!
 *
 * GET /api/debug
 */
const { getAllTokens } = require("../lib/storage");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const info = {
    env: {
      KV_REST_API_URL:   process.env.KV_REST_API_URL
        ? "✅ " + process.env.KV_REST_API_URL.slice(0, 30) + "..."
        : "❌ TIDAK ADA",
      KV_REST_API_TOKEN: process.env.KV_REST_API_TOKEN
        ? "✅ ada (" + process.env.KV_REST_API_TOKEN.length + " chars)"
        : "❌ TIDAK ADA",
    },
    tokens: null,
    error:  null,
  };

  try {
    info.tokens = await getAllTokens();
  } catch (err) {
    info.error = err.message;
  }

  return res.json(info);
};
