/**
 * lib/push.js
 */
const { Expo } = require("expo-server-sdk");
const { removeToken } = require("./storage");

const expo = new Expo({
  accessToken: process.env.EXPO_ACCESS_TOKEN || undefined,
});

async function sendPushToAll(tokens, payload) {
  if (!tokens || tokens.length === 0) return 0;

  const valid = tokens.filter((t) => Expo.isExpoPushToken(t));
  if (valid.length === 0) {
    console.log("[PUSH] Tidak ada token valid");
    return 0;
  }

  const messages = valid.map((token) => ({
    to: token,
    sound: "default",
    title: payload.title,
    body: payload.body,
    data: payload.data ?? {},
    priority: "high",
    // channelId dari payload (live vs notifications)
    channelId: payload.channelId ?? "jkt48-notifications",
  }));

  const chunks = expo.chunkPushNotifications(messages);
  const tickets = [];

  for (const chunk of chunks) {
    try {
      const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
      tickets.push(...ticketChunk);
    } catch (err) {
      console.error("[PUSH] Error kirim chunk:", err.message);
    }
  }

  let successCount = 0;
  for (let i = 0; i < valid.length; i++) {
    const ticket = tickets[i];
    if (!ticket) continue;
    if (ticket.status === "ok") {
      successCount++;
    } else if (ticket.status === "error") {
      const errCode = ticket.details?.error;
      console.warn(`[PUSH] Error [${valid[i]}]: ${errCode}`);
      if (errCode === "DeviceNotRegistered" || errCode === "InvalidCredentials") {
        await removeToken(valid[i]).catch(() => {});
        console.log(`[PUSH] Token dihapus: ${valid[i]}`);
      }
    }
  }

  console.log(`[PUSH] ✅ ${successCount}/${valid.length} terkirim`);
  return successCount;
}

module.exports = { sendPushToAll };
