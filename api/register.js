/**
 * api/register.js
 *
 * Device mengirim ExpoPushToken ke sini saat app pertama dibuka.
 * Token disimpan di KV storage dan akan dipakai oleh cron job.
 *
 * POST /api/register
 * Body: { "token": "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]" }
 */

const { addToken } = require("../lib/storage");
const { Expo } = require("expo-server-sdk");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { token } = req.body ?? {};

  if (!token || typeof token !== "string") {
    return res.status(400).json({ error: "token is required" });
  }

  if (!Expo.isExpoPushToken(token)) {
    return res.status(400).json({ error: "Format token tidak valid" });
  }

  try {
    await addToken(token);
    console.log(`[REGISTER] ✅ ${token}`);
    return res.json({ ok: true });
  } catch (err) {
    console.error("[REGISTER] Error:", err.message);
    return res.status(500).json({ error: "Gagal simpan token" });
  }
};
