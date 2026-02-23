/**
 * api/cron/check.js
 *
 * Vercel Cron Job — berjalan setiap 1 menit (konfigurasi di vercel.json).
 *
 * Flow:
 *   1. Ambil semua ExpoPushToken dari KV storage
 *   2. Fetch JKT48 API: live, news, theater, birthday
 *   3. Untuk setiap item baru (belum ada di cache), kirim push ke semua token
 *   4. Push dikirim via Expo Push Service → FCM/APNs → device
 *      BEKERJA meskipun app di-kill total
 *
 * Dilindungi dengan CRON_SECRET (set di Vercel env vars).
 * Vercel otomatis menyuntikkan header Authorization saat menjalankan cron.
 */

const { getLiveStreams, getNews, getTheater, getBirthdays } = require("../../lib/jkt48api");
const { sendPushToAll } = require("../../lib/push");
const {
  getAllTokens,
  hasInCache,
  addToCache,
  removeFromCache,
  getAllFromCache,
} = require("../../lib/storage");

const BIRTHDAY_REMINDER_DAYS = 7;

module.exports = async function handler(req, res) {
  // Vercel otomatis kirim Authorization header dengan CRON_SECRET saat menjalankan cron.
  // Manual call tanpa secret akan ditolak.
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.authorization;
    if (auth !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: "Unauthorized" });
    }
  }

  const start = Date.now();
  console.log(`\n[CRON] ▶ ${new Date().toISOString()}`);

  try {
    const tokens = await getAllTokens();
    console.log(`[CRON] Tokens terdaftar: ${tokens.length}`);

    if (tokens.length === 0) {
      return res.json({ ok: true, message: "No tokens registered", ms: 0 });
    }

    // Jalankan semua check paralel, tangkap error per-check agar satu gagal tidak stop semua
    const [live, news, theater, birthday] = await Promise.allSettled([
      checkLive(tokens),
      checkNews(tokens),
      checkTheater(tokens),
      checkBirthday(tokens),
    ]);

    const result = {
      ok: true,
      ms: Date.now() - start,
      live:     live.status     === "fulfilled" ? live.value     : { error: live.reason?.message },
      news:     news.status     === "fulfilled" ? news.value     : { error: news.reason?.message },
      theater:  theater.status  === "fulfilled" ? theater.value  : { error: theater.reason?.message },
      birthday: birthday.status === "fulfilled" ? birthday.value : { error: birthday.reason?.message },
    };

    console.log(`[CRON] ✅ Selesai dalam ${result.ms}ms —`, JSON.stringify({
      live: result.live, news: result.news, theater: result.theater, birthday: result.birthday,
    }));

    return res.json(result);
  } catch (err) {
    console.error("[CRON] ❌ Fatal:", err.message);
    return res.status(500).json({ error: err.message });
  }
};

// ── CHECK LIVE ────────────────────────────────────────────────────────────────
async function checkLive(tokens) {
  const streams = await getLiveStreams();
  const activeIds = new Set(streams.map((s) => String(s.chat_room_id)));
  let sent = 0;

  for (const stream of streams) {
    const id = String(stream.chat_room_id);
    if (await hasInCache("live", id)) continue;

    const tipe = stream.type?.toUpperCase() ?? "IDN";
    const mulai = stream.started_at
      ? new Date(stream.started_at).toLocaleTimeString("id-ID", {
          hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta",
        })
      : "";

    await sendPushToAll(tokens, {
      title: `${stream.name} sedang LIVE!`,
      body: `${tipe} Live${mulai ? ` • Mulai ${mulai} WIB` : ""} — Ketuk untuk nonton!`,
      data: {
        type: "live",
        room_id: stream.chat_room_id,
        url_key: stream.url_key,
        slug: stream.slug,
      },
    });

    await addToCache("live", id);
    sent++;
    console.log(`[LIVE] ✅ ${stream.name} [${id}]`);
  }

  // Bersihkan cache room yang sudah offline
  const cached = await getAllFromCache("live");
  let cleared = 0;
  for (const id of cached) {
    if (!activeIds.has(id)) {
      await removeFromCache("live", id);
      cleared++;
    }
  }

  return { sent, active: activeIds.size, cleared };
}

// ── CHECK NEWS ────────────────────────────────────────────────────────────────
async function checkNews(tokens) {
  const list = await getNews();
  let sent = 0;

  for (const item of list) {
    const id = item._id ?? item.id;
    if (!id || await hasInCache("news", id)) continue;

    await sendPushToAll(tokens, {
      title: "Berita Terbaru JKT48",
      body: item.title ?? "Ada berita baru dari JKT48!",
      data: { type: "news", news_id: item.id, mongo_id: item._id, date: item.date },
    });

    await addToCache("news", id);
    sent++;
    console.log(`[NEWS] ✅ ${item.title?.slice(0, 50)}`);
  }

  return { sent };
}

// ── CHECK THEATER ─────────────────────────────────────────────────────────────
async function checkTheater(tokens) {
  const list = await getTheater();
  let sent = 0;

  for (const show of list) {
    const id = String(show.id);
    if (await hasInCache("theater", id)) continue;

    const tgl = show.date
      ? new Date(show.date).toLocaleString("id-ID", {
          day: "numeric", month: "short", year: "numeric",
          hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta",
        })
      : "";

    const seitansai = show.seitansai?.length
      ? ` • Seitansai: ${show.seitansai.map((s) => s.name).join(", ")}`
      : "";

    await sendPushToAll(tokens, {
      title: `Theater: ${show.title}`,
      body: `${tgl} WIB • ${show.member_count} member${seitansai}`,
      data: {
        type: "theater",
        theater_id: show.id,
        url: show.url,
        seitansai: show.seitansai ?? [],
      },
    });

    await addToCache("theater", id);
    sent++;
    console.log(`[THEATER] ✅ [${id}] ${show.title}`);
  }

  return { sent };
}

// ── CHECK BIRTHDAY ────────────────────────────────────────────────────────────
async function checkBirthday(tokens) {
  const members = await getBirthdays();
  let sent = 0;

  for (const m of members) {
    const { url_key, name, img, next_birthday_countdown, is_birthday_today, age_after_birthday } = m;

    if (is_birthday_today) {
      const key = `${url_key}-today`;
      if (!(await hasInCache("birthday", key))) {
        await sendPushToAll(tokens, {
          title: `🎂 Selamat Ulang Tahun ${name}!`,
          body: `${name} JKT48 hari ini berulang tahun ke-${age_after_birthday}! Kirimkan ucapanmu!`,
          data: { type: "birthday", url_key, subtype: "today", age: age_after_birthday },
        });
        await addToCache("birthday", key);
        sent++;
      }
    } else {
      // Bersihkan cache today jika sudah lewat
      const todayKey = `${url_key}-today`;
      if (await hasInCache("birthday", todayKey)) await removeFromCache("birthday", todayKey);
    }

    const daysLeft = next_birthday_countdown?.days ?? 0;
    if (daysLeft > 0 && daysLeft <= BIRTHDAY_REMINDER_DAYS) {
      const key = `${url_key}-reminder-${daysLeft}`;
      if (!(await hasInCache("birthday", key))) {
        const countdown = daysLeft === 1 ? "Besok ulang tahun!" : `${daysLeft} hari lagi ulang tahun!`;
        await sendPushToAll(tokens, {
          title: `${name} JKT48 — ${countdown}`,
          body: `${name} akan berulang tahun ke-${age_after_birthday} dalam ${daysLeft} hari. Siapkan ucapanmu!`,
          data: { type: "birthday", url_key, subtype: "reminder", days_left: daysLeft, age: age_after_birthday },
        });
        await addToCache("birthday", key);
        sent++;
      }
    }

    // Bersihkan reminder hari-hari yang sudah lewat
    for (let d = BIRTHDAY_REMINDER_DAYS + 1; d <= 365; d++) {
      const old = `${url_key}-reminder-${d}`;
      if (await hasInCache("birthday", old)) await removeFromCache("birthday", old);
    }
  }

  return { sent };
}
