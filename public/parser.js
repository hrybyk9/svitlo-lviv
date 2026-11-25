// parser.js — розбір графіка з відповіді API Львівобленерго.
// Цей файл спільний: його використовує і сервер (worker.js), і сайт у браузері (app.js).

// Перетворює "08:30" у кількість хвилин від початку доби (510).
// "24:00" стає 1440 — кінець доби.
export function toMinutes(time) {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

// Розбирає HTML одного дня (поле rawHtml) у зручний об'єкт:
// {
//   date: "24.11.2026",
//   updated: "22:55 24.11.2026",
//   groups: { "1.1": [{ from: "08:00", to: "11:00" }], "2.1": [] , ... }
// }
// Порожній масив означає, що для групи світло є весь день.
export function parseDay(html) {
  if (!html) return null;

  // Прибираємо HTML-теги: кожен <p> стає окремим рядком
  const text = html.replace(/<[^>]+>/g, '\n');

  const dateMatch = text.match(/відключень на (\d{2}\.\d{2}\.\d{4})/);
  if (!dateMatch) return null; // текст не схожий на графік

  const updatedMatch = text.match(/станом на (\d{2}:\d{2} \d{2}\.\d{2}\.\d{4})/);

  const groups = {};

  // Шукаємо рядки на кшталт "Група 1.1. Електроенергії немає з 08:00 до 11:00, з 16:00 до 18:00."
  const groupRegex = /Група (\d\.\d)\.\s*([^\n]*)/g;
  for (const match of text.matchAll(groupRegex)) {
    const groupId = match[1];
    const description = match[2];

    const intervals = [];
    // У рядку може бути кілька проміжків "з ... до ..."
    for (const part of description.matchAll(/з (\d{2}:\d{2}) до (\d{2}:\d{2})/g)) {
      const from = part[1];
      const to = part[2];
      // Іноді сайт пише "з 00:00 до 00:00" — це порожній проміжок, пропускаємо його
      if (toMinutes(from) < toMinutes(to)) {
        intervals.push({ from, to });
      }
    }
    groups[groupId] = intervals;
  }

  return {
    date: dateMatch[1],
    updated: updatedMatch ? updatedMatch[1] : null,
    groups,
  };
}

// Бере всю відповідь API і повертає масив днів (сьогодні, завтра),
// відсортований за датою. Величезний архів (≈2 МБ) відкидаємо.
export function parseSchedule(apiJson) {
  const menu = apiJson['hydra:member'][0];
  const days = [];

  for (const item of menu.menuItems) {
    if (item.name !== 'Today' && item.name !== 'Tomorrow') continue;
    const day = parseDay(item.rawHtml);
    if (day) days.push(day);
  }

  // Сортуємо за датою: "25.11.2026" -> "20261125" для порівняння
  const sortKey = (d) => d.date.split('.').reverse().join('');
  days.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));

  // Якщо "Today" і "Tomorrow" раптом на одну дату — лишаємо лише один
  return days.filter((d, i) => i === 0 || d.date !== days[i - 1].date);
}

// Визначає поточний статус групи.
// days — масив з parseSchedule, today — "24.11.2026", nowMinutes — хвилини від початку доби.
// Повертає { power: true/false/null, until, next, text }
export function groupStatus(days, groupId, today, nowMinutes) {
  const index = days.findIndex((d) => d.date === today);
  if (index === -1 || !(groupId in days[index].groups)) {
    return { power: null, text: 'Графіка на сьогодні немає' };
  }

  const todayIntervals = days[index].groups[groupId];
  const tomorrow = days[index + 1];
  const tomorrowIntervals = tomorrow ? tomorrow.groups[groupId] || [] : [];

  // minutesLeft — скільки хвилин до зміни стану (для зворотного відліку)

  // 1) Чи зараз відключення?
  for (const interval of todayIntervals) {
    if (toMinutes(interval.from) <= nowMinutes && nowMinutes < toMinutes(interval.to)) {
      let until = interval.to;
      let minutesLeft = toMinutes(interval.to) - nowMinutes;
      // Якщо відключення триває до 24:00, а завтра починається з 00:00 — склеюємо
      if (until === '24:00' && tomorrowIntervals[0] && tomorrowIntervals[0].from === '00:00') {
        until = tomorrowIntervals[0].to + ' (завтра)';
        minutesLeft += toMinutes(tomorrowIntervals[0].to);
      }
      return { power: false, until, minutesLeft, text: `Світла немає до ${until}` };
    }
  }

  // 2) Світло є — шукаємо наступне відключення сьогодні
  const nextToday = todayIntervals.find((i) => toMinutes(i.from) > nowMinutes);
  if (nextToday) {
    return {
      power: true,
      next: nextToday.from,
      minutesLeft: toMinutes(nextToday.from) - nowMinutes,
      text: `Світло є, вимкнуть о ${nextToday.from}`,
    };
  }

  // 3) ...або завтра
  if (tomorrowIntervals.length > 0) {
    const next = tomorrowIntervals[0].from;
    return {
      power: true,
      next: next + ' (завтра)',
      minutesLeft: 1440 - nowMinutes + toMinutes(next),
      text: `Світло є, завтра вимкнуть о ${next}`,
    };
  }

  return { power: true, text: 'Світло є, відключень більше не заплановано' };
}

// Поточна дата й час у Києві (сервер Cloudflare працює в UTC).
export function kyivNow(date = new Date()) {
  const parts = new Intl.DateTimeFormat('uk-UA', {
    timeZone: 'Europe/Kyiv',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type).value;
  return {
    today: `${get('day')}.${get('month')}.${get('year')}`,
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  };
}
