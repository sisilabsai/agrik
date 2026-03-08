const SHELL_CACHE = "agrik-shell-v2";
const RUNTIME_CACHE = "agrik-runtime-v2";
const STATIC_ASSETS = [
  "/",
  "/offline.html",
  "/manifest.webmanifest",
  "/favicon.ico",
  "/pwa/icon-192.png",
  "/pwa/icon-512.png",
  "/pwa/maskable-192.png",
  "/pwa/maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(STATIC_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => ![SHELL_CACHE, RUNTIME_CACHE].includes(key)).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          if (response.ok) {
            const cache = await caches.open(RUNTIME_CACHE);
            cache.put(request, response.clone());
          }
          return response;
        } catch {
          const cachedPage = await caches.match(request);
          if (cachedPage) return cachedPage;
          const appShell = await caches.match("/");
          if (appShell) return appShell;
          const offlineFallback = await caches.match("/offline.html");
          return offlineFallback || Response.error();
        }
      })()
    );
    return;
  }

  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/pwa/") || url.pathname === "/favicon.ico") {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request);
        const fetchPromise = fetch(request)
          .then((response) => {
            if (response.ok) {
              const clone = response.clone();
              caches.open(SHELL_CACHE).then((cache) => cache.put(request, clone));
            }
            return response;
          })
          .catch(() => cached || Response.error());
        return cached || fetchPromise;
      })()
    );
  }
});
