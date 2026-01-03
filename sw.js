const CACHE = "photo-tagger-pwa-v5";
const ASSETS = ["./","./index.html","./app.js","./manifest.json","./icons/icon-192.png","./icons/icon-512.png","./README.md"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== "photo-tagger-pwa-v5").map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request)));
});


self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
