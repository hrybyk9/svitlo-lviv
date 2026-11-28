// notify.js — перевірка змін у графіку та розсилка повідомлень.
// Cloudflare запускає checkForChanges за розкладом (cron) кожні 5 хвилин.
// Повідомлення отримують лише ті, кого стосуються зміни.

import { kyivNow } from '../public/parser.js';
import { loadSchedule, dateKey, intervalsText } from './schedule.js';
import { loadSubscribers, saveSubscribers, sendMessage } from './telegram.js';

export async function checkForChanges(env) {
  const now = kyivNow();

  // Беремо лише сьогодні й майбутні дні (старий "завтра" міг лишитися з учора)
  const days = (await loadSchedule()).filter((d) => dateKey(d.date) >= dateKey(now.today));

  // Знімок: { "25.11.2026": { "1.1": [...], "2.1": [...] }, ... }
  const oldSnapshot = await env.SVITLO.get('snapshot', 'json');
  const newSnapshot = {};
  for (const day of days) newSnapshot[day.date] = day.groups;

  // Найперший запуск — просто запам'ятовуємо графік, нікому нічого не пишемо
  if (!oldSnapshot) {
    await env.SVITLO.put('snapshot', JSON.stringify(newSnapshot));
    return;
  }

  // Шукаємо, що змінилося
  const events = [];
  for (const day of days) {
    const oldGroups = oldSnapshot[day.date];
    if (!oldGroups) {
      events.push({ type: 'new', day });
      continue;
    }
    // Групи, у яких змінились години (порівнюємо як JSON-рядки)
    const changed = Object.keys(day.groups).filter(
      (id) => JSON.stringify(day.groups[id]) !== JSON.stringify(oldGroups[id])
    );
    if (changed.length > 0) {
      events.push({ type: 'update', day, oldGroups, changed });
    }
  }

  // Нічого не змінилось — нічого не робимо (і не витрачаємо ліміт записів у KV)
  if (events.length === 0) return;

  // Розсилка кожному підписнику
  const subscribers = await loadSubscribers(env);
  let removedSomeone = false;

  for (const [chatId, groups] of Object.entries(subscribers)) {
    if (groups.length === 0) continue;

    const parts = [];
    for (const event of events) {
      const text = eventText(event, groups);
      if (text) parts.push(text);
    }
    if (parts.length === 0) continue; // зміни не стосуються груп цієї людини

    const result = await sendMessage(env, chatId, parts.join('\n\n'));

    // Код 403 — людина заблокувала бота, прибираємо її зі списку
    if (!result.ok && result.error_code === 403) {
      delete subscribers[chatId];
      removedSomeone = true;
    }
  }

  if (removedSomeone) await saveSubscribers(env, subscribers);
  await env.SVITLO.put('snapshot', JSON.stringify(newSnapshot));
}

// Текст повідомлення про одну подію для конкретної людини (її групи)
function eventText(event, groups) {
  const shortDate = event.day.date.slice(0, 5); // "25.11"
  const updated = event.day.updated ? ` (станом на ${event.day.updated.slice(0, 5)})` : '';

  if (event.type === 'new') {
    const lines = groups.map((id) => groupLine(id, event.day.groups[id]));
    return `🆕 <b>З'явився графік на ${shortDate}</b>${updated}\n${lines.join('\n')}`;
  }

  // type === 'update': показуємо лише змінені групи цієї людини
  const myChanged = event.changed.filter((id) => groups.includes(id));
  if (myChanged.length === 0) return null;

  const lines = myChanged.map((id) =>
    `${groupLine(id, event.day.groups[id])}\n      <i>було: ${intervalsText(event.oldGroups[id])}</i>`
  );
  return `🔄 <b>Графік на ${shortDate} змінено</b>${updated}\n${lines.join('\n')}`;
}

// "🔴 2.1: 08:00–09:30" або "🟢 2.1: без відключень"
function groupLine(id, intervals) {
  const icon = intervals && intervals.length > 0 ? '🔴' : '🟢';
  return `${icon} <b>${id}</b>: ${intervalsText(intervals)}`;
}
