// ══════════════════════════════════════════════════════════════
// NEW UI ADAPTER — hooks the redesigned dashboard into your
// existing Xano-loaded S state object. Non-destructive: reads
// from S, writes to new DOM nodes only. Drop-in replacement for
// the portfolio tab's rendering.
// ══════════════════════════════════════════════════════════════
(function(){
  'use strict';

  // ── Formatters ───────────────────────────────────────────────
  const fmtAUD = (n, d = 2) => {
    if (n === null || n === undefined || isNaN(n)) return '—';
    return '$' + n.toLocaleString('en-AU', { minimumFractionDigits: d, maximumFractionDigits: d });
  };
  const fmtCompact = (n) => {
    if (n === null || isNaN(n)) return '—';
    if (Math.abs(n) >= 1000) return '$' + (n / 1000).toFixed(1) + 'k';
    return '$' + n.toFixed(0);
  };
  const fmtDate = (d) => new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });

  // ── Smoothing (Catmull-Rom → Bezier) ─────────────────────────
  function smoothPath(points) {
    if (points.length < 2) return '';
    let d = `M ${points[0].x},${points[0].y}`;
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i - 1] || points[i];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[i + 2] || p2;
      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;
      d += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`;
    }
    return d;
  }

  // ── Compute totals from S state ──────────────────────────────
  function computeTotals() {
    const s = window.S || {};
    const prices = s.prices || {};
    const aud_usd = s.audUsd || 0.695;
    let invested = 0, marketValue = 0;

    ['us','asx','cry','met'].forEach(type => {
      (s[type] || []).forEach(h => {
        const qty = Number(h.qty) || 0;
        const cost = Number(h.cost) || 0;
        const priceKey = h.ticker;
        let price = (prices[priceKey] != null) ? prices[priceKey] : cost;
        // US stocks priced in USD — convert to AUD
        if (type === 'us' && aud_usd) price = price / aud_usd;
        const mv = qty * price;
        marketValue += mv;
        invested += qty * cost;
      });
    });

    const cash = (s.cash || []).reduce((sum, c) => sum + (Number(c.balance) || 0), 0);
    const total = marketValue + cash;
    const gainAbs = marketValue - invested;
    const gainPct = invested > 0 ? (gainAbs / invested) * 100 : 0;

    return { total, marketValue, invested, cash, gainAbs, gainPct, aud_usd };
  }

  // ── Build allocation breakdown (by type) ─────────────────────
  function computeAllocation() {
    const s = window.S || {};
    const prices = s.prices || {};
    const aud_usd = s.audUsd || 0.695;
    const buckets = {
      'AU Stocks': { value: 0, color: 'oklch(70% 0.14 155)' },
      'US Stocks': { value: 0, color: 'oklch(68% 0.16 260)' },
      'Crypto':    { value: 0, color: 'oklch(72% 0.15 60)' },
      'Metals':    { value: 0, color: 'oklch(78% 0.13 85)' },
      'Cash':      { value: 0, color: 'oklch(72% 0.14 188)' },
    };
    const typeMap = { us: 'US Stocks', asx: 'AU Stocks', cry: 'Crypto', met: 'Metals' };

    ['us','asx','cry','met'].forEach(type => {
      (s[type] || []).forEach(h => {
        const qty = Number(h.qty) || 0;
        let price = (prices[h.ticker] != null) ? prices[h.ticker] : (Number(h.cost) || 0);
        if (type === 'us' && aud_usd) price = price / aud_usd;
        buckets[typeMap[type]].value += qty * price;
      });
    });
    buckets['Cash'].value = (s.cash || []).reduce((sum, c) => sum + (Number(c.balance) || 0), 0);

    const total = Object.values(buckets).reduce((a, b) => a + b.value, 0) || 1;
    return Object.entries(buckets)
      .map(([name, b]) => ({ name, value: b.value, color: b.color, pct: (b.value / total) * 100 }))
      .filter(b => b.value > 0)
      .sort((a, b) => b.value - a.value);
  }

  // ── Build holdings rows (flat list across types) ─────────────
  function computeHoldings() {
    const s = window.S || {};
    const prices = s.prices || {};
    const aud_usd = s.audUsd || 0.695;
    const rows = [];
    const typeColors = {
      us: 'oklch(68% 0.16 260)', asx: 'oklch(70% 0.14 155)',
      cry: 'oklch(72% 0.15 60)', met: 'oklch(78% 0.13 85)',
    };
    const typeLabel = { us: 'US', asx: 'AU', cry: 'CRYPTO', met: 'METAL' };
    ['us','asx','cry','met'].forEach(type => {
      (s[type] || []).forEach(h => {
        const qty = Number(h.qty) || 0;
        const cost = Number(h.cost) || 0;
        let price = (prices[h.ticker] != null) ? prices[h.ticker] : cost;
        if (type === 'us' && aud_usd) price = price / aud_usd;
        const mv = qty * price;
        const costBasis = qty * cost;
        const pnlAbs = mv - costBasis;
        const pnlPct = costBasis > 0 ? (pnlAbs / costBasis) * 100 : 0;
        rows.push({
          ticker: h.ticker, name: h.name || h.ticker, type, market: typeLabel[type],
          qty, price, marketValue: mv, costBasis, pnlAbs, pnlPct,
          trend: pnlPct > 0.5 ? 'up' : pnlPct < -0.5 ? 'down' : 'flat',
          color: typeColors[type],
        });
      });
    });
    return rows.sort((a, b) => b.marketValue - a.marketValue);
  }

  // ── Render hero ──────────────────────────────────────────────
  function renderHero() {
    const t = computeTotals();
    const el = (id) => document.getElementById(id);
    if (el('nx-total'))    el('nx-total').textContent = fmtAUD(t.total);
    if (el('nx-invested')) el('nx-invested').textContent = fmtAUD(t.invested);
    if (el('nx-mv'))       el('nx-mv').textContent = fmtAUD(t.marketValue);
    if (el('nx-cash'))     el('nx-cash').textContent = fmtAUD(t.cash);
    if (el('nx-fx'))       el('nx-fx').textContent = t.aud_usd.toFixed(4);
    const gainEl = el('nx-gain');
    if (gainEl) {
      const sign = t.gainAbs >= 0 ? '+' : '';
      gainEl.textContent = `${sign}${fmtAUD(t.gainAbs)} (${sign}${t.gainPct.toFixed(2)}%)`;
      gainEl.className = 'nx-gain ' + (t.gainAbs >= 0 ? 'pos' : 'neg');
    }
  }

  // ── Render donut ─────────────────────────────────────────────
  function renderDonut() {
    const wrap = document.getElementById('nx-donut');
    const legend = document.getElementById('nx-legend');
    if (!wrap || !legend) return;
    const items = computeAllocation();
    if (!items.length) { wrap.innerHTML = ''; legend.innerHTML = '<div style="color:var(--text4);font-size:12px;">No holdings</div>'; return; }

    const r = 62, circ = 2 * Math.PI * r;
    let offset = 0;
    const segs = items.map(it => {
      const len = (it.pct / 100) * circ;
      const seg = { ...it, dash: len, gap: circ - len, offset };
      offset += len;
      return seg;
    });

    wrap.innerHTML = `
      <svg class="nx-donut" viewBox="0 0 160 160" style="width:160px;height:160px;transform:rotate(-90deg);">
        ${segs.map(s => `<circle cx="80" cy="80" r="${r}" fill="none" stroke="${s.color}" stroke-width="18"
          stroke-dasharray="${s.dash} ${s.gap}" stroke-dashoffset="${-s.offset}"/>`).join('')}
      </svg>
      <div class="nx-donut-center">
        <div class="nx-donut-big">${items.length}</div>
        <div class="nx-donut-sub">Classes</div>
      </div>
    `;
    legend.innerHTML = items.map(it => `
      <div class="nx-legend-row">
        <span class="nx-swatch" style="background:${it.color}"></span>
        <span class="nx-legend-name">${it.name}</span>
        <span class="nx-legend-pct">${it.pct.toFixed(1)}%</span>
        <span class="nx-legend-val">${fmtCompact(it.value)}</span>
      </div>
    `).join('');
  }

  // ── Render holdings table ────────────────────────────────────
  function renderHoldingsTable() {
    const tbody = document.getElementById('nx-holdings-body');
    if (!tbody) return;
    const rows = computeHoldings();
    if (!rows.length) { tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text4);padding:24px;">No holdings yet</td></tr>'; return; }

    tbody.innerHTML = rows.map(h => {
      const pnlClass = h.pnlPct >= 0 ? 'pos' : 'neg';
      const sign = h.pnlPct >= 0 ? '+' : '';
      return `
      <tr>
        <td>
          <div class="nx-asset-cell">
            <div class="nx-asset-icon" style="background:${h.color}33;color:${h.color};border:1px solid ${h.color}55">
              ${(h.ticker || '').slice(0,2)}
            </div>
            <div>
              <div class="nx-asset-name">${h.name}</div>
              <div class="nx-asset-meta">${h.ticker}</div>
            </div>
          </div>
        </td>
        <td><span class="nx-tag nx-tag-${h.type}">${h.market}</span></td>
        <td class="r mono">${h.qty ? h.qty.toLocaleString('en-AU', { maximumFractionDigits: 4 }) : '—'}</td>
        <td class="r mono">${fmtAUD(h.price)}</td>
        <td class="r mono">${fmtAUD(h.marketValue)}</td>
        <td class="r">
          ${h.costBasis > 0
            ? `<span class="nx-pnl-chip ${pnlClass}">${sign}${h.pnlPct.toFixed(2)}%</span>`
            : '<span style="color:var(--text4)">—</span>'}
        </td>
        <td class="r mono" style="color:var(--text3)">${fmtAUD(h.costBasis)}</td>
      </tr>`;
    }).join('');
  }

  // ── Full refresh: call after any state change ────────────────
  function renderNewUI() {
    try {
      renderHero();
      renderDonut();
      renderHoldingsTable();
    } catch (e) {
      console.error('[new-ui] render error', e);
    }
  }

  // Expose globally so existing code can call after data loads
  window.renderNewUI = renderNewUI;

  // Auto-render when S is populated (poll briefly)
  let tries = 0;
  const poll = setInterval(() => {
    tries++;
    const s = window.S;
    const hasData = s && ((s.us && s.us.length) || (s.asx && s.asx.length) ||
                         (s.cry && s.cry.length) || (s.met && s.met.length) ||
                         (s.cash && s.cash.length));
    if (hasData || tries > 40) {
      clearInterval(poll);
      renderNewUI();
    }
  }, 250);

  // Re-render on tab switch to portfolio
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-tab="portfolio"]');
    if (btn) setTimeout(renderNewUI, 100);
  });
})();
