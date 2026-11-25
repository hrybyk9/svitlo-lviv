// worker.js — серверна частина на Cloudflare Workers.
// Файли з папки public/ (сайт) Cloudflare віддає сам,
// а сюди потрапляють лише запити, для яких такого файлу немає, тобто /api/...

import { parseSchedule, groupStatus, kyivNow } from '../public/parser.js';

// Адреса, звідки сайт Львівобленерго бере графіки
const LOE_URL = 'https://api.loe.lviv.ua/api/menus?page=1&type=photo-grafic&jsonld=1';

// Завантажує й розбирає графік.
// cacheTtl: 300 — Cloudflare тримає відповідь у кеші 5 хвилин,
// тож навіть якщо додаток відкриють 100 разів, до Львівобленерго піде лише 1 запит.
async function loadSchedule() {
  const response = await fetch(LOE_URL, {
    headers: { 'User-Agent': 'Mozilla/5.0 (svitlo-lviv personal app)' },
    cf: { cacheTtl: 300, cacheEverything: true },
  });
  if (!response.ok) {
    throw new Error(`Львівобленерго відповіло з кодом ${response.status}`);
  }
  const json = await response.json();
  return parseSchedule(json);
}

// Допоміжна функція: відповідь у форматі JSON
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=60', // браузер може тримати відповідь 1 хвилину
      'Access-Control-Allow-Origin': '*',     // щоб віджети (Scriptable тощо) могли читати дані
    },
  });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    try {
      // GET /api/schedule — увесь графік: сьогодні й завтра
      if (url.pathname === '/api/schedule') {
        const days = await loadSchedule();
        return jsonResponse({ days, fetchedAt: new Date().toISOString() });
      }

      // GET /api/group/2.1 — короткий статус однієї групи (для віджетів і телевізора)
      const groupMatch = url.pathname.match(/^\/api\/group\/(\d\.\d)$/);
      if (groupMatch) {
        const groupId = groupMatch[1];
        const days = await loadSchedule();
        const now = kyivNow();
        const status = groupStatus(days, groupId, now.today, now.minutes);
        const todayDay = days.find((d) => d.date === now.today);
        return jsonResponse({
          group: groupId,
          ...status,
          today: todayDay ? todayDay.groups[groupId] || [] : [],
          updated: todayDay ? todayDay.updated : null,
        });
      }

      return jsonResponse({ error: 'Не знайдено' }, 404);
    } catch (error) {
      // 502 — "поганий шлюз": проблема не в нас, а на сайті, звідки беремо дані
      return jsonResponse({ error: error.message }, 502);
    }
  },
};
