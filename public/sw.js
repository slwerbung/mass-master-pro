// Minimal, deliberately CACHE-FREE service worker.
//
// Its only job is to make Captfix an installable PWA on Android (Chrome
// requires a service worker with a fetch handler before it offers a real
// "install app" / standalone launch with the manifest icon). It must NEVER
// cache app assets: after a Vercel deploy the hashed JS chunks change, and a
// caching SW would serve stale files — exactly the "failed to load module"
// class of bug we fixed elsewhere. So every request goes straight to the
// network, unchanged.

self.addEventListener("install", () => {
  // Activate this version immediately, don't wait for old tabs to close.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Defensive: if any cache ever existed, drop it — we serve nothing cached.
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      } catch (_) { /* ignore */ }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  // Network-only passthrough. We only respondWith for top-level navigations
  // (enough to satisfy installability); everything else uses the browser's
  // default network path untouched. No caching anywhere.
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request));
  }
});
