// telegram.js — Telegram-бот: команди /start, /groups, /now, /stop і вибір груп кнопками.
//
// Підписники зберігаються в Cloudflare KV одним записом "subscribers":
// { "123456789": ["2.1", "3.1"], "987654321": ["6.1"] }
// де ключ — chat id користувача в Telegram, значення — його групи.

import { groupStatus, kyivNow } from '../public/parser.js';
import { loadSchedule } from './schedule.js';

// Підказка з командами — показується після вибору груп і на будь-яке незрозуміле повідомлення
const HELP_TEXT =
  'Команди:\n' +
  '/now — статус моїх груп зараз\n' +
  '/groups — змінити групи\n' +
  '/stop — вимкнути сповіщення';

const ALL_GROUPS = ['1.1', '1.2', '2.1', '2.2', '3.1', '3.2', '4.1', '4.2', '5.1', '5.2', '6.1', '6.2'];

// ---------- Робота з Telegram API ----------

// Викликає будь-який метод Telegram Bot API, наприклад sendMessage
export async function tg(env, method, body) {
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return response.json();
}

// Надсилає текстове повідомлення. parse_mode HTML дозволяє писати <b>жирний</b> текст.
export function sendMessage(env, chatId, text, extra = {}) {
  return tg(env, 'sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', ...extra });
}

// ---------- Зберігання підписників у KV ----------

export async function loadSubscribers(env) {
  return (await env.SVITLO.get('subscribers', 'json')) || {};
}

export async function saveSubscribers(env, subscribers) {
  await env.SVITLO.put('subscribers', JSON.stringify(subscribers));
}

// ---------- Клавіатура вибору груп ----------

// Кнопки під повідомленням: по 4 групи в рядку, вибрані позначені ✅
function groupsKeyboard(selected) {
  const rows = [];
  for (let i = 0; i < ALL_GROUPS.length; i += 4) {
    rows.push(
      ALL_GROUPS.slice(i, i + 4).map((id) => ({
        text: selected.includes(id) ? `✅ ${id}` : id,
        callback_data: `toggle:${id}`, // це повернеться нам, коли натиснуть кнопку
      }))
    );
  }
  rows.push([{ text: 'Готово', callback_data: 'done' }]);
  return { inline_keyboard: rows };
}

function groupsList(groups) {
  return groups.length > 0 ? groups.join(', ') : 'жодної';
}

// ---------- Обробка повідомлень від Telegram ----------

// update — те, що Telegram надсилає на наш сервер (повідомлення або натискання кнопки)
export async function handleUpdate(env, update) {
  if (update.callback_query) {
    await handleButton(env, update.callback_query);
  } else if (update.message && update.message.text) {
    await handleCommand(env, update.message);
  }
}

async function handleCommand(env, message) {
  const chatId = String(message.chat.id);
  const command = message.text.split(' ')[0].split('@')[0]; // "/now@my_bot" -> "/now"
  const subscribers = await loadSubscribers(env);
  const groups = subscribers[chatId] || [];

  if (command === '/start' || command === '/groups') {
    // Якщо людина нова — додаємо її з порожнім списком груп
    if (!subscribers[chatId]) {
      subscribers[chatId] = [];
      await saveSubscribers(env, subscribers);
    }
    const intro = command === '/start'
      ? 'Привіт! Я надсилатиму повідомлення, коли Львівобленерго публікує графік на наступний день або змінює години для твоїх груп.\n\n'
      : '';
    await sendMessage(env, chatId, `${intro}Вибери свої групи:`, { reply_markup: groupsKeyboard(groups) });
    return;
  }

  if (command === '/now') {
    await sendMessage(env, chatId, await statusText(groups));
    return;
  }

  if (command === '/stop') {
    delete subscribers[chatId];
    await saveSubscribers(env, subscribers);
    await sendMessage(env, chatId, 'Сповіщення вимкнено. Щоб увімкнути знову — /start');
    return;
  }

  await sendMessage(env, chatId, HELP_TEXT);
}

// Натискання кнопки з групою
async function handleButton(env, query) {
  const chatId = String(query.message.chat.id);
  const subscribers = await loadSubscribers(env);
  let groups = subscribers[chatId] || [];

  if (query.data.startsWith('toggle:')) {
    const id = query.data.slice('toggle:'.length);
    // Якщо група вже вибрана — прибираємо, інакше додаємо
    groups = groups.includes(id) ? groups.filter((g) => g !== id) : [...groups, id];
    groups.sort();
    subscribers[chatId] = groups;
    await saveSubscribers(env, subscribers);

    // Оновлюємо кнопки в тому самому повідомленні
    await tg(env, 'editMessageReplyMarkup', {
      chat_id: chatId,
      message_id: query.message.message_id,
      reply_markup: groupsKeyboard(groups),
    });
  }

  if (query.data === 'done') {
    await tg(env, 'editMessageText', {
      chat_id: chatId,
      message_id: query.message.message_id,
      text: `Збережено. Твої групи: ${groupsList(groups)}\n\n${HELP_TEXT}`,
    });
  }

  // Telegram чекає підтвердження, інакше на кнопці довго крутиться годинник
  await tg(env, 'answerCallbackQuery', { callback_query_id: query.id });
}

// Текст для команди /now
async function statusText(groups) {
  if (groups.length === 0) return 'Спершу вибери групи: /groups';

  const days = await loadSchedule();
  const now = kyivNow();
  const lines = groups.map((id) => {
    const status = groupStatus(days, id, now.today, now.minutes);
    const icon = status.power === false ? '🔴' : status.power === true ? '🟢' : '⚪';
    return `${icon} <b>${id}</b>: ${status.text}`;
  });
  return lines.join('\n');
}