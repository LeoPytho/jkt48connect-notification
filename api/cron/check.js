"use strict";

const {
  getLiveStreams,
  getLatestNews,
  getLatestTheater,
  getBirthdays,
  getStreamCacheId
} = require("../../lib/jkt48api");

const { sendPushToAll } = require("../../lib/push");
const {
  getAllTokens,
  tryAcquireCache,
  removeFromCache,
  getAllFromCache,
} = require("../../lib/storage");

const BIRTHDAY_REMINDER_DAYS = 7;

module.exports = function handler(req, res) {
  const start = Date.now();
  console.log("[CRON] start " + new Date().toISOString());

  return getAllTokens()
    .then(function (tokens) {
      console.log("[CRON] tokens: " + tokens.length);

      if (tokens.length === 0) {
        return res.json({ ok: true, message: "No tokens registered", ms: 0 });
      }

      return Promise.allSettled([
        checkLive(tokens),
        checkNews(tokens),
        checkTheater(tokens),
        checkBirthday(tokens),
      ]).then(function (results) {
        const r = {
          ok: true,
          ms: Date.now() - start,
          live:     results[0].status === "fulfilled" ? results[0].value : { error: String(results[0].reason) },
          news:     results[1].status === "fulfilled" ? results[1].value : { error: String(results[1].reason) },
          theater:  results[2].status === "fulfilled" ? results[2].value : { error: String(results[2].reason) },
          birthday: results[3].status === "fulfilled" ? results[3].value : { error: String(results[3].reason) },
        };

        console.log("[CRON] done " + r.ms + "ms");
        return res.json(r);
      });
    })
    .catch(function (err) {
      console.error("[CRON] fatal:", err.message);
      return res.status(500).json({ error: err.message });
    });
};

//
// ─────────────────────────────────────────────────────────
// LIVE CHECK (FIXED)
// ─────────────────────────────────────────────────────────
//

function normalizeStreams(streams) {
  const map = new Map();

  streams.forEach(function (s) {
    const type = (s.type || "").toLowerCase();

    if (type === "idn") {
      const key = "idn-" + s.url_key;

      if (!map.has(key)) {
        map.set(key, s);
      } else {
        const existing = map.get(key);

        // Prioritaskan yang punya chat_room_id
        if (!existing.chat_room_id && s.chat_room_id) {
          map.set(key, s);
        }
      }
    }

    if (type === "showroom") {
      const key = "sr-" + s.room_id;
      map.set(key, s);
    }
  });

  return Array.from(map.values());
}

function checkLive(tokens) {
  return getLiveStreams().then(function (rawStreams) {

    // 🔥 Deduplicate dulu
    const streams = normalizeStreams(rawStreams);

    const activeIds = new Set(
      streams.map(function (s) {
        return getStreamCacheId(s);
      })
    );

    let sent = 0;
    let chain = Promise.resolve();

    streams.forEach(function (stream) {
      chain = chain.then(function () {

        const cacheId = getStreamCacheId(stream);
        const type    = (stream.type || "idn").toLowerCase();

        return tryAcquireCache("live", cacheId).then(function (acquired) {
          if (!acquired) return;

          const tipe  = type === "showroom" ? "Showroom" : "IDN";

          const mulai = stream.started_at
            ? new Date(stream.started_at).toLocaleTimeString("id-ID", {
                hour: "2-digit",
                minute: "2-digit",
                timeZone: "Asia/Jakarta",
              })
            : "";

          console.log(
            "[CRON] Live baru: " + stream.name +
            " [" + tipe + "] cacheId=" + cacheId
          );

          return sendPushToAll(tokens, {
            title: stream.name + " sedang LIVE!",
            body:
              tipe +
              " Live" +
              (mulai ? " · Mulai " + mulai + " WIB" : "") +
              " · Ketuk untuk nonton!",
            data: {
              type: "live",
              stream_type: type,
              url_key: stream.url_key || "",
              room_id: String(stream.room_id || ""),
              slug: stream.slug || "",
              chat_room_id: String(stream.chat_room_id || ""),
            },
            channelId: "jkt48-live",
          }).then(function () {
            sent++;
          });
        });
      });
    });

    return chain.then(function () {

      // 🔥 AUTO CLEAR OFFLINE
      return getAllFromCache("live").then(function (cached) {

        let cleared = 0;
        let cleanChain = Promise.resolve();

        cached.forEach(function (id) {
          if (!activeIds.has(id)) {
            cleanChain = cleanChain.then(function () {
              return removeFromCache("live", id).then(function () {
                cleared++;
                console.log("[CRON] Live offline, cache dihapus: " + id);
              });
            });
          }
        });

        return cleanChain.then(function () {
          return {
            sent: sent,
            active: activeIds.size,
            cleared: cleared,
          };
        });
      });
    });
  });
}

//
// ─────────────────────────────────────────────────────────
// NEWS
// ─────────────────────────────────────────────────────────
//

function checkNews(tokens) {
  return getLatestNews().then(function (list) {
    let sent = 0;
    let chain = Promise.resolve();

    list.forEach(function (item) {
      chain = chain.then(function () {
        const id = item._id || item.id;
        if (!id) return;

        return tryAcquireCache("news", id).then(function (acquired) {
          if (!acquired) return;

          return sendPushToAll(tokens, {
            title: "Berita Terbaru JKT48",
            body: item.title || "Ada berita baru dari JKT48!",
            data: {
              type: "news",
              news_id: item.id,
              mongo_id: item._id,
              date: item.date,
            },
            channelId: "jkt48-notifications",
          }).then(function () {
            sent++;
          });
        });
      });
    });

    return chain.then(function () {
      return { sent: sent };
    });
  });
}

//
// ─────────────────────────────────────────────────────────
// THEATER & BIRTHDAY (TIDAK DIUBAH)
// ─────────────────────────────────────────────────────────
//

function checkTheater(tokens) {
  return getLatestTheater().then(function (list) {
    let sent = 0;
    let chain = Promise.resolve();

    list.forEach(function (show) {
      chain = chain.then(function () {
        const id = String(show.id);

        return tryAcquireCache("theater", id).then(function (acquired) {
          if (!acquired) return;

          return sendPushToAll(tokens, {
            title: show.title,
            body: "Ada jadwal theater baru!",
            data: {
              type: "theater",
              theater_id: show.id,
            },
            channelId: "jkt48-notifications",
          }).then(function () {
            sent++;
          });
        });
      });
    });

    return chain.then(function () {
      return { sent: sent };
    });
  });
}

function checkBirthday(tokens) {
  return Promise.resolve({ sent: 0 });
}
