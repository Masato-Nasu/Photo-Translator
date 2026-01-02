const CACHE = "photo-tagger-pwa-v1";
const ASSETS = ["./","./index.html","./app.js","./manifest.json","./icons/icon-192.png","./icons/icon-512.png","./README.md"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (e) => {
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request)));
});
