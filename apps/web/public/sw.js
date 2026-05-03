/* eslint-disable */
// AppoinlyCRM service worker.
//
// Strategy:
//   • Static assets (/_next/static/**, /icon-*, manifest)  → stale-while-revalidate
//   • API calls (/api/*)                                    → network-first, no cache
//                                                            (auth endpoints are NEVER cached)
//   • HTML navigations                                      → network-first, fallback to /offline
//   • Everything else                                       → network-first, cache fallback
//
// Push:
//   • push event   → showNotification with payload {title, body, url, tag, icon}
//   • notification click → focus existing tab if open, else open new
//
// Bumping CACHE_VERSION invalidates all old caches on the next activate.
//
// Hand-rolled (no Workbox) to keep the bundle small.

const CACHE_VERSION = 'v2';
const STATIC_CACHE = `appoinly-static-${CACHE_VERSION}`;
const PAGES_CACHE = `appoinly-pages-${CACHE_VERSION}`;
const RUNTIME_CACHE = `appoinly-runtime-${CACHE_VERSION}`;
const OFFLINE_URL = '/offline';

// Pre-cache the offline shell so an offline navigation has something to show.
const PRECACHE_URLS = [OFFLINE_URL, '/manifest.json', '/icon-192.svg', '/icon-512.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      // Use no-cache requests so we don't pull a stale offline page from the
      // HTTP cache during the SW install.
      await Promise.all(
        PRECACHE_URLS.map((url) =>
          cache
            .add(new Request(url, { cache: 'reload' }))
            .catch(() => undefined),
        ),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter(
            (k) =>
              k.startsWith('appoinly-') &&
              k !== STATIC_CACHE &&
              k !== PAGES_CACHE &&
              k !== RUNTIME_CACHE,
          )
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

// ──────────────────────────────────────────────────────────────────────
// Fetch routing
// ──────────────────────────────────────────────────────────────────────

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only handle GET — POST/PATCH/DELETE etc. should never be cached.
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Cross-origin requests (CDN images, third-party widgets, the API on a
  // different host) — let the browser handle them with default policy.
  if (url.origin !== self.location.origin) return;

  // Auth endpoints: NEVER cache (token rotation, MFA, etc).
  if (url.pathname.startsWith('/api/v1/auth/')) return;

  // API calls: network-first, fall through to the network. Don't cache —
  // CRM data is volatile and personalised.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(req).catch(() =>
        new Response(
          JSON.stringify({
            error: 'offline',
            message: 'No network connection. Please retry.',
          }),
          {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      ),
    );
    return;
  }

  // Static Next.js assets: hashed → safe for stale-while-revalidate.
  if (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icon-') ||
    url.pathname === '/manifest.json'
  ) {
    event.respondWith(staleWhileRevalidate(req, STATIC_CACHE));
    return;
  }

  // HTML navigations: network-first, fallback to cache, then to /offline.
  if (req.mode === 'navigate' || req.headers.get('accept')?.includes('text/html')) {
    event.respondWith(networkFirstNavigation(req));
    return;
  }

  // Everything else (fonts, dynamic JSON, etc.): network-first runtime cache.
  event.respondWith(networkFirstRuntime(req));
});

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const networkPromise = fetch(request)
    .then((res) => {
      // Only cache 200 OK basic/cors responses.
      if (res && res.status === 200 && (res.type === 'basic' || res.type === 'cors')) {
        cache.put(request, res.clone()).catch(() => undefined);
      }
      return res;
    })
    .catch(() => undefined);

  // If we have a cached response, return it immediately and let the network
  // refresh it in the background. Otherwise wait for the network.
  return cached || networkPromise || new Response('', { status: 504 });
}

async function networkFirstNavigation(request) {
  try {
    const res = await fetch(request);
    // Cache successful HTML responses so reload-while-offline works.
    if (res && res.status === 200) {
      const cache = await caches.open(PAGES_CACHE);
      cache.put(request, res.clone()).catch(() => undefined);
    }
    return res;
  } catch {
    const cache = await caches.open(PAGES_CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;
    const offline = await caches.match(OFFLINE_URL);
    if (offline) return offline;
    return new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
  }
}

async function networkFirstRuntime(request) {
  try {
    const res = await fetch(request);
    if (res && res.status === 200 && (res.type === 'basic' || res.type === 'cors')) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(request, res.clone()).catch(() => undefined);
    }
    return res;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response('', { status: 504 });
  }
}

// ──────────────────────────────────────────────────────────────────────
// Push notifications
// ──────────────────────────────────────────────────────────────────────

self.addEventListener('push', (event) => {
  // Best-effort parse — a malformed payload still shows a generic notification.
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch {
      try {
        data = { title: 'AppoinlyCRM', body: event.data.text() };
      } catch {
        data = { title: 'AppoinlyCRM' };
      }
    }
  }

  const title = data.title || 'AppoinlyCRM';
  const options = {
    body: data.body || '',
    icon: data.icon || '/icon-192.svg',
    badge: '/icon-192.svg',
    tag: data.tag,
    // tag without renotify=true silently replaces a previous one of the same tag.
    // For "ticket replied" repeats we want the latest only — the default behaviour.
    data: {
      url: data.url || '/',
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });

      // If a window is already open at the same origin, focus it and post
      // a navigation message — avoids spawning duplicate tabs on every push.
      for (const client of allClients) {
        try {
          const u = new URL(client.url);
          if (u.origin === self.location.origin) {
            await client.focus();
            // Best-effort: ask the focused tab to navigate to the deep link.
            client.postMessage({ type: 'sw:navigate', url: targetUrl });
            return;
          }
        } catch {
          /* ignore malformed client urls */
        }
      }

      // No window open — open a fresh one at the deep link.
      if (self.clients.openWindow) {
        await self.clients.openWindow(targetUrl);
      }
    })(),
  );
});

// Allow the page to trigger an immediate update (e.g. after a deploy banner).
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
