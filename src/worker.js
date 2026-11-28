// worker.js — серверна частина на Cloudflare Workers.
// Файли з папки public/ (сайт) Cloudflare віддає сам,
// а сюди потрапляють лише запити, для яких такого файлу немає:
//   /api/...     — дані для сайту
//   /telegram    — повідомлення від Telegram-бота
// Крім того, функція scheduled запускається за розкладом (cron) для сповіщень.

import { groupStatus, kyivNow } from '../public/parser.js';
import { loadSchedule } from './schedule.js';
import { handleUpdate } from './telegram.js';
import { checkForChanges } from './notify.js';

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
  // Обробка звичайних HTTP-запитів
  async fetch(request, env) {
    const url = new URL(request.url);

    // POST /telegram — сюди Telegram надсилає повідомлення, які люди пишуть боту
    if (url.pathname === '/telegram' && request.method === 'POST') {
      // Перевіряємо секрет, щоб ніхто, крім Telegram, не міг слати сюди запити
      if (request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.TELEGRAM_SECRET) {
        return new Response('Forbidden', { status: 403 });
      }
      try {
        await handleUpdate(env, await request.json());
      } catch (error) {
        console.error('Помилка бота:', error);
      }
      // Завжди відповідаємо 200, інакше Telegram буде повторювати те саме повідомлення
      return new Response('ok');
    }

    try {
      // GET /api/schedule — увесь графік: сьогодні й завтра
      if (url.pathname === '/api/schedule') {
        const days = await loadSchedule();
        return jsonResponse({ days, fetchedAt: new Date().toISOString() });
      }

      // GET /api/group/2.1 — короткий статус однієї групи (для віджетів)
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

  // Запуск за розкладом (див. [triggers] у wrangler.toml) — перевірка змін графіка
  async scheduled(event, env, ctx) {
    ctx.waitUntil(checkForChanges(env));
  },
};