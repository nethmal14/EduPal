const CACHE = 'echo-v2';
const ASSETS = [
    '/',
    '/index.html',
    '/app.html',
    '/css/style.css',
    '/css/chat.css',
    '/js/firebase-config.js',
    '/js/auth.js',
    '/js/db.js',
    '/js/app.js',
    '/js/chat.js',
    '/js/groups.js',
    '/js/notifications.js'
];

// Install: cache core assets
self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE).then(cache => cache.addAll(ASSETS))
    );
    self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

// Fetch: network-first for Firebase, cache-first for assets
self.addEventListener('fetch', (e) => {
    const url = new URL(e.request.url);

    // Skip Firebase requests — always network
    if (url.hostname.includes('firebase') || url.hostname.includes('google')) return;

    e.respondWith(
        fetch(e.request)
            .then(res => {
                if (res && res.status === 200) {
                    const clone = res.clone();
                    caches.open(CACHE).then(cache => cache.put(e.request, clone));
                }
                return res;
            })
            .catch(() => caches.match(e.request))
    );
});

// Push notifications
self.addEventListener('push', (e) => {
    if (!e.data) return;
    const data = e.data.json();
    e.waitUntil(
        self.registration.showNotification(data.title || 'ECHO', {
            body: data.body || '',
            icon: '/icons/icon-192.png',
            badge: '/icons/icon-72.png',
            tag: data.chatId || 'echo',
            renotify: true,
            data: { chatId: data.chatId }
        })
    );
});

self.addEventListener('notificationclick', (e) => {
    e.notification.close();
    e.waitUntil(
        clients.matchAll({ type: 'window' }).then(windowClients => {
            for (const client of windowClients) {
                if (client.url.includes('/app') && 'focus' in client) {
                    client.focus();
                    client.postMessage({ type: 'openChat', chatId: e.notification.data?.chatId });
                    return;
                }
            }
            clients.openWindow('/app.html');
        })
    );
});
