const CACHE = "photo-translator-pwa-v15";
const ASSETS = [
  "./",
  "./index.html",
  "./app.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

// Install: cache what we can (do not fail the whole install if one file is missing)
self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const results = await Promise.allSettled(
      ASSETS.map((u) => cache.add(new Request(u, { cache: "reload" })))
    );
    // If everything failed, we still want the SW installed; offline won't work but it avoids "stuck" state.
    // (No throw here.)
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => k.startsWith("photo-") || k.startsWith("photo-translator") || k.startsWith("photo-tagger"))
        .filter((k) => k !== CACHE)
        .map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);

  // Only handle same-origin requests
  if (url.origin !== location.origin) return;

  // Navigation: network-first, fallback to cached shell
  if (req.mode === "navigate") {
    e.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE);
        cache.put("./", fresh.clone());
        return fresh;
      } catch (err) {
        return (await caches.match("./")) || (await caches.match("./index.html"));
      }
    })());
    return;
  }

  // Static: stale-while-revalidate
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req);
    const fetchPromise = fetch(req).then((fresh) => {
      cache.put(req, fresh.clone());
      return fresh;
    }).catch(() => null);

    return cached || (await fetchPromise) || cached;
  })());
});
