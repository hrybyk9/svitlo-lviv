// sw.js — service worker. Працює у фоні браузера і перехоплює запити сайту.
// Завдяки йому сайт можна встановити як додаток і відкрити навіть без інтернету.

const CACHE_NAME = 'svitlo-v1'; // зміни номер, коли оновлюєш файли сайту
const APP_FILES = ['/', '/index.html', '/style.css', '/app.js', '/parser.js', '/manifest.json', '/icons/icon-192.png'];

// Під час встановлення зберігаємо файли сайту в кеш
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_FILES)));
  self.skipWaiting();
});

// Видаляємо старі версії кешу
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Дані графіка (/api/...) завжди беремо з мережі — їх кешує сам app.js
  if (url.pathname.startsWith('/api/')) return;

  // Файли сайту: спершу пробуємо мережу (щоб отримати свіжу версію), без інтернету — з кешу
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match('/')))
  );
});
