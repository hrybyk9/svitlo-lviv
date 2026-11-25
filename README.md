# Світло · Львів

Додаток (PWA) з графіками погодинних відключень Львівобленерго для вибраних груп.

## Структура

```
svitlo/
├── wrangler.toml        налаштування Cloudflare
├── src/
│   └── worker.js        сервер: /api/schedule і /api/group/2.1
└── public/              сайт (Cloudflare віддає ці файли сам)
    ├── index.html
    ├── style.css
    ├── app.js           логіка сайту
    ├── parser.js        розбір графіка (спільний для сервера й сайту)
    ├── sw.js            service worker: встановлення як додаток, робота офлайн
    ├── manifest.json    назва та іконки додатка
    └── icons/
```

## Запуск на своєму комп'ютері

Потрібен Node.js. У папці проєкту:

```
npx wrangler dev
```

Відкрий http://localhost:8787

## Викладання в інтернет (Cloudflare Workers)

1. Зареєструйся на https://dash.cloudflare.com (безкоштовно).
2. У папці проєкту:
   ```
   npx wrangler login     # відкриє браузер, натисни Allow
   npx wrangler deploy
   ```
3. Wrangler покаже адресу на кшталт `https://svitlo-lviv.<твій-нік>.workers.dev`.
   Це посилання можна надсилати рідним.

Після змін у коді знову виконай `npx wrangler deploy`.
Якщо змінювала файли в public/, збільш номер `CACHE_NAME` у `sw.js` (svitlo-v1 → svitlo-v2),
щоб телефони точно підхопили нову версію.

## Як встановити на телефон

- **Android (Chrome):** меню ⋮ → «Додати на головний екран» / «Установити додаток».
- **iPhone (Safari):** кнопка «Поділитися» → «На початковий екран».

## API

- `GET /api/schedule`: графік на сьогодні й завтра для всіх груп.
- `GET /api/group/2.1`: короткий статус однієї групи (для віджетів).

