// app.js — логіка сайту: завантаження графіка, відображення, налаштування груп.
import { groupStatus, toMinutes, kyivNow } from '/parser.js';

const SETTINGS_KEY = 'svitlo-settings';   // вибрані групи
const CACHE_KEY = 'svitlo-last-schedule'; // останній графік (для роботи без інтернету)
const ALL_GROUPS = ['1.1', '1.2', '2.1', '2.2', '3.1', '3.2', '4.1', '4.2', '5.1', '5.2', '6.1', '6.2'];

let schedule = null; // { days: [...], fetchedAt: "..." }

// ---------- Налаштування (зберігаються в localStorage на кожному телефоні окремо) ----------

// Формат: { groups: [{ id: "2.1", label: "Дім" }], main: "2.1" }
function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || null;
  } catch {
    return null;
  }
}

function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

// Групи у порядку показу: головна — першою
function orderedGroups(settings) {
  if (!settings || settings.groups.length === 0) return [];
  return [...settings.groups].sort((a, b) => (b.id === settings.main) - (a.id === settings.main));
}

// ---------- Завантаження даних ----------

async function loadSchedule() {
  const message = document.getElementById('message');
  try {
    const response = await fetch('/api/schedule', { cache: 'no-store' });
    if (!response.ok) throw new Error('Сервер відповів з помилкою');
    schedule = await response.json();
    localStorage.setItem(CACHE_KEY, JSON.stringify(schedule));
    message.hidden = true;
  } catch (error) {
    // Немає інтернету або сервер недоступний — беремо збережений графік
    const saved = localStorage.getItem(CACHE_KEY);
    if (saved) {
      schedule = JSON.parse(saved);
      message.textContent = 'Немає зв\'язку — показую останній збережений графік.';
    } else {
      message.textContent = 'Не вдалося завантажити графік. Перевір інтернет і онови сторінку.';
    }
    message.hidden = false;
  }
  render();
}

// ---------- Допоміжні функції для відображення ----------

// "25.11.2026" -> "20261125", щоб порівнювати дати як рядки
const dateKey = (d) => d.split('.').reverse().join('');

// Лише сьогоднішній і майбутні дні (старий "завтра" міг лишитися з учора)
function actualDays(today) {
  return schedule.days.filter((d) => dateKey(d.date) >= dateKey(today));
}

function dayTitle(date, today) {
  const short = date.slice(0, 5); // "24.11"
  return date === today ? `Сьогодні, ${short}` : `Завтра, ${short}`;
}

// 80 -> "1 год 20 хв"
function formatDuration(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} хв`;
  if (m === 0) return `${h} год`;
  return `${h} год ${m} хв`;
}

// Шкала доби: сіра смуга, червоні шматки — відключення, біла риска — "зараз"
function timelineHtml(intervals, nowMinutes) {
  const segments = intervals.map((i) => {
    const left = (toMinutes(i.from) / 1440) * 100;
    const width = ((toMinutes(i.to) - toMinutes(i.from)) / 1440) * 100;
    return `<span class="seg" style="left:${left}%;width:${width}%"></span>`;
  }).join('');

  const marker = nowMinutes === null
    ? ''
    : `<span class="now" style="left:${(nowMinutes / 1440) * 100}%"></span>`;

  return `
    <div class="timeline">${segments}${marker}</div>
    <div class="ticks"><span>0</span><span>6</span><span>12</span><span>18</span><span>24</span></div>`;
}

// Текст під шкалою: "08:00–11:00, 16:00–18:00" або "Без відключень"
function intervalsText(intervals) {
  if (!intervals) return 'Немає даних';
  if (intervals.length === 0) return 'Без відключень';
  return intervals.map((i) => `${i.from}–${i.to}`).join(', ');
}

// Велика картка однієї групи
function groupCardHtml(group, isMain, now) {
  const status = groupStatus(schedule.days, group.id, now.today, now.minutes);

  let cls = 'unknown';
  if (status.power === true) cls = 'on';
  if (status.power === false) cls = 'off';

  const countdown = status.minutesLeft !== undefined
    ? `<p class="countdown">${status.power ? 'до відключення' : 'до увімкнення'}: ${formatDuration(status.minutesLeft)}</p>`
    : '';

  const daysHtml = actualDays(now.today).map((day) => {
    const intervals = day.groups[group.id];
    const nowMarker = day.date === now.today ? now.minutes : null;
    return `
      <div class="day">
        <div class="day-head"><span>${dayTitle(day.date, now.today)}</span><span>${intervalsText(intervals)}</span></div>
        ${timelineHtml(intervals || [], nowMarker)}
      </div>`;
  }).join('');

  return `
    <article class="card ${cls}">
      <div class="card-head">
        <span class="badge">${group.id}</span>
        <span class="label">${isMain ? '★ ' : ''}${escapeHtml(group.label || '')}</span>
      </div>
      <p class="status">${status.text}</p>
      ${countdown}
      ${daysHtml}
    </article>`;
}

// Захист від HTML у підписах, які вводить користувач
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ---------- Головне відображення ----------

function render() {
  if (!schedule) return;
  const now = kyivNow();
  const settings = loadSettings();
  const params = new URLSearchParams(location.search);

  // Час оновлення графіка на сайті Львівобленерго
  const todayDay = schedule.days.find((d) => d.date === now.today);
  document.getElementById('updated').textContent = todayDay && todayDay.updated
    ? `Графік станом на ${todayDay.updated}`
    : 'Графіка на сьогодні ще немає';

  // Режим "табло" для телевізора: /?tv&group=2.1
  if (params.has('tv')) {
    document.body.classList.add('tv');
    const groupId = params.get('group') || (settings && settings.main) || '1.1';
    document.getElementById('myGroups').innerHTML = groupCardHtml({ id: groupId }, false, now);
    return;
  }

  // Мої групи
  const myGroups = orderedGroups(settings);
  document.getElementById('myGroups').innerHTML = myGroups.length > 0
    ? myGroups.map((g) => groupCardHtml(g, g.id === settings.main, now)).join('')
    : '<p class="empty">Натисни ⚙️ і вибери свої групи.</p>';

  // Усі групи — компактний список
  document.getElementById('allGroups').innerHTML = ALL_GROUPS.map((id) => {
    const status = groupStatus(schedule.days, id, now.today, now.minutes);
    const intervals = todayDay ? todayDay.groups[id] : null;
    const cls = status.power === false ? 'off' : status.power === true ? 'on' : 'unknown';
    return `
      <div class="row ${cls}">
        <div class="row-head"><span class="badge small">${id}</span><span>${status.text}</span></div>
        ${timelineHtml(intervals || [], now.minutes)}
      </div>`;
  }).join('');
}

// ---------- Вікно налаштувань ----------

function openSettings() {
  const settings = loadSettings() || { groups: [], main: null };
  const picker = document.getElementById('groupPicker');

  picker.innerHTML = ALL_GROUPS.map((id) => {
    const saved = settings.groups.find((g) => g.id === id);
    return `
      <div class="pick">
        <label class="pick-check">
          <input type="checkbox" name="group" value="${id}" ${saved ? 'checked' : ''}>
          <span class="badge small">${id}</span>
        </label>
        <input type="text" class="pick-label" data-id="${id}" placeholder="Підпис" maxlength="20"
               value="${saved ? escapeHtml(saved.label || '') : ''}">
        <label class="pick-main" title="Головна група">
          <input type="radio" name="main" value="${id}" ${settings.main === id ? 'checked' : ''}>★
        </label>
      </div>`;
  }).join('');

  document.getElementById('settings').showModal();
}

function saveFromDialog() {
  const checked = [...document.querySelectorAll('input[name="group"]:checked')].map((i) => i.value);
  const groups = checked.map((id) => ({
    id,
    label: document.querySelector(`.pick-label[data-id="${id}"]`).value.trim(),
  }));

  // Головна група: та, що з зірочкою (якщо вона серед вибраних), інакше — перша вибрана
  const mainInput = document.querySelector('input[name="main"]:checked');
  let main = mainInput ? mainInput.value : null;
  if (!checked.includes(main)) main = checked[0] || null;

  saveSettings({ groups, main });
  render();
}

// ---------- Запуск ----------

document.getElementById('settingsBtn').addEventListener('click', openSettings);
document.getElementById('settings').addEventListener('close', (event) => {
  if (event.target.returnValue === 'save') saveFromDialog();
});

// При першому відкритті одразу пропонуємо вибрати групи
if (!loadSettings() && !location.search.includes('tv')) openSettings();

loadSchedule();
setInterval(render, 30 * 1000);            // кожні 30 с оновлюємо статуси й риску "зараз"
setInterval(loadSchedule, 5 * 60 * 1000);  // кожні 5 хв перезавантажуємо графік

// Коли користувач повертається в додаток — одразу оновлюємо дані
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') loadSchedule();
});

// Реєструємо service worker — він дозволяє встановити сайт як додаток і відкривати його без інтернету
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js');
}
