/* ═══════════════════════════════════════════════════════════════════════════
   ui-improvements.js  —  UI enhancements
   ───────────────────────────────────────────────────────────────────────────
   1. Sidebar search — filters holdings table and ledger in real time
   2. History chart meta — shows snapshot count + date range
   3. History chart tooltip — date + value on hover
   4. CGT tab — last calculated timestamp
   ═══════════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  /* ── helpers ─────────────────────────────────────────────────────────────── */
  function getS()    { return (typeof S !== 'undefined' ? S : window.S); }
  function getAUTH() { return (typeof AUTH !== 'undefined' ? AUTH : window.AUTH); }

  /* ══════════════════════════════════════════════════════════════════════════
     1. SIDEBAR SEARCH
     ─────────────────
     Filters the unified holdings table (allHoldingsB) in real time as the
     user types. Matches against ticker OR name (case-insensitive).
     Also filters ledger rows on the Transactions tab.
     Clears automatically when switching tabs.
  ══════════════════════════════════════════════════════════════════════════ */
  var _searchTerm = '';

  window.onSidebarSearch = function(val) {
    _searchTerm = (val || '').trim().toLowerCase();
    var clearBtn = document.getElementById('sidebarSearchClear');
    if (clearBtn) clearBtn.style.display = _searchTerm ? 'block' : 'none';
    _applyHoldingsSearch();
    _applyLedgerSearch();
  };

  window.clearSidebarSearch = function() {
    var input = document.getElementById('sidebarSearch');
    if (input) input.value = '';
    window.onSidebarSearch('');
    if (input) input.focus();
  };

  function _applyHoldingsSearch() {
    var body = document.getElementById('allHoldingsB');
    if (!body) return;
    var rows = body.querySelectorAll('tr.holding-row, tr.tx-row');
    if (!_searchTerm) {
      rows.forEach(function(r) { r.style.display = ''; });
      _updateSearchCount(null);
      return;
    }
    var visible = 0;
    var lastHoldingRow = null;
    rows.forEach(function(r) {
      if (r.classList.contains('tx-row')) {
        // Show/hide drawer row based on its preceding holding row
        r.style.display = lastHoldingRow && lastHoldingRow.style.display !== 'none' ? '' : 'none';
        return;
      }
      // Holding row — match ticker or name
      var ticker = (r.querySelector('.tkr-sym') || r.querySelector('.sym') || {}).textContent || '';
      var name   = (r.querySelector('.tkr-name') || r.querySelector('.aname') || {}).textContent || '';
      var match  = ticker.toLowerCase().includes(_searchTerm) || name.toLowerCase().includes(_searchTerm);
      r.style.display = match ? '' : 'none';
      if (match) visible++;
      lastHoldingRow = r;
    });
    _updateSearchCount(visible);
  }

  function _applyLedgerSearch() {
    var body = document.getElementById('feesB');
    if (!body) return;
    var rows = body.querySelectorAll('tr');
    if (!_searchTerm) {
      rows.forEach(function(r) { r.style.display = ''; });
      return;
    }
    rows.forEach(function(r) {
      var text = (r.textContent || '').toLowerCase();
      r.style.display = text.includes(_searchTerm) ? '' : 'none';
    });
  }

  function _updateSearchCount(count) {
    var dot = document.getElementById('allDot');
    if (!dot) return;
    var parent = dot.parentElement;
    var badge = document.getElementById('searchCountBadge');
    if (count === null) {
      if (badge) badge.remove();
      return;
    }
    if (!badge) {
      badge = document.createElement('span');
      badge.id = 'searchCountBadge';
      badge.style.cssText = 'font-size:11px;color:var(--text3);margin-left:4px;';
      parent.appendChild(badge);
    }
    badge.textContent = count + ' result' + (count !== 1 ? 's' : '');
  }

  // Clear search when switching tabs
  var _origSwitchTab = null;
  function hookSwitchTabForSearch() {
    if (typeof window.switchTab !== 'function' || window.switchTab._uiSearch) return false;
    var orig = window.switchTab;
    window.switchTab = function(name) {
      // Don't clear search — let it persist across tabs (useful for ledger)
      orig.call(this, name);
      // Re-apply search to newly visible content
      setTimeout(function() {
        _applyHoldingsSearch();
        _applyLedgerSearch();
      }, 80);
    };
    window.switchTab._uiSearch = true;
    return true;
  }

  // Also re-apply after renderAllHoldings or renderFees are called
  function hookRenderFunctions() {
    var origRenderAll = window.renderAllHoldings;
    if (origRenderAll && !origRenderAll._uiSearch) {
      window.renderAllHoldings = function() {
        origRenderAll.apply(this, arguments);
        if (_searchTerm) setTimeout(_applyHoldingsSearch, 50);
      };
      window.renderAllHoldings._uiSearch = true;
    }
    var origRenderFees = window.renderFees;
    if (origRenderFees && !origRenderFees._uiSearch) {
      window.renderFees = function() {
        origRenderFees.apply(this, arguments);
        if (_searchTerm) setTimeout(_applyLedgerSearch, 50);
      };
      window.renderFees._uiSearch = true;
    }
  }

  /* ══════════════════════════════════════════════════════════════════════════
     2. HISTORY CHART META — show snapshot count + date range
  ══════════════════════════════════════════════════════════════════════════ */
  function updateHistoryMeta() {
    var el = document.getElementById('historyMeta');
    if (!el) return;
    var state = getS();
    var snaps = (state && state.snapshots) || [];
    if (!snaps.length) {
      el.textContent = 'Daily snapshots';
      return;
    }
    var count = snaps.length;
    // Date range
    var sorted = snaps.slice().sort(function(a,b){ return a.d > b.d ? 1 : -1; });
    var first  = sorted[0].d;
    var last   = sorted[sorted.length - 1].d;
    function fmt(d) {
      if (!d) return '?';
      var dt = new Date(d + 'T00:00:00');
      return dt.toLocaleDateString('en-AU', { day:'numeric', month:'short' });
    }
    el.textContent = count + ' snapshot' + (count !== 1 ? 's' : '') + ' · ' + fmt(first) + ' – ' + fmt(last);
  }

  // Hook renderHistoryChart to update meta after it runs
  function hookHistoryChart() {
    var orig = window.renderHistoryChart;
    if (!orig || orig._uiMeta) return false;
    window.renderHistoryChart = function(data) {
      orig.apply(this, arguments);
      updateHistoryMeta();
      if (data && data.length) addChartTooltip();
    };
    window.renderHistoryChart._uiMeta = true;
    return true;
  }

  /* ══════════════════════════════════════════════════════════════════════════
     3. HISTORY CHART TOOLTIP — date + value on hover
     Uses Chart.js built-in tooltip config patched after chart creation.
  ══════════════════════════════════════════════════════════════════════════ */
  function addChartTooltip() {
    var chart = window.historyChart;
    if (!chart) return;
    try {
      // Enable tooltip if not already configured
      if (chart.options.plugins && chart.options.plugins.tooltip &&
          chart.options.plugins.tooltip._uiPatched) return;

      chart.options.plugins = chart.options.plugins || {};
      chart.options.plugins.tooltip = {
        _uiPatched: true,
        enabled: true,
        mode: 'index',
        intersect: false,
        backgroundColor: 'rgba(33,40,81,0.92)',
        borderColor: 'rgba(87,87,232,0.3)',
        borderWidth: 1,
        titleColor: '#9b9fc8',
        bodyColor: '#e8e9f4',
        padding: 10,
        cornerRadius: 8,
        displayColors: false,
        callbacks: {
          title: function(items) {
            if (!items.length) return '';
            var state = getS();
            var snaps = (state && state.snapshots) || [];
            var idx = items[0].dataIndex;
            var sorted = snaps.slice().sort(function(a,b){ return a.d>b.d?1:-1; });
            var snap = sorted[idx];
            if (!snap || !snap.d) return '';
            var d = new Date(snap.d + 'T00:00:00');
            return d.toLocaleDateString('en-AU', { weekday:'short', day:'numeric', month:'short', year:'numeric' });
          },
          label: function(item) {
            var state = getS();
            var snaps = (state && state.snapshots) || [];
            var sorted = snaps.slice().sort(function(a,b){ return a.d>b.d?1:-1; });
            var snap = sorted[item.dataIndex];
            if (!snap) return '$' + item.formattedValue;
            var lines = [];
            var val = parseFloat(snap.v) || 0;
            lines.push('Total:    $' + val.toLocaleString('en-AU', {minimumFractionDigits:0, maximumFractionDigits:0}));
            if (snap.invested > 0) {
              lines.push('Invested: $' + (parseFloat(snap.invested)||0).toLocaleString('en-AU', {minimumFractionDigits:0, maximumFractionDigits:0}));
            }
            if (snap.cash > 0) {
              lines.push('Cash:     $' + (parseFloat(snap.cash)||0).toLocaleString('en-AU', {minimumFractionDigits:0, maximumFractionDigits:0}));
            }
            return lines;
          }
        }
      };

      // Also add crosshair line
      chart.options.plugins.crosshair = chart.options.plugins.crosshair || {};
      chart.options.interaction = { mode: 'index', intersect: false };

      chart.update('none');
    } catch(e) {
      console.warn('[ui] Chart tooltip patch failed:', e);
    }
  }

  /* ══════════════════════════════════════════════════════════════════════════
     4. CGT TAB — last calculated timestamp
  ══════════════════════════════════════════════════════════════════════════ */
  function hookCGTRender() {
    var orig = window.renderCGTTab;
    if (!orig || orig._uiTimestamp) return false;
    window.renderCGTTab = function() {
      orig.apply(this, arguments);
      var el = document.getElementById('cgtLastCalc');
      if (el) {
        var now = new Date();
        el.textContent = 'Calculated ' + now.toLocaleTimeString('en-AU', {
          hour: '2-digit', minute: '2-digit'
        });
      }
    };
    window.renderCGTTab._uiTimestamp = true;
    return true;
  }

  /* ══════════════════════════════════════════════════════════════════════════
     5. SESSIONS BAR — make more compact, remove countdown text on mobile
  ══════════════════════════════════════════════════════════════════════════ */
  // The sessions bar is already compact enough on mobile via CSS.
  // We improve it by updating the history meta when snapshots are loaded.
  function hookLoadPortfolio() {
    // Watch for S.snapshots being set and update meta
    var origLoad = window.loadPortfolio;
    if (!origLoad || origLoad._uiMeta) return false;
    window.loadPortfolio = async function() {
      var result = await origLoad.apply(this, arguments);
      setTimeout(updateHistoryMeta, 500);
      return result;
    };
    window.loadPortfolio._uiMeta = true;
    return true;
  }

  /* ── Boot ───────────────────────────────────────────────────────────────── */
  function tryHookAll() {
    var allDone = true;
    if (!hookSwitchTabForSearch()) allDone = false;
    if (!hookRenderFunctions()) {}
    if (!hookHistoryChart()) allDone = false;
    if (!hookCGTRender()) allDone = false;
    if (!hookLoadPortfolio()) allDone = false;

    // Also try to patch existing chart immediately if it exists
    if (window.historyChart) addChartTooltip();
    updateHistoryMeta();

    return allDone;
  }

  /* ── Mobile subtitle — show portfolio name + date under SMSF title ── */
  function updateMobileSubtitle() {
    var el = document.getElementById('mobileSubtitle');
    if (!el) return;
    if (window.innerWidth > 800) { el.style.display = 'none'; return; }
    var auth  = getAUTH();
    var portfolio = auth && auth.portfolios
      ? auth.portfolios.find(function(p){ return p.id === auth.currentPortfolioId; })
      : null;
    var name = portfolio ? portfolio.name : '';
    var date = new Date().toLocaleDateString('en-AU', { weekday:'short', day:'numeric', month:'short' });
    el.textContent = (name ? name + ' · ' : '') + date;
    el.style.display = 'block';
  }

  function boot() {
    var attempts = 0;
    var iv = setInterval(function() {
      attempts++;
      tryHookAll();
      // Keep trying to patch chart until it exists
      if (window.historyChart) addChartTooltip();
      if (attempts > 60) clearInterval(iv);
    }, 300);

    // Mobile subtitle
    updateMobileSubtitle();
    window.addEventListener('resize', updateMobileSubtitle);
    // Re-run after auth loads
    var subIv = setInterval(function() {
      var auth = getAUTH();
      if (auth && auth.currentPortfolioId) { updateMobileSubtitle(); clearInterval(subIv); }
    }, 500);

    // Keyboard shortcut: Cmd/Ctrl+K focuses search
    document.addEventListener('keydown', function(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        var input = document.getElementById('sidebarSearch');
        if (input) {
          input.focus();
          input.select();
          // On mobile, open sidebar first
          if (window.innerWidth <= 800) {
            if (typeof openMobileSidebar === 'function') openMobileSidebar();
          }
        }
      }
      // Escape clears search
      if (e.key === 'Escape' && document.activeElement === document.getElementById('sidebarSearch')) {
        window.clearSidebarSearch();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})();
