/* ═══════════════════════════════════════════════════════════════════════════
   cgt-patch.js  v2  —  SMSF CGT Patch
   ───────────────────────────────────────────────────────────────────────────
   Bug fixes in v2:
   1. DOUBLE FEE: App already creates a separate "Brokerage" fee row for each
      trade. Patch now detects this pattern and SKIPS splitting Trade rows that
      already have an adjacent Brokerage row — preventing double display.

   2. SUI NOT IMPORTED: File could only be read once. Fixed by passing the
      already-read text string into the original handler via a synthetic blob,
      rather than letting it re-read the same FileReader.

   3. CGT SELL + UNREALISED MISSING: Manually-entered sells (via the app's
      Sale modal) were never captured because extractXanoTxns only looked for
      source==='swyftx'. Fixed to capture ALL trade/sell/buy type entries from
      Xano. Price scraping also made more robust with multiple selector
      strategies and a live price map refresh on each CGT render.
   ═══════════════════════════════════════════════════════════════════════════ */

(function() {
  'use strict';

  /* ── Internal state ─────────────────────────────────────────────────────── */
  var CGT = {
    acquisitions : [],
    disposals    : [],
    cgtEvents    : [],
    unrealised   : [],
    fyFilter     : '',
    rawTxns      : [],   // all captured transactions (swyftx + manual)
    priceMap     : {},   // { 'SOL': 127.50, 'SUI': 1.27, ... }
  };

  /* ── Utility ─────────────────────────────────────────────────────────────── */
  function aud(n) {
    if (n == null || isNaN(n)) return '—';
    var abs = Math.abs(n);
    var s = abs.toLocaleString('en-AU', { minimumFractionDigits:2, maximumFractionDigits:2 });
    return (n < 0 ? '−$' : '$') + s;
  }
  function audAbs(n) {
    return '$' + Math.abs(n).toLocaleString('en-AU', { minimumFractionDigits:2, maximumFractionDigits:2 });
  }
  function colClass(n) { return n > 0 ? 'cgt-pos' : n < 0 ? 'cgt-neg' : ''; }
  function pf(v) { return parseFloat(v) || 0; }

  function parseDate(s) {
    if (!s) return null;
    var str = String(s);
    if (str.includes('/')) {
      var p = str.split('/');
      return new Date(+p[2], +p[1]-1, +p[0]);
    }
    // ISO or timestamp
    var d = new Date(str);
    return isNaN(d.getTime()) ? null : d;
  }
  function daysBetween(a, b) { return Math.floor((b - a) / 86400000); }
  function getFY(dateStr) {
    var d = parseDate(dateStr);
    if (!d) return 'Unknown';
    var y = d.getFullYear(), m = d.getMonth() + 1;
    return m >= 7 ? ('FY'+y+'-'+String(y+1).slice(2)) : ('FY'+(y-1)+'-'+String(y).slice(2));
  }

  /* ── CSV line parser ────────────────────────────────────────────────────── */
  function parseCSVLine(line) {
    var r = [], cur = '', q = false;
    for (var i = 0; i < line.length; i++) {
      var c = line[i];
      if (c === '"') { if (q && line[i+1]==='"') { cur+='"'; i++; } else q=!q; }
      else if (c===',' && !q) { r.push(cur); cur=''; }
      else cur += c;
    }
    r.push(cur);
    return r;
  }
  function toISO(s) {
    if (!s) return '';
    var str = String(s);
    if (str.includes('/')) {
      var p = str.split('/');
      return p[2]+'-'+p[1].padStart(2,'0')+'-'+p[0].padStart(2,'0');
    }
    return str.slice(0,10); // take YYYY-MM-DD from ISO
  }

  /* ── Parse Swyftx CSV text → normalised transactions ───────────────────── */
  function parseSwyftxText(text) {
    var lines = text.split('\n').map(function(l){ return l.trim(); }).filter(Boolean);
    var headerIdx = -1;
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].includes('AUD Value Fee') && lines[i].includes('Event')) { headerIdx = i; break; }
    }
    if (headerIdx === -1) return [];

    var headers = parseCSVLine(lines[headerIdx]);
    var col = {};
    headers.forEach(function(h, i){ col[h.trim()] = i; });

    var txns = [];
    for (var j = headerIdx + 1; j < lines.length; j++) {
      var row   = parseCSVLine(lines[j]);
      var event = ((row[col['Event']]||'').toLowerCase()).trim();
      // Skip summary/meta rows
      if (!event || event === 'sub total' || event === 'open position') continue;
      var dateRaw = (row[col['Date']]||'').trim();
      if (!dateRaw) continue;

      var asset    = (row[col['Asset']]||'').trim().toUpperCase();
      var qty      = pf(row[col['Amount']]);
      // AUD Value = GROSS (fee is embedded inside, NOT additive)
      var audValue = pf(row[col['AUD Value']]);
      var feeAUD   = pf(row[col['AUD Value Fee']]);
      var netValue = audValue - feeAUD;
      var rate     = pf(row[col['Rate']]);
      var txnId    = (row[col['Transaction ID']]||row[col['UUID']]||'').trim() ||
                     ('sw_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,6));

      txns.push({
        id:       txnId,
        date:     toISO(dateRaw),
        event:    event,        // 'buy' | 'sell' | 'swap' | 'deposit' etc
        asset:    asset,
        qty:      qty,
        audValue: audValue,     // gross AUD (fee inclusive) — actual cash movement
        feeAUD:   feeAUD,       // fee already inside audValue
        netValue: netValue,     // audValue − fee (displayed as net cost/proceeds)
        rate:     rate,
        source:   'swyftx'
      });
    }
    return txns;
  }

  /* ── Merge transactions into CGT state, deduplicating by id ────────────── */
  function mergeTxns(newTxns) {
    var existing = {};
    CGT.rawTxns.forEach(function(t){ existing[t.id] = true; });
    var added = newTxns.filter(function(t){ return t.id && !existing[t.id]; });
    if (added.length > 0) {
      CGT.rawTxns = CGT.rawTxns.concat(added);
      rebuildCGTInputs();
      return true;
    }
    return false;
  }

  function rebuildCGTInputs() {
    CGT.acquisitions = [];
    CGT.disposals    = [];
    CGT.rawTxns.forEach(function(t) {
      var ev = (t.event || t.type || '').toLowerCase().replace('swyftx-','');
      if (ev === 'buy') {
        CGT.acquisitions.push({
          id:        t.id,
          asset:     t.asset,
          date:      t.date,
          qty:       t.qty,
          grossCost: t.audValue || t.grossCost || 0   // GROSS = cost base per ATO s.110-25
        });
      } else if (ev === 'sell') {
        CGT.disposals.push({
          id:            t.id,
          asset:         t.asset,
          date:          t.date,
          qty:           t.qty,
          grossProceeds: t.audValue || t.grossProceeds || 0,
          fee:           t.feeAUD || t.fee || 0,
          type:          'sale'
        });
      } else if (ev === 'swap' || ev === 'convert') {
        CGT.disposals.push({
          id:            t.id,
          asset:         t.asset,
          date:          t.date,
          qty:           t.qty,
          grossProceeds: t.audValue || t.grossCost || 0,
          fee:           t.feeAUD || t.fee || 0,
          type:          'swap'
        });
      }
    });
  }

  /* ── CGT calculation ────────────────────────────────────────────────────── */
  function getCGTMethod() {
    try { return JSON.parse(localStorage.getItem('smsf_cgt_settings')||'{}').parcelMethod || 'fifo'; } catch(e){ return 'fifo'; }
  }
  function setCGTMethod(m) {
    try { var s=JSON.parse(localStorage.getItem('smsf_cgt_settings')||'{}'); s.parcelMethod=m; localStorage.setItem('smsf_cgt_settings',JSON.stringify(s)); } catch(e){}
  }

  function runCGT() {
    refreshPriceMap();
    var method = getCGTMethod();
    CGT.cgtEvents  = calcCGT(CGT.disposals, CGT.acquisitions, method);
    CGT.unrealised = buildUnrealised();
  }

  function calcCGT(disposals, acquisitions, method) {
    var results = [];
    var pool = {};
    acquisitions.forEach(function(a) {
      var k = (a.asset||'').toUpperCase();
      if (!pool[k]) pool[k] = [];
      pool[k].push({
        id:        a.id,
        date:      parseDate(a.date),
        dateStr:   a.date,
        totalQty:  pf(a.qty),
        remaining: pf(a.qty),
        grossCost: pf(a.grossCost)
      });
    });

    function sortPool(arr, saleDate, m) {
      var p = arr.filter(function(x){ return x.remaining > 0.000001; });
      if (m === 'lifo') {
        p.sort(function(a,b){ return b.date - a.date; });
      } else if (m === 'mincgt') {
        var sd = parseDate(saleDate) || new Date();
        p.sort(function(a,b){
          var da = daysBetween(a.date, sd) > 365 ? 1 : 0;
          var db = daysBetween(b.date, sd) > 365 ? 1 : 0;
          return (db - da) || (a.date - b.date);
        });
      } else {
        p.sort(function(a,b){ return a.date - b.date; }); // FIFO
      }
      return p;
    }

    disposals.forEach(function(d) {
      var k = (d.asset||'').toUpperCase();
      if (!pool[k] || pool[k].length === 0) return;
      var qty      = pf(d.qty);
      var saleDate = parseDate(d.date);
      // Net proceeds = gross − fee (this is what the ATO uses as the capital proceeds)
      var netProc  = pf(d.grossProceeds) - pf(d.fee);
      var origQty  = qty;

      sortPool(pool[k], d.date, method).forEach(function(p) {
        if (qty <= 0.000001) return;
        var used   = Math.min(qty, p.remaining);
        var costB  = p.grossCost * (used / p.totalQty);
        var procS  = netProc * (used / origQty);
        var gross  = procS - costB;
        var days   = saleDate ? daysBetween(p.date, saleDate) : 0;
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

  /* ── Price map — scrape live prices from the holdings table ─────────────── */
  function refreshPriceMap() {
    var prices = {};

    // Strategy 1: look for .tkr-sym + parent row's price cell
    document.querySelectorAll('#allHoldingsB tr, #cryB tr').forEach(function(tr) {
      var symEl = tr.querySelector('.tkr-sym');
      if (!symEl) return;
      var ticker = symEl.textContent.trim().toUpperCase();
      if (!ticker) return;

      // Walk all td's and find the one that looks like a price
      var cells = tr.querySelectorAll('td');
      // The table header order is: Ticker | Name | Type | Qty | Price (AUD) | 24h | Avg cost | Value | Gain
      // Price is at index 4 (0-based)
      var priceCell = cells[4];
      if (priceCell) {
        var p = parseFloat(priceCell.textContent.replace(/[$,\s\u00a0]/g,''));
        if (p > 0) { prices[ticker] = p; return; }
      }
      // Fallback: scan all cells for a plausible price
      cells.forEach(function(td, idx) {
        if (idx === 0 || idx === 1) return; // skip ticker/name cells
        var raw = td.textContent.replace(/[$,\s\u00a0+%]/g,'');
        var v = parseFloat(raw);
        if (v > 0 && v < 10000000 && !prices[ticker]) prices[ticker] = v;
      });
    });

    // Strategy 2: look for data-ticker attributes anywhere in the DOM
    document.querySelectorAll('[data-ticker]').forEach(function(el) {
      var tk = (el.getAttribute('data-ticker')||'').toUpperCase();
      var pEl = el.querySelector('[data-price], .price, .sval');
      if (tk && pEl) {
        var p = parseFloat(pEl.textContent.replace(/[$,\s\u00a0]/g,''));
        if (p > 0 && !prices[tk]) prices[tk] = p;
      }
    });

    // Strategy 3: scan window.state if the app exposes it
    try {
      var st = window.state || window.appState || window.portfolioState || {};
      var holdings = st.holdings || st.positions || st.assets || [];
      if (Array.isArray(holdings)) {
        holdings.forEach(function(h) {
          var tk = (h.ticker || h.asset || h.symbol || '').toUpperCase();
          var p  = pf(h.price || h.current_price || h.lastPrice || h.aud_price);
          if (tk && p > 0 && !prices[tk]) prices[tk] = p;
        });
      }
    } catch(e) {}

    CGT.priceMap = prices;
  }

  /* ── Unrealised gains ───────────────────────────────────────────────────── */
  function buildUnrealised() {
    // Rebuild parcel pool minus disposed qty (always FIFO for open position calc)
    var pool = {};
    CGT.acquisitions.forEach(function(a) {
      var k = (a.asset||'').toUpperCase();
      if (!pool[k]) pool[k] = [];
      pool[k].push({
        date:      parseDate(a.date),
        totalQty:  pf(a.qty),
        remaining: pf(a.qty),
        grossCost: pf(a.grossCost),
        dateStr:   a.date
      });
    });
    CGT.disposals.forEach(function(d) {
      var k = (d.asset||'').toUpperCase();
      if (!pool[k]) return;
      pool[k].sort(function(a,b){ return a.date - b.date; });
      var qty = pf(d.qty);
      pool[k].forEach(function(p){
        if (qty <= 0) return;
        var u = Math.min(qty, p.remaining);
        p.remaining -= u;
        qty -= u;
      });
    });

    var today = new Date();
    var rows  = [];
    Object.keys(pool).forEach(function(asset) {
      var qty=0, cost=0, earliest=null;
      pool[asset].forEach(function(p) {
        if (p.remaining < 0.000001) return;
        var frac = p.remaining / p.totalQty;
        qty  += p.remaining;
        cost += p.grossCost * frac;
        if (!earliest || p.date < earliest) earliest = p.date;
      });
      if (qty < 0.000001) return;
      var price = CGT.priceMap[asset] || 0;
      var val   = qty * price;
      var unr   = val - cost;
      var days  = earliest ? daysBetween(earliest, today) : 0;
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
    rows.sort(function(a,b){ return b.unrealisedGain - a.unrealisedGain; });
    return rows;
  }

  /* ══ BUG 1 FIX — LEDGER PATCH ═══════════════════════════════════════════
     The app already creates separate "Brokerage" fee rows alongside each
     "Trade" row. We must NOT also split the Trade row amount — that would
     show the fee twice. Rule:
       - If a Trade row has an immediately adjacent sibling row whose
         description contains "Brokerage" or "Fee" for the same asset,
         the app is already handling fee display → skip the split.
       - Only split if the Trade row is standalone (no adjacent fee row).
  ══════════════════════════════════════════════════════════════════════════ */
  function hasSiblingFeeRow(row) {
    // Check next sibling row
    var next = row.nextElementSibling;
    if (next) {
      var txt = next.textContent.toLowerCase();
      if (txt.includes('brokerage') || txt.includes('fee') || txt.includes('commission')) return true;
    }
    // Check previous sibling row
    var prev = row.previousElementSibling;
    if (prev) {
      var txt2 = prev.textContent.toLowerCase();
      if (txt2.includes('brokerage') || txt2.includes('fee') || txt2.includes('commission')) return true;
    }
    return false;
  }

  function patchLedger() {
    var tbody = document.getElementById('feesB');
    if (!tbody) return;

    tbody.querySelectorAll('tr').forEach(function(row) {
      if (row.dataset.cgtPatched) return;
      var cells = row.querySelectorAll('td');
      if (cells.length < 3) return;

      // ── BUG 1 FIX: skip if app already shows a sibling Brokerage row ──
      if (hasSiblingFeeRow(row)) {
        row.dataset.cgtPatched = '1'; // mark as handled — no split needed
        // Still inject CGT badge if it's a sell
        var rowText = row.textContent.toLowerCase();
        if (rowText.includes('sell') || rowText.includes('trade')) {
          var txnId2 = row.dataset.txnId || row.dataset.id || row.getAttribute('data-txn-id');
          if (txnId2) injectCGTBadge(row, txnId2, cells);
        }
        return;
      }

      // Try to match to a Swyftx transaction by ID first, then description
      var txnId = row.dataset.txnId || row.dataset.id || row.getAttribute('data-txn-id');
      var matched = null;
      if (txnId) {
        matched = CGT.rawTxns.find(function(t){ return t.id === txnId; });
      }
      if (!matched) {
        var allText = row.textContent.toUpperCase();
        CGT.rawTxns.forEach(function(t) {
          if (matched) return;
          if (!t.asset || !allText.includes(t.asset)) return;
          if ((t.event==='buy'  && allText.includes('BUY'))  ||
              (t.event==='sell' && allText.includes('SELL')) ||
              (t.event==='swap' && allText.includes('SWAP'))) {
            matched = t;
          }
        });
      }

      if (!matched) return;
      var ev = matched.event || '';
      if (!['buy','sell','swap','convert'].includes(ev)) return;
      // Only split if there's a fee to show
      if (!matched.feeAUD || matched.feeAUD === 0) {
        row.dataset.cgtPatched = '1';
        return;
      }

      var amtCell = findAmountCell(cells);
      if (!amtCell) return;

      var isSell = ev === 'sell' || ev === 'swap' || ev === 'convert';
      amtCell.innerHTML = buildSplitHTML(matched.audValue, matched.feeAUD, matched.netValue, isSell);
      row.dataset.cgtPatched = '1';
      if (isSell) injectCGTBadge(row, matched.id, cells);
    });

    injectAllBadges();
  }

  function findAmountCell(cells) {
    for (var i = cells.length - 1; i >= 0; i--) {
      var txt = cells[i].textContent.replace(/[$,\s\u2212\-\+]/g,'');
      if (/^\d+(\.\d+)?$/.test(txt)) return cells[i];
    }
    return cells[Math.max(0, cells.length - 2)];
  }

  function buildSplitHTML(gross, fee, net, isSell) {
    var sign    = isSell ? '' : '−';
    var netCol  = isSell ? 'var(--gain-pos)' : 'var(--gain-neg)';
    var label   = isSell ? 'Net proceeds' : 'Net cost';
    return '<div class="cgt-split-amount">'+
      '<div class="cgt-split-row">'+
        '<span class="cgt-split-lbl">'+label+'</span>'+
        '<span style="color:'+netCol+';font-weight:600;">'+sign+audAbs(net)+'</span>'+
      '</div>'+
      '<div class="cgt-split-row">'+
        '<span class="cgt-split-lbl">Swyftx fee</span>'+
        '<span style="color:var(--gain-neg);">−'+audAbs(fee)+'</span>'+
      '</div>'+
      '<div class="cgt-split-row cgt-split-tot">'+
        '<span class="cgt-split-lbl" style="font-weight:600;color:var(--text3);">Total</span>'+
        '<span style="color:var(--text2);">'+sign+audAbs(gross)+'</span>'+
      '</div>'+
    '</div>';
  }

  function injectCGTBadge(row, txnId, cells) {
    if (!txnId) return;
    var evs = CGT.cgtEvents.filter(function(e){ return e.disposalId === txnId; });
    if (!evs.length) return;
    var lastCell = cells[cells.length - 1];
    if (!lastCell || lastCell.querySelector('.cgt-ledger-pill')) return;
    var totTax  = evs.reduce(function(s,e){ return s+e.taxPayable; },0);
    var totGain = evs.reduce(function(s,e){ return s+e.grossGain; },0);
    var hasDisc = evs.some(function(e){ return e.discountApplied; });
    var pill = document.createElement('span');
    pill.className = 'cgt-ledger-pill ' + (totGain >= 0 ? 'cgt-pill-pos' : 'cgt-pill-neg');
    pill.title = 'CGT: Gross gain '+aud(totGain)+' · Est. tax '+aud(totTax)+(hasDisc?' · 12m discount applied':'');
    pill.textContent = 'CGT '+aud(totTax);
    lastCell.appendChild(pill);
  }

  function injectAllBadges() {
    var byDisp = {};
    CGT.cgtEvents.forEach(function(ev){
      if (!byDisp[ev.disposalId]) byDisp[ev.disposalId] = [];
      byDisp[ev.disposalId].push(ev);
    });
    document.querySelectorAll('#feesB tr[data-txn-id], #feesB tr[data-id]').forEach(function(row) {
      var id = row.dataset.txnId || row.dataset.id;
      if (!id || !byDisp[id] || row.dataset.cgtBadged) return;
      injectCGTBadge(row, id, row.querySelectorAll('td'));
      row.dataset.cgtBadged = '1';
    });
  }

  /* ══ CGT TAB RENDERER ═════════════════════════════════════════════════════ */
  window.renderCGTTab = function() {
    var container = document.getElementById('cgt-summary-container');
    if (!container) return;
    runCGT();

    var method   = getCGTMethod();
    var fyFilter = CGT.fyFilter;
    var allEvs   = CGT.cgtEvents;
    var filtered = fyFilter ? allEvs.filter(function(e){ return e.fy===fyFilter; }) : allEvs;
    var allFYs   = [];
    allEvs.forEach(function(e){ if (allFYs.indexOf(e.fy) < 0) allFYs.push(e.fy); });
    allFYs.sort();

    var totGross = filtered.reduce(function(s,e){ return s+e.grossGain; }, 0);
    var totDisc  = filtered.reduce(function(s,e){ return s+e.discountAmt; }, 0);
    var totNet   = filtered.reduce(function(s,e){ return s+e.discountedGain; }, 0);
    var totTax   = filtered.reduce(function(s,e){ return s+e.taxPayable; }, 0);

    var fyOpts = '<option value="">All financial years</option>' +
      allFYs.map(function(fy){
        return '<option value="'+fy+'"'+(fy===fyFilter?' selected':'')+'>'+fy+'</option>';
      }).join('');

    var methLabel = { fifo:'FIFO — First in, first out', lifo:'LIFO — Last in, first out', mincgt:'Minimise CGT' }[method] || method;

    /* ── Realised rows ── */
    var eventRows = filtered.length === 0
      ? '<tr><td colspan="9" style="text-align:center;color:var(--text4);padding:28px;">'+
          'No disposal events in this period. Import a Swyftx CSV with sell transactions '+
          'or add a sale via the + Add button to see CGT calculations.</td></tr>'
      : filtered.map(function(ev) {
          var disc = ev.discountApplied
            ? '<span class="cgt-badge cgt-disc">✓ −⅓</span>'
            : '<span class="cgt-badge cgt-none">—</span>';
          return '<tr>'+
            '<td><span class="badge b-amber" style="font-size:10px;">'+ev.asset+'</span></td>'+
            '<td style="white-space:nowrap;">'+ev.saleDate+'</td>'+
            '<td class="mob-hide" style="color:var(--text3);font-size:11px;white-space:nowrap;">'+ev.acquireDate+'</td>'+
            '<td class="r mob-hide" style="font-size:11px;">'+ev.qtySold.toLocaleString('en-AU',{maximumFractionDigits:6})+'</td>'+
            '<td class="r">'+aud(ev.proceeds)+'</td>'+
            '<td class="r mob-hide">'+aud(ev.costBase)+'</td>'+
            '<td class="r '+colClass(ev.grossGain)+'" style="font-weight:600;">'+aud(ev.grossGain)+'</td>'+
            '<td class="r" style="text-align:center;">'+disc+'</td>'+
            '<td class="r '+colClass(ev.taxPayable)+'" style="font-weight:700;">'+aud(ev.taxPayable)+'</td>'+
          '</tr>';
        }).join('');

    var totRow = filtered.length > 0
      ? '<tfoot><tr class="cgt-totals-row">'+
          '<td colspan="4" style="font-size:10px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;">Period totals</td>'+
          '<td class="r">'+aud(filtered.reduce(function(s,e){ return s+e.proceeds; },0))+'</td>'+
          '<td class="r mob-hide">'+aud(filtered.reduce(function(s,e){ return s+e.costBase; },0))+'</td>'+
          '<td class="r '+colClass(totGross)+'" style="font-weight:700;">'+aud(totGross)+'</td>'+
          '<td></td>'+
          '<td class="r cgt-neg" style="font-weight:700;">'+aud(totTax)+'</td>'+
        '</tr></tfoot>'
      : '';

    /* ── Unrealised rows ── */
    var unrRows = CGT.unrealised.length === 0
      ? '<tr><td colspan="7" style="text-align:center;color:var(--text4);padding:20px;">'+
          'No open positions found. Click <strong>Refresh prices</strong> on the Portfolio tab first, '+
          'then return here — prices need to load before unrealised gains can be calculated.</td></tr>'
      : CGT.unrealised.map(function(u) {
          var disc = u.discountElig
            ? '<span class="cgt-badge cgt-disc">✓ −⅓</span>'
            : '<span class="cgt-badge cgt-none">'+u.holdingDays+'d</span>';
          var noP = !u.priceAvailable
            ? ' <span style="font-size:10px;color:var(--text4);">(refresh prices)</span>' : '';
          return '<tr>'+
            '<td><span class="badge b-amber" style="font-size:10px;">'+u.asset+'</span></td>'+
            '<td class="r mob-hide" style="font-size:11px;">'+u.qty.toLocaleString('en-AU',{maximumFractionDigits:6})+'</td>'+
            '<td class="r">'+aud(u.costBase)+'</td>'+
            '<td class="r">'+(u.priceAvailable ? aud(u.currentValue) : '—')+noP+'</td>'+
            '<td class="r '+colClass(u.unrealisedGain)+'" style="font-weight:600;">'+(u.priceAvailable ? aud(u.unrealisedGain) : '—')+'</td>'+
            '<td class="r" style="text-align:center;">'+disc+'</td>'+
            '<td class="r '+colClass(u.estimatedTax)+'" style="font-weight:700;">'+(u.priceAvailable ? aud(u.estimatedTax) : '—')+'</td>'+
          '</tr>';
        }).join('');

    container.innerHTML =
    '<div class="cgt-settings-bar">'+
      '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">'+
        '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="var(--accent)" stroke-width="1.5"><circle cx="8" cy="8" r="6"/><path d="M8 5v3l2 1"/></svg>'+
        '<span style="font-size:11px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;">SMSF · Accumulation · 15% CGT · ⅓ discount after 12 months</span>'+
      '</div>'+
      '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">'+
        '<select id="cgtMethodSelect" onchange="window._cgtChangeMethod(this.value)" style="font-size:12px;padding:4px 10px;border:1px solid var(--border4);border-radius:99px;background:var(--surface2);color:var(--text);font-family:Arial,Helvetica,sans-serif;cursor:pointer;">'+
          '<option value="fifo"'+(method==='fifo'?' selected':'')+'>FIFO — First in, first out</option>'+
          '<option value="lifo"'+(method==='lifo'?' selected':'')+'>LIFO — Last in, first out</option>'+
          '<option value="mincgt"'+(method==='mincgt'?' selected':'')+'>Minimise CGT</option>'+
        '</select>'+
        '<select id="cgtFYSelect" onchange="window._cgtChangeFY(this.value)" style="font-size:12px;padding:4px 10px;border:1px solid var(--border4);border-radius:99px;background:var(--surface2);color:var(--text);font-family:Arial,Helvetica,sans-serif;cursor:pointer;">'+fyOpts+'</select>'+
      '</div>'+
    '</div>'+

    '<div class="cgt-cards">'+
      '<div class="cgt-card"><div class="cgt-card-lbl">Gross capital gain</div><div class="cgt-card-val '+colClass(totGross)+'">'+aud(totGross)+'</div><div class="cgt-card-sub">Before discount</div></div>'+
      '<div class="cgt-card"><div class="cgt-card-lbl">12-month discount</div><div class="cgt-card-val" style="color:var(--accent);">'+aud(totDisc)+'</div><div class="cgt-card-sub">⅓ off gains held &gt;12 months</div></div>'+
      '<div class="cgt-card"><div class="cgt-card-lbl">Net taxable gain</div><div class="cgt-card-val '+colClass(totNet)+'">'+aud(totNet)+'</div><div class="cgt-card-sub">After discount</div></div>'+
      '<div class="cgt-card cgt-card-hl"><div class="cgt-card-lbl">Estimated tax @ 15%</div><div class="cgt-card-val cgt-neg" style="font-size:22px;">'+aud(totTax)+'</div><div class="cgt-card-sub">Accumulation phase</div></div>'+
    '</div>'+

    '<div class="cgt-sec-head">'+
      '<span class="cgt-sec-title"><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2 12l4-4 3 3 5-7"/></svg> Realised capital gains &amp; losses</span>'+
      '<span style="font-size:11px;color:var(--text4);">Method: <strong style="color:var(--text2);">'+method.toUpperCase()+'</strong></span>'+
    '</div>'+
    '<div class="tbl-wrap"><table>'+
      '<thead><tr>'+
        '<th>Asset</th><th>Sale date</th><th class="mob-hide">Acquired</th>'+
        '<th class="r mob-hide">Qty</th><th class="r">Net proceeds</th>'+
        '<th class="r mob-hide">Cost base</th><th class="r">Gross gain</th>'+
        '<th class="r" style="text-align:center;">Discount</th><th class="r">Est. tax</th>'+
      '</tr></thead>'+
      '<tbody>'+eventRows+'</tbody>'+totRow+
    '</table></div>'+

    '<div class="cgt-sec-head" style="margin-top:20px;">'+
      '<span class="cgt-sec-title"><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="8" cy="8" r="6"/><path d="M8 5v3"/><circle cx="8" cy="11.5" r=".5" fill="currentColor"/></svg> Unrealised gains &amp; losses — open positions</span>'+
      '<span style="font-size:11px;color:var(--text4);">Estimated if sold today · <a href="#" onclick="window._cgtRefreshPrices();return false;" style="color:var(--accent);text-decoration:none;">Refresh prices</a></span>'+
    '</div>'+
    '<div class="tbl-wrap"><table>'+
      '<thead><tr>'+
        '<th>Asset</th><th class="r mob-hide">Qty held</th><th class="r">Cost base</th>'+
        '<th class="r">Current value</th><th class="r">Unrealised gain</th>'+
        '<th class="r" style="text-align:center;">Discount elig.</th><th class="r">Est. tax if sold</th>'+
      '</tr></thead>'+
      '<tbody>'+unrRows+'</tbody>'+
    '</table></div>'+

    '<div style="padding:12px 16px 4px;font-size:11px;color:var(--text4);line-height:1.7;">'+
      '⚠ Estimates only — verify with your SMSF accountant. 15% tax rate (accumulation phase). '+
      '12-month discount (⅓ reduction, effective 10%) per s.115 ITAA 1997. '+
      'Cost base includes brokerage per ATO s.110-25. '+
      'Parcel method: <strong style="color:var(--text3);">'+methLabel+'</strong>.'+
    '</div>';
  };

  /* ── Refresh prices then re-render unrealised ───────────────────────────── */
  window._cgtRefreshPrices = function() {
    // Trigger the app's own refresh if possible
    var rfBtn = document.getElementById('rfBtn');
    if (rfBtn && !rfBtn.disabled) rfBtn.click();
    // Re-render after a delay to let prices update
    setTimeout(function(){ window.renderCGTTab(); }, 3000);
  };

  /* ── CGT CSV export ─────────────────────────────────────────────────────── */
  window.exportCGTCSV = function() {
    var rows = CGT.fyFilter
      ? CGT.cgtEvents.filter(function(e){ return e.fy===CGT.fyFilter; })
      : CGT.cgtEvents;
    if (!rows.length) { alert('No CGT events to export for this period.'); return; }
    var h = ['FY','Asset','Sale Date','Acquire Date','Qty Sold','Net Proceeds (AUD)',
             'Cost Base (AUD)','Gross Gain (AUD)','12m Discount Applied','Discount Amount (AUD)',
             'Discounted Gain (AUD)','Tax @ 15% (AUD)','Holding Days','Event Type'];
    var csv = [h.join(',')].concat(rows.map(function(e){
      return [e.fy, e.asset, e.saleDate, e.acquireDate, e.qtySold.toFixed(8),
              e.proceeds.toFixed(2), e.costBase.toFixed(2), e.grossGain.toFixed(2),
              e.discountApplied?'Yes':'No', e.discountAmt.toFixed(2),
              e.discountedGain.toFixed(2), e.taxPayable.toFixed(2),
              e.holdingDays, e.type].join(',');
    })).join('\n');
    var a = document.createElement('a');
    a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
    a.download = 'SMSF-CGT-'+(CGT.fyFilter||'AllYears')+'.csv';
    a.click();
  };

  window._cgtChangeMethod = function(val) { setCGTMethod(val); window.renderCGTTab(); };
  window._cgtChangeFY     = function(val) { CGT.fyFilter = val; window.renderCGTTab(); };

  /* ══ BUG 2 FIX — SWYFTX IMPORT HOOK ════════════════════════════════════
     Problem: FileReader can only read a file once. The original approach
     read the file, then called origU(input) which tried to read it again
     from input.files[0] — but the file object had already been consumed,
     causing the app's import to silently fail (no holdings created).

     Fix: After we parse the CSV text ourselves, reconstruct a synthetic
     File from the same text and inject it back so the original handler
     can read it fresh.
  ══════════════════════════════════════════════════════════════════════════ */
  function hookImport() {
    var origU = window.handleUniversalImport;
    var origS = window.importSwyftxCSV;

    if (typeof origU === 'function' && !origU._cgtHooked) {
      window.handleUniversalImport = function(input) {
        var file = input && input.files && input.files[0];
        if (file && file.name.toLowerCase().endsWith('.csv')) {
          var fr = new FileReader();
          fr.onload = function(e) {
            var text = e.target.result;
            if (text.includes('AUD Value Fee') || text.includes('Crypto Transactions')) {
              // Parse CGT data
              var txns = parseSwyftxText(text);
              mergeTxns(txns);
              runCGT();
              // ── BUG 2 FIX: inject fresh synthetic file into input ──
              injectFreshFile(input, file.name, text);
            }
            // Now call original with the refreshed input
            origU.call(window, input);
            setTimeout(function(){ patchLedger(); }, 1200);
            setTimeout(function(){ patchLedger(); }, 3000);
          };
          fr.readAsText(file);
          return;
        }
        origU.call(window, input);
      };
      window.handleUniversalImport._cgtHooked = true;
    }

    if (typeof origS === 'function' && !origS._cgtHooked) {
      window.importSwyftxCSV = function(input) {
        var file = input && input.files && input.files[0];
        if (file) {
          var fr = new FileReader();
          fr.onload = function(e) {
            var text = e.target.result;
            var txns = parseSwyftxText(text);
            mergeTxns(txns);
            runCGT();
            injectFreshFile(input, file.name, text);
            origS.call(window, input);
            setTimeout(function(){ patchLedger(); }, 1200);
            setTimeout(function(){ patchLedger(); }, 3000);
          };
          fr.readAsText(file);
          return;
        }
        origS.call(window, input);
      };
      window.importSwyftxCSV._cgtHooked = true;
    }
  }

  function injectFreshFile(input, name, text) {
    try {
      var blob = new Blob([text], { type: 'text/csv' });
      var fresh = new File([blob], name, { type: 'text/csv' });
      var dt = new DataTransfer();
      dt.items.add(fresh);
      input.files = dt.files;
    } catch(e) {
      // DataTransfer not available in all browsers — try Object.defineProperty
      try {
        var blob2 = new Blob([text], { type: 'text/csv' });
        var fresh2 = new File([blob2], name, { type: 'text/csv' });
        Object.defineProperty(input, 'files', {
          writable: true, configurable: true,
          value: { 0: fresh2, length: 1, item: function(i){ return fresh2; } }
        });
      } catch(e2) {}
    }
  }

  /* ══ BUG 3 FIX — XANO INTERCEPT: CAPTURE ALL TRADES, NOT JUST SWYFTX ════
     Previously only captured source==='swyftx' transactions. Manual sells
     entered via the app's Sale modal are stored in Xano with type 'sale'
     or 'sell' but no source field. We now capture ALL buy/sell/trade type
     entries and normalise them into CGT inputs.
  ══════════════════════════════════════════════════════════════════════════ */
  function hookFetch() {
    var origFetch = window.fetch;
    window.fetch = function() {
      var args = arguments;
      return origFetch.apply(this, args).then(function(res) {
        var url = (args[0]||'').toString();
        if (url.includes('xano') || url.includes('/fees') || url.includes('/transactions') || url.includes('/ledger') || url.includes('/holdings')) {
          res.clone().json().then(extractFromAPI).catch(function(){});
        }
        return res;
      });
    };

    var origOpen = XMLHttpRequest.prototype.open;
    var origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function(method, url) {
      this._patchUrl = url;
      return origOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function() {
      var self = this;
      this.addEventListener('load', function() {
        if (!self._patchUrl) return;
        var u = self._patchUrl;
        if (u.includes('xano') || u.includes('/fees') || u.includes('/transactions') || u.includes('/holdings')) {
          try { extractFromAPI(JSON.parse(self.responseText)); } catch(e){}
        }
      });
      return origSend.apply(this, arguments);
    };
  }

  function extractFromAPI(data) {
    var items = Array.isArray(data) ? data
      : (data.items || data.fees || data.transactions || data.ledger || data.holdings || []);
    if (!Array.isArray(items) || !items.length) return;

    // ── BUG 3 FIX: accept ALL buy/sell/trade entries, not just swyftx ──
    var tradeLike = items.filter(function(t) {
      var type = (t.type || t.event || t.category || '').toLowerCase();
      // Accept: buy, sell, trade, swyftx-buy, swyftx-sell, sale, swap, convert
      return type.match(/^(buy|sell|trade|sale|swap|convert|swyftx)/);
    });

    if (!tradeLike.length) return;

    var normalised = tradeLike.map(function(t) {
      var type = (t.type || t.event || '').toLowerCase().replace('swyftx-','');
      // Normalise 'trade' type by checking description/amount sign
      if (type === 'trade') {
        var desc = (t.description || t.desc || '').toLowerCase();
        var amt  = pf(t.amount || t.aud_value || t.gross_cost || t.gross_proceeds);
        type = desc.includes('sell') ? 'sell' : (amt < 0 ? 'sell' : 'buy');
      }
      // For sells stored by the app, gross_proceeds may be in amount (positive)
      var gross = pf(t.gross_cost || t.gross_proceeds || t.aud_value || t.amount_aud ||
                     Math.abs(pf(t.amount)));
      var fee   = pf(t.fee || t.fee_aud || t.brokerage || 0);
      var asset = (t.asset || t.ticker || t.symbol || '').toUpperCase();
      var qty   = pf(t.qty || t.quantity || t.amount_asset || 0);
      var date  = toISO(t.date || t.created_at || t.transaction_date || '');
      var id    = String(t.id || t.uuid || t.txn_id || '');
      if (!asset || !date || !id) return null;
      return {
        id:       id,
        date:     date,
        event:    type,
        asset:    asset,
        qty:      qty,
        audValue: gross,
        feeAUD:   fee,
        netValue: gross - fee,
        source:   t.source || 'manual'
      };
    }).filter(Boolean);

    if (mergeTxns(normalised)) {
      runCGT();
      setTimeout(function(){ patchLedger(); }, 600);
    }
  }

  /* ══ HOOK switchTab ═══════════════════════════════════════════════════════ */
  function hookSwitchTab() {
    var tryWrap = function() {
      if (typeof window.switchTab !== 'function') return false;
      if (window.switchTab._cgtHooked) return true;
      var orig = window.switchTab;
      window.switchTab = function(tab) {
        orig.call(this, tab);
        if (tab === 'cgt') setTimeout(function(){ window.renderCGTTab(); }, 60);
        else if (tab === 'fees') setTimeout(function(){ patchLedger(); }, 450);
      };
      window.switchTab._cgtHooked = true;
      return true;
    };
    if (!tryWrap()) {
      var n = 0;
      var iv = setInterval(function(){ if (tryWrap() || ++n > 80) clearInterval(iv); }, 250);
    }
  }

  /* ══ TAB CLICK LISTENER ═══════════════════════════════════════════════════ */
  document.addEventListener('click', function(e) {
    var btn = e.target.closest('[data-action="switchTab"]');
    if (!btn) return;
    var tab = btn.getAttribute('data-tab');
    if (tab === 'cgt') setTimeout(function(){ window.renderCGTTab(); }, 80);
    else if (tab === 'fees') setTimeout(function(){ patchLedger(); }, 500);
  }, true);

  /* ══ MUTATION OBSERVER — patch ledger on DOM changes ═════════════════════ */
  function watchLedger() {
    var obs = new MutationObserver(function() {
      clearTimeout(window._cgtPT);
      window._cgtPT = setTimeout(function(){ patchLedger(); }, 300);
    });
    var attach = function() {
      var tb = document.getElementById('feesB');
      if (tb) { obs.observe(tb, { childList:true, subtree:true }); return true; }
      return false;
    };
    if (!attach()) {
      var bObs = new MutationObserver(function(){
        if (attach()) bObs.disconnect();
      });
      bObs.observe(document.body, { childList:true, subtree:true });
    }
  }

  /* ══ BOOT ═════════════════════════════════════════════════════════════════ */
  function boot() {
    hookFetch();
    hookSwitchTab();
    watchLedger();
    // Hook imports after app has had time to define its functions
    setTimeout(hookImport, 700);
    setTimeout(hookImport, 2000);  // retry in case of slow load
    // Initial ledger patch runs
    setTimeout(function(){ patchLedger(); }, 2000);
    setTimeout(function(){ patchLedger(); }, 5000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

})();
