// schedule.js — завантаження графіка з сайту Львівобленерго.
// Винесено в окремий файл, бо графік потрібен і сайту (worker.js), і боту (notify.js, telegram.js).

import { parseSchedule } from '../public/parser.js';

// Адреса, звідки сайт Львівобленерго бере графіки
const LOE_URL = 'https://api.loe.lviv.ua/api/menus?page=1&type=photo-grafic&jsonld=1';

// Завантажує й розбирає графік.
// cacheTtl: 300 — Cloudflare тримає відповідь у кеші 5 хвилин,
// тож навіть якщо додаток відкриють 100 разів, до Львівобленерго піде лише 1 запит.
export async function loadSchedule() {
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

// "25.11.2026" -> "20261125", щоб порівнювати дати як звичайні рядки
export function dateKey(date) {
  return date.split('.').reverse().join('');
}

// "08:00–09:30, 16:00–18:00" або "без відключень"
export function intervalsText(intervals) {
  if (!intervals || intervals.length === 0) return 'без відключень';
  return intervals.map((i) => `${i.from}–${i.to}`).join(', ');
}
