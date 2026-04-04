/* ═══════════════════════════════════════════════════════════════════════════
   sw.js — SMSF Portfolio Tracker Service Worker
   ───────────────────────────────────────────────────────────────────────────
   Minimal service worker. Required for PWA installability on Android.
   Does NOT cache anything (your data comes from Xano, caching would cause
   stale data issues). Just enables the "Add to Home Screen" prompt.
   ═══════════════════════════════════════════════════════════════════════════ */

const CACHE_NAME = 'smsf-pwa-v1';

// On install — cache only the shell assets needed to load the app
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll([
        '/',
        '/index.html',
        '/css/styles.css',
        '/js/config.js',
        '/js/state.js',
        '/js/charts.js',
        '/js/auth.js',
        '/js/ui.js',
        '/js/app.js',
        '/js/modals.js',
        '/js/imports.js',
        '/js/cgt.js',
        '/js/cgt-patch.js',
        '/js/eofy-report.js',
        '/js/scheduler.js',
        '/js/ui-improvements.js'
      ]);
    })
  );
  self.skipWaiting();
});

// On activate — clean up old caches
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE_NAME; })
            .map(function(k) { return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});

// Fetch strategy: Network first, fall back to cache for shell assets.
// API calls (Xano, CoinGecko etc.) always go to network — never cached.
self.addEventListener('fetch', function(event) {
  var url = event.request.url;

  // Always fetch API calls from network — never serve stale financial data
  if (url.includes('xano.io') ||
      url.includes('coingecko') ||
      url.includes('finnhub') ||
      url.includes('yahoo') ||
      url.includes('frankfurter') ||
      url.includes('goldapi')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // For app shell: network first, cache fallback
  event.respondWith(
    fetch(event.request)
      .then(function(response) {
        // Update cache with fresh response
        if (response && response.status === 200 && event.request.method === 'GET') {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(event.request, clone);
          });
        }
        return response;
      })
      .catch(function() {
        // Network failed — try cache (works offline for the app shell)
        return caches.match(event.request);
      })
  );
});
