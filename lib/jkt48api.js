"use strict";

/**
 * lib/jkt48api.js
 * Fetch data dari JKT48Connect API
 */

const BASE = "https://v2.jkt48connect.com/api/jkt48";
const KEY  = "JKTCONNECT";

async function fetchJKT48(endpoint) {
  const res = await fetch(BASE + "/" + endpoint + (endpoint.includes("?") ? "&" : "?") + "apikey=" + KEY, {
    headers: { "Cache-Control": "no-store" },
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) throw new Error("HTTP " + res.status + " (" + endpoint + ")");
  return res.json();
}

async function getLiveStreams() {
  const d = await fetchJKT48("live");
  return Array.isArray(d) ? d : [];
}

async function getLatestNews() {
  const d = await fetchJKT48("news");
  const list = Array.isArray(d && d.news) ? d.news : [];
  // Hanya ambil 1 item terbaru
  return list.length > 0 ? [list[0]] : [];
}

async function getLatestTheater() {
  // Coba tanpa page param dulu
  const d = await fetchJKT48("theater");
  const list = Array.isArray(d && d.theater) ? d.theater : [];
  // Hanya ambil 1 item terbaru
  return list.length > 0 ? [list[0]] : [];
}

async function getBirthdays() {
  const d = await fetchJKT48("birthday");
  return Array.isArray(d) ? d : [];
}

module.exports = { getLiveStreams, getLatestNews, getLatestTheater, getBirthdays };
