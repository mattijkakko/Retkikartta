const CACHE = ‘retkikartta-v2’;
const PRECACHE = [
‘/’,
‘/index.html’,
‘https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css’,
‘https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js’,
‘https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&display=swap’
];

self.addEventListener(‘install’, e => {
e.waitUntil(
caches.open(CACHE).then(c => {
// Pre-cache app shell — ignore failures for external resources
return Promise.allSettled(PRECACHE.map(url => c.add(url)));
})
);
self.skipWaiting();
});

self.addEventListener(‘activate’, e => {
e.waitUntil(
caches.keys().then(keys =>
Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
)
);
self.clients.claim();
});

self.addEventListener(‘fetch’, e => {
// Network first for map tiles (always want fresh tiles)
if (e.request.url.includes(‘tile.’) ||
e.request.url.includes(‘arcgisonline’) ||
e.request.url.includes(‘maanmittauslaitos’) ||
e.request.url.includes(‘waymarkedtrails’)) {
e.respondWith(
fetch(e.request).catch(() => caches.match(e.request))
);
return;
}
// Cache first for app shell
e.respondWith(
caches.match(e.request).then(cached => {
if (cached) return cached;
return fetch(e.request).then(resp => {
if (resp && resp.status === 200 && resp.type !== ‘opaque’) {
const clone = resp.clone();
caches.open(CACHE).then(c => c.put(e.request, clone));
}
return resp;
});
})
);
});
