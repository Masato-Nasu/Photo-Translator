const CACHE = "photo-tagger-pwa-v6";
const ASSETS = ["./","./index.html","./app.js","./manifest.json","./icons/icon-192.png","./icons/icon-512.png","./README.md"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== "photo-tagger-pwa-v6").map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  const isSameOrigin = url.origin === self.location.origin;
  const isNav = req.mode === "navigate" || req.destination === "document";
  if (isSameOrigin && isNav){
    // Network-first for HTML to make updates show up reliably
    e.respondWith((async () => {
      try{
        const fresh = await fetch(req);
        const c = await caches.open(CACHE);
        c.put(req, fresh.clone());
        return fresh;
      }catch(e2){
        const hit = await caches.match(req);
        return hit || caches.match("./index.html");
      }
    })());
    return;
  }
  // Cache-first for static assets
  e.respondWith(caches.match(req).then(hit => hit || fetch(req)));
});
