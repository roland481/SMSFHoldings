/* ═══════════════════════════════════════════════════════════════════════════
   scheduler.js  —  Price caching, auto-refresh & daily snapshots
   ═══════════════════════════════════════════════════════════════════════════

   PRICE CACHING
   ─────────────
   Prices are cached in localStorage per asset type with a timestamp.
   On manual refresh: only fetches if cache is stale, otherwise loads
   from cache instantly and shows age in the UI.
   On auto-refresh (every 15 min): silently refreshes all stale prices.

   Cache TTLs:
     FX rate  : 60 minutes
     US stocks: 15 minutes  (market hours only)
     ASX      : 15 minutes
     Crypto   : 5  minutes  (volatile + CoinGecko rate limits)
     Metals   : 60 minutes  (infrequent updates + Xano rate limits)

   DAILY SNAPSHOTS
   ───────────────
   On login, checks if a snapshot has been saved today. If not, waits
   until prices are loaded (up to 30s) then saves one automatically.
   This replaces the "save on every refresh" behaviour.
   ═══════════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  /* ── Cache TTLs (milliseconds) ─────────────────────────────────────────── */
  var TTL = {
    rate:   60 * 60 * 1000,   // 60 min
    us:     15 * 60 * 1000,   // 15 min
    asx:    15 * 60 * 1000,   // 15 min
    cry:     5 * 60 * 1000,   //  5 min
    met:    60 * 60 * 1000,   // 60 min
    wl:     15 * 60 * 1000,   // 15 min
  };

  var AUTO_REFRESH_MS = 15 * 60 * 1000; // auto-refresh every 15 minutes
  var CACHE_PREFIX    = 'smsf_price_cache_';
  var SNAP_KEY        = 'smsf_last_snapshot_date';

  /* ── Cache helpers ─────────────────────────────────────────────────────── */
  function cacheKey(type) { return CACHE_PREFIX + type; }

  function saveCache(type, data) {
    try {
      localStorage.setItem(cacheKey(type), JSON.stringify({ ts: Date.now(), data: data }));
    } catch(e) {}
  }

  function loadCache(type) {
    try {
      var raw = localStorage.getItem(cacheKey(type));
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || !parsed.ts || !parsed.data) return null;
      return parsed; // { ts, data }
    } catch(e) { return null; }
  }

  function cacheAge(type) {
    var c = loadCache(type);
    if (!c) return Infinity;
    return Date.now() - c.ts;
  }

  function isStale(type) {
    return cacheAge(type) > TTL[type];
  }

  function fmtAge(ms) {
    if (ms === Infinity) return 'never';
    var s = Math.floor(ms / 1000);
    if (s < 60)  return s + 's ago';
    var m = Math.floor(s / 60);
    if (m < 60)  return m + 'm ago';
    var h = Math.floor(m / 60);
    return h + 'h ago';
  }

  /* ── Restore cached prices into S.prices ──────────────────────────────── */
  function restoreCached(type, prefix) {
    var c = loadCache(type);
    if (!c || !c.data) return false;
    // c.data is an object like { 'BTC': {price, change}, 'ETH': {price,change} }
    var keys = Object.keys(c.data);
    keys.forEach(function(k) {
      S.prices[(prefix || type) + ':' + k] = c.data[k];
    });
    return keys.length > 0;
  }

  function extractPrices(type, prefix) {
    // Extract current S.prices for a type into a plain object for caching
    var out = {};
    var pfx = (prefix || type) + ':';
    Object.keys(S.prices).forEach(function(k) {
      if (k.startsWith(pfx)) {
        out[k.slice(pfx.length)] = S.prices[k];
      }
    });
    return out;
  }

  /* ── Patched fetch functions ───────────────────────────────────────────── */
  // We wrap each fetch function to: load cache if fresh, or fetch + save cache if stale.

  function hookFetchRate() {
    var origFetchRate = window.fetchRate;
    if (!origFetchRate || origFetchRate._cached) return;

    window.fetchRate = async function() {
      if (!isStale('rate')) {
        var c = loadCache('rate');
        if (c && c.data && c.data.audUsd) {
          S.audUsd = c.data.audUsd;
          return;
        }
      }
      await origFetchRate();
      saveCache('rate', { audUsd: S.audUsd });
    };
    window.fetchRate._cached = true;
  }

  function hookFetchUS() {
    var orig = window.fetchUS;
    if (!orig || orig._cached) return;
    window.fetchUS = async function() {
      if (!isStale('us') && restoreCached('us', 'us')) {
        setDot('usDot', 'live');
        rows('us');
        return;
      }
      await orig();
      saveCache('us', extractPrices('us'));
    };
    window.fetchUS._cached = true;
  }

  function hookFetchASX() {
    var orig = window.fetchASX;
    if (!orig || orig._cached) return;
    window.fetchASX = async function() {
      if (!isStale('asx') && restoreCached('asx', 'asx')) {
        setDot('asxDot', 'live');
        rows('asx');
        return;
      }
      await orig();
      saveCache('asx', extractPrices('asx'));
    };
    window.fetchASX._cached = true;
  }

  function hookFetchCry() {
    var orig = window.fetchCry;
    if (!orig || orig._cached) return;
    window.fetchCry = async function() {
      if (!isStale('cry') && restoreCached('cry', 'cry')) {
        setDot('crypDot', 'live');
        rows('cry');
        return;
      }
      await orig();
      saveCache('cry', extractPrices('cry'));
    };
    window.fetchCry._cached = true;
  }

  function hookFetchMetals() {
    var orig = window.fetchMetals;
    if (!orig || orig._cached) return;
    window.fetchMetals = async function() {
      if (!isStale('met') && restoreCached('met', 'met')) {
        setDot('metDot', 'live');
        rows('met');
        return;
      }
      await orig();
      saveCache('met', extractPrices('met'));
    };
    window.fetchMetals._cached = true;
  }

  function hookFetchWl() {
    var orig = window.fetchWl;
    if (!orig || orig._cached) return;
    window.fetchWl = async function() {
      if (!isStale('wl')) {
        // Watchlist prices use 'wl:us:TICKER', 'wl:crypto:TICKER' etc — restore all
        var c = loadCache('wl');
        if (c && c.data) {
          Object.assign(S.prices, c.data);
          if (typeof renderWl === 'function') renderWl();
          return;
        }
      }
      await orig();
      // Cache all wl: prices
      var wlPrices = {};
      Object.keys(S.prices).forEach(function(k) {
        if (k.startsWith('wl:')) wlPrices[k] = S.prices[k];
      });
      saveCache('wl', wlPrices);
    };
    window.fetchWl._cached = true;
  }

  /* ── Update refresh button label to show cache age ─────────────────────── */
  function updateRefreshLabel() {
    var btn = document.getElementById('rfBtn');
    var lbl = btn && btn.querySelector('.rfbtn-label');
    if (!lbl) return;

    // Find the oldest stale type
    var types   = ['us','asx','cry','met'];
    var allFresh = types.every(function(t) { return !isStale(t); });

    if (allFresh) {
      // Show age of oldest cache
      var oldest = Math.max.apply(null, types.map(function(t) { return cacheAge(t); }));
      lbl.textContent = 'Prices · ' + fmtAge(oldest);
    } else {
      lbl.textContent = 'Refresh prices';
    }
  }

  /* ── Patch refreshAll to update label after ────────────────────────────── */
  function hookRefreshAll() {
    var orig = window.refreshAll;
    if (!orig || orig._cached) return;
    window.refreshAll = async function() {
      await orig();
      updateRefreshLabel();
    };
    window.refreshAll._cached = true;
  }

  /* ── Auto-refresh timer ─────────────────────────────────────────────────── */
  var _autoTimer = null;

  function startAutoRefresh() {
    if (_autoTimer) clearInterval(_autoTimer);
    _autoTimer = setInterval(function() {
      // Only auto-refresh if the app is visible and user is logged in
      if (document.hidden) return;
      if (!AUTH || !AUTH.currentPortfolioId) return;
      var rfBtn = document.getElementById('rfBtn');
      if (rfBtn && !rfBtn.disabled) {
        console.log('[scheduler] Auto-refreshing prices');
        window.refreshAll();
      }
    }, AUTO_REFRESH_MS);
  }

  /* ── Daily snapshot ─────────────────────────────────────────────────────── */
  function todayISO() {
    return new Date().toISOString().slice(0, 10);
  }

  function hasSnapshotToday() {
    try {
      return localStorage.getItem(SNAP_KEY) === todayISO();
    } catch(e) { return false; }
  }

  function markSnapshotToday() {
    try { localStorage.setItem(SNAP_KEY, todayISO()); } catch(e) {}
  }

  async function takeDailySnapshot() {
    if (hasSnapshotToday()) {
      console.log('[scheduler] Snapshot already taken today');
      return;
    }
    if (!AUTH || !AUTH.currentPortfolioId) return;

    // Wait for prices to be loaded (poll up to 30s)
    var waited = 0;
    while (Object.keys(S.prices).length === 0 && waited < 30000) {
      await new Promise(function(r) { setTimeout(r, 1000); });
      waited += 1000;
    }

    if (Object.keys(S.prices).length === 0) {
      console.log('[scheduler] No prices loaded — skipping snapshot');
      return;
    }

    // Calculate totals from DOM (same as refreshAll does)
    var val = parseFloat((document.getElementById('tot')?.textContent || '').replace(/[^0-9.]/g,'')) || 0;
    var inv = parseFloat((document.getElementById('tot-invested')?.textContent || '').replace(/[^0-9.]/g,'')) || 0;
    var csh = parseFloat((document.getElementById('tot-cash')?.textContent || '').replace(/[^0-9.]/g,'')) || 0;

    // If DOM isn't ready yet, calculate from S directly
    if (val === 0) {
      var r = S.audUsd || 0.695;
      S.us.forEach(function(h) { var p=S.prices['us:'+h.ticker]; if(p&&h.qty) inv += (p.price/r)*h.qty; });
      S.asx.forEach(function(h) { var p=S.prices['asx:'+h.ticker]; if(p&&h.qty) inv += p.price*h.qty; });
      S.cry.forEach(function(h) { var p=S.prices['cry:'+h.ticker]; if(p&&h.qty) inv += p.price*h.qty; });
      S.met.forEach(function(h) { var p=S.prices['met:'+h.ticker]; if(p&&h.qty) inv += p.price*h.qty; });
      csh = S.cash.reduce(function(s,a){ return s+(a.balance||0); }, 0);
      val = inv + csh;
    }

    if (val <= 0) {
      console.log('[scheduler] Portfolio value is zero — skipping snapshot');
      return;
    }

    try {
      console.log('[scheduler] Saving daily snapshot — value: $' + val.toFixed(2));
      await xanoSaveSnapshot(AUTH.currentPortfolioId, val, inv, csh);
      markSnapshotToday();

      // Reload and re-render history chart
      var snapshots = await xanoLoadSnapshots(AUTH.currentPortfolioId);
      if (snapshots && snapshots.length) {
        var history = snapshots
          .sort(function(a,b){ return a.date > b.date ? 1 : -1; })
          .map(function(s){ return { d:s.date, v:parseFloat(s.value)||0, invested:parseFloat(s.invested)||0, cash:parseFloat(s.cash)||0 }; });
        S.snapshots = history;
        try { localStorage.setItem(HISTORY_KEY + '_' + AUTH.currentPortfolioId, JSON.stringify(history)); } catch(e) {}
        if (typeof renderHistoryChart === 'function') renderHistoryChart(history);
      }
      console.log('[scheduler] Daily snapshot saved successfully');
    } catch(e) {
      console.warn('[scheduler] Daily snapshot failed:', e);
    }
  }

  /* ── Remove snapshot from refreshAll ───────────────────────────────────── */
  // The snapshot is now handled daily by the scheduler above.
  // We patch refreshAll to remove the snapshot logic so it doesn't
  // fire on every manual refresh.
  function removeSnapshotFromRefresh() {
    var orig = window.refreshAll;
    if (!orig || orig._snapRemoved) return;
    var origStr = orig.toString();

    // Only patch if our hooks haven't already replaced it
    // We do this by wrapping and suppressing xanoSaveSnapshot during refreshAll
    var origSave = window.xanoSaveSnapshot;
    window.refreshAll = async function() {
      // Temporarily disable snapshot saving during refresh
      window.xanoSaveSnapshot = async function() {};
      try {
        await orig.call(this);
      } finally {
        // Restore after refresh completes
        window.xanoSaveSnapshot = origSave;
      }
      updateRefreshLabel();
    };
    window.refreshAll._snapRemoved = true;
    window.refreshAll._cached = true;
  }

  /* ── Update label every minute ─────────────────────────────────────────── */
  function startLabelTimer() {
    updateRefreshLabel();
    setInterval(updateRefreshLabel, 60000);
  }

  /* ── Boot ───────────────────────────────────────────────────────────────── */
  function hookAll() {
    hookFetchRate();
    hookFetchUS();
    hookFetchASX();
    hookFetchCry();
    hookFetchMetals();
    hookFetchWl();
    removeSnapshotFromRefresh();
    updateRefreshLabel();
  }

  function boot() {
    // Hook fetch functions after app has defined them
    var attempts = 0;
    var iv = setInterval(function() {
      attempts++;
      if (typeof window.fetchUS === 'function' && typeof window.refreshAll === 'function') {
        hookAll();
        startLabelTimer();
        startAutoRefresh();
        clearInterval(iv);
        console.log('[scheduler] Initialised — auto-refresh every 15 min, daily snapshots enabled');
      }
      if (attempts > 40) clearInterval(iv);
    }, 250);

    // Daily snapshot — wait for auth then trigger
    var snapAttempts = 0;
    var snapIv = setInterval(function() {
      snapAttempts++;
      if (AUTH && AUTH.currentPortfolioId) {
        clearInterval(snapIv);
        // Wait a bit for prices to load from cache/API
        setTimeout(takeDailySnapshot, 5000);
      }
      if (snapAttempts > 120) clearInterval(snapIv); // give up after 30s
    }, 250);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})();
