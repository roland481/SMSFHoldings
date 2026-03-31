/* ═══════════════════════════════════════════════════════════════════════════
   cgt-patch.js  v4  —  SMSF CGT Patch
   ───────────────────────────────────────────────────────────────────────────
   Built from reading the actual source files. Key facts discovered:

   STATE (state.js / auth.js):
   • S.cry[]  = crypto holdings array, each has .ticker, .qty, .cost, .txns[]
   • S.prices = { 'cry:SOL': { price: 127.5, change: -1.2 }, ... }
   • Each txn: { date, side:'buy'|'sell', qty, price, fee, txnId, swyftxId }
   • price on txn = audVal/qty  (NOT gross; fee is separate on tx.fee)
   • Cost base per unit stored as S.cry[i].cost (fee-adjusted avg via recalcFromTxns)

   IMPORT (imports.js):
   • audVal = get('aud value')  — this IS the gross AUD (fee embedded)
   • fee    = get('fee amount') — same number; stored separately on txn
   • Cash debit = audVal + fee  ← BUG: double-counts fee (audVal already includes it)
   • Duplicate check uses swyftxId (UUID field from CSV)
   • Creates holding via xanoAddHolding if ticker not found, then updates

   LEDGER (app.js renderFees):
   • Trade rows rendered from S[type][i].txns — amount shown = price * qty
   • Fee rows rendered as separate entries with amount = tx.fee
   • No data-txn-id on rows — identified only by position in array
   • Row HTML has no ID/data attributes we can key on for badge injection

   CGT TAB (app.js switchTab):
   • switchTab() only handles ['portfolio','fees','watchlist','import']
   • Our CGT tab ('cgt') is invisible to it — tab panel never activates
   • Fix: wrap switchTab to also handle 'cgt', AND patch the tab arrays

   PRICES:
   • S.prices['cry:SOL'].price is the live AUD price
   • This is exactly what we need for unrealised gain calculation
   ═══════════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  /* ────────────────────────────────────────────────────────────────────────
     UTILS
  ──────────────────────────────────────────────────────────────────────── */
  function pf(v) { return parseFloat(v) || 0; }

  function fmtAUD(n) {
    if (n == null || isNaN(n)) return '—';
    var s = Math.abs(n).toLocaleString('en-AU', { minimumFractionDigits:2, maximumFractionDigits:2 });
    return (n < 0 ? '−$' : '$') + s;
  }
  function cc(n) { return n > 0 ? 'cgt-pos' : n < 0 ? 'cgt-neg' : ''; }

  function pd(s) {
    if (!s) return null;
    var t = String(s).trim();
    // ISO format YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}/.test(t)) return new Date(t + 'T00:00:00');
    // DD/MM/YYYY
    if (t.includes('/')) {
      var p = t.split('/');
      return new Date(+p[2], +p[1]-1, +p[0]);
    }
    return new Date(t);
  }
  function daysApart(a, b) { return Math.floor((b - a) / 86400000); }
  function getFY(dateStr) {
    var d = pd(dateStr);
    if (!d || isNaN(d)) return 'Unknown';
    var y = d.getFullYear(), m = d.getMonth() + 1;
    return m >= 7 ? 'FY' + y + '-' + String(y+1).slice(2)
                  : 'FY' + (y-1) + '-' + String(y).slice(2);
  }

  /* ────────────────────────────────────────────────────────────────────────
     READ TRANSACTIONS DIRECTLY FROM S (app state)
     ─────────────────────────────────────────────────────────────────────
     S.cry[].txns[] contains every crypto trade with:
       { date, side:'buy'|'sell', qty, price (AUD per unit, net), fee (AUD) }

     Cost base per parcel = (qty × price) + fee   ← this is the gross AUD paid
     That matches ATO s.110-25 (fee included in cost base).

     For sells: net proceeds = (qty × price) − fee
     (price here is the per-unit rate; total = qty × price; fee deducted)
  ──────────────────────────────────────────────────────────────────────── */
  function buildCGTInputs() {
    var acq = [], disp = [];

    // Only crypto assets for now (Swyftx imports go into S.cry)
    // Can extend to S.us / S.asx / S.met in future
    var state = window.S;
    if (!state) return { acq: acq, disp: disp };

    ['cry'].forEach(function(type) {
      (state[type] || []).forEach(function(holding) {
        var ticker = (holding.ticker || '').toUpperCase();
        (holding.txns || []).forEach(function(tx) {
          var qty   = pf(tx.qty);
          var price = pf(tx.price);   // AUD per unit stored on txn
          var fee   = pf(tx.fee);
          var gross = qty * price;    // total AUD before fee
          var id    = tx.txnId || tx.swyftxId || (ticker + '_' + tx.date + '_' + qty);

          if (tx.side === 'buy') {
            acq.push({
              id:        id,
              asset:     ticker,
              date:      tx.date,
              qty:       qty,
              // Cost base = gross + fee (fee is capitalised per ATO s.110-25)
              grossCost: gross + fee
            });
          } else if (tx.side === 'sell') {
            disp.push({
              id:            id,
              asset:         ticker,
              date:          tx.date,
              qty:           qty,
              // Proceeds = gross - fee (net proceeds for CGT)
              grossProceeds: gross,
              fee:           fee,
              type:          'sale'
            });
          }
        });
      });
    });

    // Also include manually-entered sales from S.fees if type='sale'
    (state.fees || []).forEach(function(fe) {
      if ((fe.type || '').toLowerCase() !== 'sale') return;
      // Manual sales may have asset/ticker stored differently
      var ticker = (fe.ticker || fe.asset || fe.cat || '').toUpperCase();
      if (!ticker) return;
      disp.push({
        id:            fe.txnId || fe._id || ('sale_' + fe.date),
        asset:         ticker,
        date:          fe.date,
        qty:           pf(fe.qty),
        grossProceeds: pf(fe.amount),
        fee:           pf(fe.fee),
        type:          'sale'
      });
    });

    return { acq: acq, disp: disp };
  }

  /* ────────────────────────────────────────────────────────────────────────
     PRICES — read directly from S.prices (already populated by fetchCry)
  ──────────────────────────────────────────────────────────────────────── */
  function getLivePrice(ticker) {
    var state = window.S;
    if (!state || !state.prices) return 0;
    // Try all asset type prefixes
    var keys = ['cry:' + ticker, 'us:' + ticker, 'asx:' + ticker, 'met:' + ticker];
    for (var i = 0; i < keys.length; i++) {
      var p = state.prices[keys[i]];
      if (p && p.price > 0) return p.price;
    }
    return 0;
  }

  /* ────────────────────────────────────────────────────────────────────────
     CGT SETTINGS
  ──────────────────────────────────────────────────────────────────────── */
  function getCGTMethod() {
    try { return JSON.parse(localStorage.getItem('smsf_cgt_settings') || '{}').parcelMethod || 'fifo'; }
    catch(e) { return 'fifo'; }
  }
  function setCGTMethod(m) {
    try {
      var o = JSON.parse(localStorage.getItem('smsf_cgt_settings') || '{}');
      o.parcelMethod = m;
      localStorage.setItem('smsf_cgt_settings', JSON.stringify(o));
    } catch(e) {}
  }

  /* ────────────────────────────────────────────────────────────────────────
     CGT ENGINE
  ──────────────────────────────────────────────────────────────────────── */
  function runCGT() {
    var inputs = buildCGTInputs();
    var method = getCGTMethod();
    var events = calcCGT(inputs.disp, inputs.acq, method);
    var unreal = buildUnrealised(inputs.acq, inputs.disp);
    return { events: events, unreal: unreal };
  }

  function calcCGT(disposals, acquisitions, method) {
    var results = [];
    // Build parcel pool keyed by asset
    var pool = {};
    acquisitions.forEach(function(a) {
      var k = a.asset;
      if (!pool[k]) pool[k] = [];
      pool[k].push({
        id:        a.id,
        date:      pd(a.date),
        dateStr:   a.date,
        totalQty:  pf(a.qty),
        remaining: pf(a.qty),
        grossCost: pf(a.grossCost)   // total cost incl fee for this parcel
      });
    });

    function sortedParcels(arr, saleDateStr, m) {
      var active = arr.filter(function(p) { return p.remaining > 0.000001; });
      if (m === 'lifo') {
        active.sort(function(a,b) { return b.date - a.date; });
      } else if (m === 'mincgt') {
        var sd = pd(saleDateStr) || new Date();
        active.sort(function(a,b) {
          var da = daysApart(a.date, sd) > 365 ? 1 : 0;
          var db = daysApart(b.date, sd) > 365 ? 1 : 0;
          return (db - da) || (a.date - b.date);
        });
      } else {
        active.sort(function(a,b) { return a.date - b.date; }); // FIFO
      }
      return active;
    }

    disposals.forEach(function(d) {
      var k = d.asset;
      if (!pool[k] || !pool[k].length) return;
      var qty     = pf(d.qty);
      var origQty = qty;
      var sd      = pd(d.date);
      var netProc = pf(d.grossProceeds) - pf(d.fee);

      sortedParcels(pool[k], d.date, method).forEach(function(p) {
        if (qty <= 0.000001) return;
        var used   = Math.min(qty, p.remaining);
        var frac   = used / p.totalQty;
        var costB  = p.grossCost * frac;
        var procS  = netProc * (used / origQty);
        var gross  = procS - costB;
        var days   = sd ? daysApart(p.date, sd) : 0;
        var disc   = days > 365 && gross > 0;
        var discA  = disc ? gross / 3 : 0;
        var netG   = gross - discA;
        var tax    = netG > 0 ? netG * 0.15 : 0;

        results.push({
          disposalId:     d.id,
          parcelId:       p.id,
          asset:          k,
          saleDate:       d.date,
          acquireDate:    p.dateStr,
          qtySold:        used,
          proceeds:       procS,
          costBase:       costB,
          grossGain:      gross,
          discountApplied:disc,
          discountAmt:    discA,
          discountedGain: netG,
          taxPayable:     tax,
          holdingDays:    days,
          type:           d.type || 'sale',
          fy:             getFY(d.date)
        });
        p.remaining -= used;
        qty -= used;
      });
    });
    return results;
  }

  function buildUnrealised(acquisitions, disposals) {
    // Clone pool
    var pool = {};
    acquisitions.forEach(function(a) {
      var k = a.asset;
      if (!pool[k]) pool[k] = [];
      pool[k].push({
        date:      pd(a.date),
        totalQty:  pf(a.qty),
        remaining: pf(a.qty),
        grossCost: pf(a.grossCost),
        dateStr:   a.date
      });
    });
    // Reduce for disposals (always FIFO for open position calc)
    disposals.forEach(function(d) {
      var k = d.asset;
      if (!pool[k]) return;
      pool[k].sort(function(a,b) { return a.date - b.date; });
      var qty = pf(d.qty);
      pool[k].forEach(function(p) {
        if (qty <= 0) return;
        var u = Math.min(qty, p.remaining);
        p.remaining -= u;
        qty -= u;
      });
    });

    var today = new Date();
    var rows = [];
    Object.keys(pool).forEach(function(asset) {
      var qty=0, cost=0, earliest=null;
      pool[asset].forEach(function(p) {
        if (p.remaining < 0.000001) return;
        var frac = p.totalQty > 0 ? p.remaining / p.totalQty : 0;
        qty  += p.remaining;
        cost += p.grossCost * frac;
        if (!earliest || p.date < earliest) earliest = p.date;
      });
      if (qty < 0.000001) return;

      var price = getLivePrice(asset);
      var val   = qty * price;
      var unr   = val - cost;
      var days  = earliest ? daysApart(earliest, today) : 0;
      var disc  = days > 365;
      var netG  = (disc && unr > 0) ? unr * 2/3 : unr;
      var tax   = netG > 0 ? netG * 0.15 : 0;

      rows.push({
        asset:          asset,
        qty:            qty,
        costBase:       cost,
        currentValue:   val,
        unrealisedGain: unr,
        holdingDays:    days,
        discountElig:   disc,
        estimatedTax:   tax,
        priceAvailable: price > 0
      });
    });
    rows.sort(function(a,b) { return b.unrealisedGain - a.unrealisedGain; });
    return rows;
  }

  /* ────────────────────────────────────────────────────────────────────────
     CGT TAB RENDERER
  ──────────────────────────────────────────────────────────────────────── */
  var _fyFilter = '';

  window.renderCGTTab = function() {
    var el = document.getElementById('cgt-summary-container');
    if (!el) return;

    var result  = runCGT();
    var method  = getCGTMethod();
    var allEvs  = result.events;
    var fy      = _fyFilter;
    var filtered = fy ? allEvs.filter(function(e) { return e.fy === fy; }) : allEvs;

    var allFYs = [];
    allEvs.forEach(function(e) { if (allFYs.indexOf(e.fy) < 0) allFYs.push(e.fy); });
    allFYs.sort();

    var tGross = filtered.reduce(function(s,e){ return s+e.grossGain; }, 0);
    var tDisc  = filtered.reduce(function(s,e){ return s+e.discountAmt; }, 0);
    var tNet   = filtered.reduce(function(s,e){ return s+e.discountedGain; }, 0);
    var tTax   = filtered.reduce(function(s,e){ return s+e.taxPayable; }, 0);

    var methLabel = {
      fifo:   'FIFO — First in, first out',
      lifo:   'LIFO — Last in, first out',
      mincgt: 'Minimise CGT'
    }[method] || method;

    var fyOpts = '<option value="">All financial years</option>' +
      allFYs.map(function(f) {
        return '<option value="'+f+'"'+(f===fy?' selected':'')+'>'+f+'</option>';
      }).join('');

    /* Realised rows */
    var eRows = filtered.length === 0
      ? '<tr><td colspan="9" style="text-align:center;color:var(--text4);padding:28px;">' +
          'No disposal events found. Make sure you have imported your Swyftx CSV ' +
          '(including sell transactions) or recorded a sale via + Add.</td></tr>'
      : filtered.map(function(e) {
          var disc = e.discountApplied
            ? '<span class="cgt-badge cgt-disc">✓ −⅓</span>'
            : '<span class="cgt-badge cgt-none">—</span>';
          return '<tr>' +
            '<td><span class="badge b-amber" style="font-size:10px;">'+e.asset+'</span></td>' +
            '<td style="white-space:nowrap;font-size:12px;">'+e.saleDate+'</td>' +
            '<td class="mob-hide" style="color:var(--text3);font-size:11px;white-space:nowrap;">'+e.acquireDate+'</td>' +
            '<td class="r mob-hide" style="font-size:11px;">'+e.qtySold.toLocaleString('en-AU',{maximumFractionDigits:6})+'</td>' +
            '<td class="r">'+fmtAUD(e.proceeds)+'</td>' +
            '<td class="r mob-hide">'+fmtAUD(e.costBase)+'</td>' +
            '<td class="r '+cc(e.grossGain)+'" style="font-weight:600;">'+fmtAUD(e.grossGain)+'</td>' +
            '<td class="r" style="text-align:center;">'+disc+'</td>' +
            '<td class="r '+cc(e.taxPayable)+'" style="font-weight:700;">'+fmtAUD(e.taxPayable)+'</td>' +
          '</tr>';
        }).join('');

    var tRow = filtered.length > 0
      ? '<tfoot><tr class="cgt-totals-row">' +
          '<td colspan="4" style="font-size:10px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;">Totals</td>' +
          '<td class="r">'+fmtAUD(filtered.reduce(function(s,e){return s+e.proceeds;},0))+'</td>' +
          '<td class="r mob-hide">'+fmtAUD(filtered.reduce(function(s,e){return s+e.costBase;},0))+'</td>' +
          '<td class="r '+cc(tGross)+'" style="font-weight:700;">'+fmtAUD(tGross)+'</td>' +
          '<td></td>' +
          '<td class="r cgt-neg" style="font-weight:700;">'+fmtAUD(tTax)+'</td>' +
        '</tr></tfoot>'
      : '';

    /* Unrealised rows */
    var uRows = result.unreal.length === 0
      ? '<tr><td colspan="7" style="text-align:center;color:var(--text4);padding:20px;">' +
          'No open positions found. Import your Swyftx CSV, then click ' +
          '<strong>Refresh prices</strong> on the Portfolio tab and return here.</td></tr>'
      : result.unreal.map(function(u) {
          var disc = u.discountElig
            ? '<span class="cgt-badge cgt-disc">✓ −⅓</span>'
            : '<span class="cgt-badge cgt-none">'+u.holdingDays+'d</span>';
          var noP = !u.priceAvailable
            ? ' <span style="font-size:10px;color:var(--text4);">(refresh prices)</span>' : '';
          return '<tr>' +
            '<td><span class="badge b-amber" style="font-size:10px;">'+u.asset+'</span></td>' +
            '<td class="r mob-hide" style="font-size:11px;">'+u.qty.toLocaleString('en-AU',{maximumFractionDigits:6})+'</td>' +
            '<td class="r">'+fmtAUD(u.costBase)+'</td>' +
            '<td class="r">'+(u.priceAvailable ? fmtAUD(u.currentValue) : '—')+noP+'</td>' +
            '<td class="r '+cc(u.unrealisedGain)+'" style="font-weight:600;">'+(u.priceAvailable ? fmtAUD(u.unrealisedGain) : '—')+'</td>' +
            '<td class="r" style="text-align:center;">'+disc+'</td>' +
            '<td class="r '+cc(u.estimatedTax)+'" style="font-weight:700;">'+(u.priceAvailable ? fmtAUD(u.estimatedTax) : '—')+'</td>' +
          '</tr>';
        }).join('');

    el.innerHTML =
    '<div class="cgt-settings-bar">' +
      '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
        '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="var(--accent)" stroke-width="1.5"><circle cx="8" cy="8" r="6"/><path d="M8 5v3l2 1"/></svg>' +
        '<span style="font-size:11px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;">SMSF · Accumulation · 15% CGT · ⅓ discount after 12 months</span>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
        '<select onchange="window._cgtMethod(this.value)" style="font-size:12px;padding:4px 10px;border:1px solid var(--border4);border-radius:99px;background:var(--surface2);color:var(--text);font-family:Arial,Helvetica,sans-serif;cursor:pointer;">' +
          '<option value="fifo"'+(method==='fifo'?' selected':'')+'>FIFO — First in, first out</option>' +
          '<option value="lifo"'+(method==='lifo'?' selected':'')+'>LIFO — Last in, first out</option>' +
          '<option value="mincgt"'+(method==='mincgt'?' selected':'')+'>Minimise CGT</option>' +
        '</select>' +
        '<select onchange="window._cgtFY(this.value)" style="font-size:12px;padding:4px 10px;border:1px solid var(--border4);border-radius:99px;background:var(--surface2);color:var(--text);font-family:Arial,Helvetica,sans-serif;cursor:pointer;">' + fyOpts + '</select>' +
      '</div>' +
    '</div>' +
    '<div class="cgt-cards">' +
      cgtCard('Gross capital gain', fmtAUD(tGross), 'Before discount', cc(tGross)) +
      cgtCard('12-month discount', fmtAUD(tDisc), '⅓ off gains held >12 months', 'cgt-acc') +
      cgtCard('Net taxable gain', fmtAUD(tNet), 'After discount', cc(tNet)) +
      cgtCardHL('Estimated tax @ 15%', fmtAUD(tTax), 'Accumulation phase') +
    '</div>' +
    '<div class="cgt-sec-head">' +
      '<span class="cgt-sec-title">Realised capital gains &amp; losses</span>' +
      '<span style="font-size:11px;color:var(--text4);">Method: <strong style="color:var(--text2);">'+method.toUpperCase()+'</strong></span>' +
    '</div>' +
    '<div class="tbl-wrap"><table>' +
      '<thead><tr>' +
        '<th>Asset</th><th>Sale date</th><th class="mob-hide">Acquired</th>' +
        '<th class="r mob-hide">Qty</th><th class="r">Net proceeds</th>' +
        '<th class="r mob-hide">Cost base</th><th class="r">Gross gain</th>' +
        '<th class="r" style="text-align:center;">Discount</th><th class="r">Est. tax</th>' +
      '</tr></thead><tbody>' + eRows + '</tbody>' + tRow +
    '</table></div>' +
    '<div class="cgt-sec-head" style="margin-top:20px;">' +
      '<span class="cgt-sec-title">Unrealised gains &amp; losses — open positions</span>' +
      '<span style="font-size:11px;color:var(--text4);">Estimated if sold today &nbsp;·&nbsp; ' +
        '<a href="#" onclick="window._cgtRefresh();return false;" style="color:var(--accent);text-decoration:none;">↺ Refresh prices</a>' +
      '</span>' +
    '</div>' +
    '<div class="tbl-wrap"><table>' +
      '<thead><tr>' +
        '<th>Asset</th><th class="r mob-hide">Qty held</th><th class="r">Cost base</th>' +
        '<th class="r">Current value</th><th class="r">Unrealised gain</th>' +
        '<th class="r" style="text-align:center;">Discount elig.</th><th class="r">Est. tax if sold</th>' +
      '</tr></thead><tbody>' + uRows + '</tbody>' +
    '</table></div>' +
    '<div style="padding:12px 16px 4px;font-size:11px;color:var(--text4);line-height:1.7;">' +
      '⚠ Estimates only — verify with your SMSF accountant. ' +
      'CGT rate 15% (accumulation). 12-month discount (⅓, effective 10%) per s.115 ITAA 1997. ' +
      'Cost base includes brokerage per ATO s.110-25 ITAA 1997. ' +
      'Parcel method: <strong style="color:var(--text3);">'+methLabel+'</strong>.' +
    '</div>';
  };

  function cgtCard(lbl, val, sub, cls) {
    return '<div class="cgt-card"><div class="cgt-card-lbl">'+lbl+'</div>' +
           '<div class="cgt-card-val '+(cls||'')+'">'+val+'</div>' +
           '<div class="cgt-card-sub">'+sub+'</div></div>';
  }
  function cgtCardHL(lbl, val, sub) {
    return '<div class="cgt-card cgt-card-hl"><div class="cgt-card-lbl">'+lbl+'</div>' +
           '<div class="cgt-card-val cgt-neg" style="font-size:22px;">'+val+'</div>' +
           '<div class="cgt-card-sub">'+sub+'</div></div>';
  }

  /* ── Settings handlers ── */
  window._cgtMethod  = function(v) { setCGTMethod(v); window.renderCGTTab(); };
  window._cgtFY      = function(v) { _fyFilter = v; window.renderCGTTab(); };
  window._cgtRefresh = function() {
    var btn = document.getElementById('rfBtn');
    if (btn && !btn.disabled) btn.click();
    setTimeout(window.renderCGTTab, 3500);
  };

  /* ── CGT CSV export ── */
  window.exportCGTCSV = function() {
    var result = runCGT();
    var rows = _fyFilter
      ? result.events.filter(function(e) { return e.fy === _fyFilter; })
      : result.events;
    if (!rows.length) { alert('No CGT events to export.'); return; }
    var h = 'FY,Asset,Sale Date,Acquire Date,Qty Sold,Net Proceeds (AUD),Cost Base (AUD),' +
            'Gross Gain (AUD),12m Discount Applied,Discount Amount (AUD),' +
            'Discounted Gain (AUD),Tax @ 15% (AUD),Holding Days,Type\n';
    var csv = h + rows.map(function(e) {
      return [e.fy, e.asset, e.saleDate, e.acquireDate, e.qtySold.toFixed(8),
              e.proceeds.toFixed(2), e.costBase.toFixed(2), e.grossGain.toFixed(2),
              e.discountApplied?'Yes':'No', e.discountAmt.toFixed(2),
              e.discountedGain.toFixed(2), e.taxPayable.toFixed(2),
              e.holdingDays, e.type].join(',');
    }).join('\n');
    var a = document.createElement('a');
    a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
    a.download = 'SMSF-CGT-' + (_fyFilter || 'AllYears') + '.csv';
    a.click();
  };

  /* ────────────────────────────────────────────────────────────────────────
     FIX: switchTab — patch to handle 'cgt' tab
     ─────────────────────────────────────────────────────────────────────
     The app's switchTab() only knows about 4 tabs. We wrap it to:
     1. Handle 'cgt' — activate the right panel/buttons ourselves
     2. Pass everything else through to the original
  ──────────────────────────────────────────────────────────────────────── */
  function hookSwitchTab() {
    var tryWrap = function() {
      if (typeof window.switchTab !== 'function' || window.switchTab._cgtV4) return false;
      var orig = window.switchTab;

      window.switchTab = function(name) {
        if (name === 'cgt') {
          // Deactivate all standard tabs
          document.querySelectorAll('.tab-btn').forEach(function(b) {
            b.classList.remove('active');
          });
          document.querySelectorAll('.tab-panel').forEach(function(p) {
            p.classList.remove('active');
          });
          // Deactivate sidebar/bottomnav items
          ['portfolio','fees','watchlist','import'].forEach(function(t) {
            var sb = document.getElementById('sb-' + t);
            if (sb) sb.classList.remove('active');
            var bn = document.getElementById('bn-' + t);
            if (bn) bn.classList.remove('active');
          });
          // Activate CGT items
          var sbCgt = document.getElementById('sb-cgt');
          if (sbCgt) sbCgt.classList.add('active');
          var bnCgt = document.getElementById('bn-cgt');
          if (bnCgt) bnCgt.classList.add('active');
          var panelCgt = document.getElementById('tab-cgt');
          if (panelCgt) panelCgt.classList.add('active');
          // Hide + Add button (not relevant for CGT tab)
          var addBtn = document.getElementById('topbarAddBtn');
          if (addBtn) addBtn.style.display = 'none';
          // Close mobile sidebar
          if (typeof closeMobileSidebar === 'function') closeMobileSidebar();
          // Render CGT content
          setTimeout(window.renderCGTTab, 60);
          return;
        }
        // All other tabs — pass through to original
        orig.call(this, name);
      };

      window.switchTab._cgtV4 = true;
      return true;
    };

    if (!tryWrap()) {
      var n = 0;
      var iv = setInterval(function() {
        if (tryWrap() || ++n > 80) clearInterval(iv);
      }, 250);
    }
  }

  /* ────────────────────────────────────────────────────────────────────────
     FIX: imports.js cash account double-deduction
     ─────────────────────────────────────────────────────────────────────
     In imports.js: S.cash[cashAcctIdx].balance -= (row.audVal + row.fee)
     But audVal already INCLUDES the fee, so the total deducted is audVal + fee
     when it should just be audVal.

     We patch importSwyftxCSV to wrap it and fix the cash balance afterwards.
     Strategy: record cash balances before import, let import run, then
     correct the over-deduction by adding back the double-counted fees.
  ──────────────────────────────────────────────────────────────────────── */
  function hookImport() {
    var origImport = window.importSwyftxCSV;
    var origUniversal = window.handleUniversalImport;
    var origRoute = window.routeImportFile;

    if (typeof origRoute === 'function' && !origRoute._cgtV4) {
      window.routeImportFile = function(file) {
        // Snapshot cash balances before import
        var state = window.S;
        var preBalances = state && state.cash
          ? state.cash.map(function(a) { return a.balance || 0; })
          : [];

        var result = origRoute.call(this, file);

        // After import completes (it's async), fix the double-deduction
        // We also need to parse the CSV to know the total fees
        if (file && file.name.toLowerCase().endsWith('.csv')) {
          file.text().then(function(text) {
            if (!text.includes('AUD Value Fee')) return;
            var totalFees = parseSwyftxFees(text);
            if (totalFees <= 0) return;

            // The import deducted (audVal + fee) per trade but should have deducted audVal only
            // So cash is under by totalFees — add it back
            setTimeout(function() {
              var st = window.S;
              if (!st || !st.cash) return;
              // Find which cash account was affected (the one whose balance changed most)
              var maxChange = -Infinity;
              var affectedIdx = -1;
              st.cash.forEach(function(a, i) {
                var change = preBalances[i] - (a.balance || 0);
                if (change > maxChange) { maxChange = change; affectedIdx = i; }
              });
              if (affectedIdx >= 0 && maxChange > 0) {
                st.cash[affectedIdx].balance = (st.cash[affectedIdx].balance || 0) + totalFees;
                if (typeof renderCash === 'function') renderCash();
                if (typeof xanoUpdateCash === 'function') {
                  xanoUpdateCash(affectedIdx).catch(function(){});
                }
              }
            }, 2000); // Wait for async import to complete
          }).catch(function(){});
        }

        return result;
      };
      window.routeImportFile._cgtV4 = true;
    }
  }

  function parseSwyftxFees(text) {
    // Parse CSV and sum up all fee amounts for buy/sell trades
    var lines = text.split('\n');
    var col = null;
    var totalFees = 0;

    lines.forEach(function(line) {
      line = line.trim();
      if (!line) { col = null; return; }
      if (line.includes('AUD Value Fee') && line.includes('Event')) {
        var hdr = line.split(',').map(function(h) { return h.trim().toLowerCase(); });
        col = {};
        hdr.forEach(function(h, i) { col[h] = i; });
        return;
      }
      if (!col) return;
      var row = line.split(',');
      var event = (row[col['event']] || '').toLowerCase().trim();
      if (event !== 'buy' && event !== 'sell') return;
      var fee = parseFloat(row[col['fee amount']]) || 0;
      totalFees += fee;
    });
    return totalFees;
  }

  /* ────────────────────────────────────────────────────────────────────────
     TAB CLICK LISTENER — catches data-action="switchTab" data-tab="cgt"
  ──────────────────────────────────────────────────────────────────────── */
  document.addEventListener('click', function(e) {
    var btn = e.target.closest('[data-action="switchTab"]');
    if (!btn) return;
    if (btn.getAttribute('data-tab') === 'cgt') {
      // switchTab wrapper handles this, but fire renderCGTTab as backup
      setTimeout(function() { window.renderCGTTab(); }, 100);
    }
  }, false);

  /* ────────────────────────────────────────────────────────────────────────
     BOOT
  ──────────────────────────────────────────────────────────────────────── */
  function boot() {
    hookSwitchTab();
    // Hook import after app has booted (DOMContentLoaded fires first)
    setTimeout(hookImport, 1000);
    setTimeout(hookImport, 3000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})();
