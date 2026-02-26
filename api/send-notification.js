/**
 * api/send-notification.js
 *
 * Kirim notifikasi custom ke semua device.
 * 
 * POST body JSON:
 *   { "secret": "jkt48admin", "title": "...", "body": "...", "data": {} }
 *
 * GET query params:
 *   /api/send-notification?secret=jkt48admin&title=...&body=...
 */

const { sendPushToAll } = require("../lib/push");
const { getAllTokens } = require("../lib/storage");

module.exports = async function handler(req, res) {
  // Ambil params dari body (POST) atau query (GET)
  const params = req.method === "POST" ? req.body : req.query;
  const { secret, title, body, data } = params;

  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Auth
  if (secret !== process.env.NOTIF_SECRET && secret !== "jkt48admin") {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // Validasi
  if (!title || !body) {
    return res.status(400).json({ error: "title dan body wajib diisi" });
  }

  try {
    const tokens = await getAllTokens();

    if (tokens.length === 0) {
      return res.status(200).json({ ok: true, sent: 0, message: "Tidak ada token terdaftar" });
    }

    // data bisa string JSON (dari GET) atau object (dari POST)
    let parsedData = {};
    if (data) {
      try {
        parsedData = typeof data === "string" ? JSON.parse(data) : data;
      } catch {
        parsedData = {};
      }
    }

    const sent = await sendPushToAll(tokens, {
      title,
      body,
      data: parsedData,
      channelId: "jkt48-notifications",
    });

    return res.status(200).json({ ok: true, sent, total: tokens.length });
  } catch (err) {
    console.error("[SEND-NOTIF] Error:", err.message);
    return res.status(500).json({ error: err.message });
  }
};
