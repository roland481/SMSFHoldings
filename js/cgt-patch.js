/* ═══════════════════════════════════════════════════════════════════════════
   cgt-patch.js  v3  —  SMSF CGT Patch (clean rewrite)
   ───────────────────────────────────────────────────────────────────────────
   DESIGN PRINCIPLES in v3:
   ─────────────────────────
   1. NEVER touch the app's import pipeline. The file import (handleUniversalImport,
      importSwyftxCSV) runs completely untouched. We listen for the CSV via a
      separate FileReader on the same input element AFTER the app has finished,
      using a capturing listener that does NOT interfere with the original.

   2. NEVER modify ledger row amounts. The app already renders a separate
      "Brokerage" fee row for every trade. We only ADD a small CGT pill badge
      to disposal rows — nothing else.

   3. Read ALL transaction data from Xano API responses. After the app saves
      imports to Xano and re-fetches the ledger, we capture the full ledger
      from the API response and build CGT inputs from it.

   4. Read prices directly from window.state or DOM, with multiple fallbacks.
   ═══════════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  /* ────────────────────────────────────────────────────────────────────────
     STATE
  ──────────────────────────────────────────────────────────────────────── */
  var S = {
    acq      : [],   // { id, asset, date, qty, grossCost }
    disp     : [],   // { id, asset, date, qty, grossProceeds, fee, type }
    events   : [],   // calculated CGT events
    unreal   : [],   // unrealised rows
    prices   : {},   // { SOL: 127.5, SUI: 1.27 }
    fyFilter : '',
    ledger   : [],   // raw ledger items from Xano
  };

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
    if (t.includes('/')) {
      var p = t.split('/');
      if (p.length === 3) return new Date(+p[2], +p[1]-1, +p[0]);
    }
    var d = new Date(t);
    return isNaN(d) ? null : d;
  }
  function daysApart(a, b) { return Math.floor((b - a) / 86400000); }
  function toISO(s) {
    if (!s) return '';
    var t = String(s).trim();
    if (t.includes('/')) {
      var p = t.split('/');
      if (p.length === 3) return p[2].padStart(4,'0')+'-'+p[1].padStart(2,'0')+'-'+p[0].padStart(2,'0');
    }
    return t.length >= 10 ? t.slice(0,10) : t;
  }
  function getFY(dateStr) {
    var d = pd(dateStr);
    if (!d) return 'Unknown';
    var y = d.getFullYear(), m = d.getMonth()+1;
    return m >= 7 ? 'FY'+y+'-'+String(y+1).slice(2) : 'FY'+(y-1)+'-'+String(y).slice(2);
  }

  /* ────────────────────────────────────────────────────────────────────────
     CSV PARSER  (Swyftx format)
  ──────────────────────────────────────────────────────────────────────── */
  function parseCSVRow(line) {
    var r=[], cur='', q=false;
    for (var i=0; i<line.length; i++) {
      var c=line[i];
      if (c==='"') { if(q&&line[i+1]==='"'){cur+='"';i++;} else q=!q; }
      else if (c===','&&!q) { r.push(cur.trim()); cur=''; }
      else cur+=c;
    }
    r.push(cur.trim());
    return r;
  }

  function parseSwyftxCSV(text) {
    var lines = text.split('\n');
    var results = [];
    var col = null;

    for (var i=0; i<lines.length; i++) {
      var line = lines[i].trim();
      if (!line) { col = null; continue; } // blank line resets section

      // Detect header row
      if (line.includes('AUD Value Fee') && line.includes('Event') && line.includes('Date')) {
        var hdr = parseCSVRow(line);
        col = {};
        hdr.forEach(function(h,idx){ col[h.trim()] = idx; });
        continue;
      }

      if (!col) continue; // no header seen yet for this section

      var row   = parseCSVRow(line);
      var event = (row[col['Event']]||'').toLowerCase().trim();
      if (!event || event==='sub total' || event==='open position' || event==='no positions held') continue;

      var dateRaw = (row[col['Date']]||'').trim();
      if (!dateRaw) continue;

      var asset    = (row[col['Asset']]||'').trim().toUpperCase();
      if (!asset) continue;

      var qty      = pf(row[col['Amount']]);
      var audValue = pf(row[col['AUD Value']]);      // GROSS — fee is inside this figure
      var feeAUD   = pf(row[col['AUD Value Fee']]);  // fee embedded in audValue
      var netValue = audValue - feeAUD;
      var rate     = pf(row[col['Rate']]);
      var txnId    = (row[col['Transaction ID']]||row[col['UUID']]||'').trim();
      if (!txnId) txnId = 'sw_'+asset+'_'+dateRaw.replace(/\//g,'')+'_'+qty;

      results.push({
        id: txnId, date: toISO(dateRaw), event: event, asset: asset,
        qty: qty, audValue: audValue, feeAUD: feeAUD, netValue: netValue,
        rate: rate, source: 'swyftx'
      });
    }
    return results;
  }

  /* ────────────────────────────────────────────────────────────────────────
     INGEST — merge new transactions into S.ledger deduped by id
  ──────────────────────────────────────────────────────────────────────── */
  function ingest(txns) {
    var seen = {};
    S.ledger.forEach(function(t){ seen[t.id]=true; });
    var added = txns.filter(function(t){ return t.id && !seen[t.id]; });
    if (!added.length) return false;
    S.ledger = S.ledger.concat(added);
    buildInputs();
    return true;
  }

  function buildInputs() {
    S.acq  = [];
    S.disp = [];
    S.ledger.forEach(function(t) {
      var ev = normaliseEvent(t.event || t.type || '');
      var asset = (t.asset || t.ticker || '').toUpperCase();
      var date  = toISO(t.date || t.created_at || '');
      if (!asset || !date) return;

      if (ev === 'buy') {
        S.acq.push({
          id:        t.id,
          asset:     asset,
          date:      date,
          qty:       pf(t.qty || t.amount || t.quantity),
          grossCost: pf(t.audValue || t.gross_cost || t.aud_value || Math.abs(pf(t.amount_aud)))
        });
      } else if (ev === 'sell' || ev === 'swap') {
        S.disp.push({
          id:            t.id,
          asset:         asset,
          date:          date,
          qty:           pf(t.qty || t.amount || t.quantity),
          grossProceeds: pf(t.audValue || t.gross_proceeds || t.aud_value || Math.abs(pf(t.amount_aud))),
          fee:           pf(t.feeAUD || t.fee || t.fee_aud || t.brokerage),
          type:          ev
        });
      }
    });
  }

  function normaliseEvent(raw) {
    var s = String(raw).toLowerCase().replace('swyftx-','').trim();
    if (s==='buy'||s==='purchase') return 'buy';
    if (s==='sell'||s==='sale')    return 'sell';
    if (s==='swap'||s==='convert') return 'swap';
    // 'trade' type — need to determine direction from amount sign or description
    if (s==='trade') return 'trade'; // handled separately in extractFromAPI
    return s;
  }

  /* ────────────────────────────────────────────────────────────────────────
     CGT ENGINE
  ──────────────────────────────────────────────────────────────────────── */
  function getCGTMethod() {
    try { return JSON.parse(localStorage.getItem('smsf_cgt_settings')||'{}').parcelMethod||'fifo'; }
    catch(e){ return 'fifo'; }
  }
  function setCGTMethod(m) {
    try { var o=JSON.parse(localStorage.getItem('smsf_cgt_settings')||'{}'); o.parcelMethod=m; localStorage.setItem('smsf_cgt_settings',JSON.stringify(o)); }
    catch(e){}
  }

  function runEngine() {
    refreshPrices();
    var method = getCGTMethod();

    // Build parcel pool
    var pool = {};
    S.acq.forEach(function(a) {
      var k = a.asset;
      if (!pool[k]) pool[k] = [];
      pool[k].push({
        id:        a.id,
        date:      pd(a.date),
        dateStr:   a.date,
        totalQty:  pf(a.qty),
        remaining: pf(a.qty),
        grossCost: pf(a.grossCost)
      });
    });

    // Sort parcel pool per method
    function sortedParcels(arr, saleDateStr, m) {
      var active = arr.filter(function(p){ return p.remaining > 0.000001; });
      if (m==='lifo') {
        active.sort(function(a,b){ return b.date-a.date; });
      } else if (m==='mincgt') {
        var sd = pd(saleDateStr)||new Date();
        active.sort(function(a,b){
          var da = daysApart(a.date,sd)>365?1:0, db = daysApart(b.date,sd)>365?1:0;
          return (db-da)||(a.date-b.date);
        });
      } else {
        active.sort(function(a,b){ return a.date-b.date; }); // FIFO default
      }
      return active;
    }

    // Calculate CGT events
    S.events = [];
    S.disp.forEach(function(d) {
      var k = d.asset;
      if (!pool[k]) return;
      var qty     = pf(d.qty);
      var origQty = qty;
      var sd      = pd(d.date);
      var netProc = pf(d.grossProceeds) - pf(d.fee);

      sortedParcels(pool[k], d.date, method).forEach(function(p) {
        if (qty <= 0.000001) return;
        var used   = Math.min(qty, p.remaining);
        var costB  = p.grossCost * (used / p.totalQty);
        var procS  = netProc * (used / origQty);
        var gross  = procS - costB;
        var days   = sd ? daysApart(p.date, sd) : 0;
        var disc   = days > 365 && gross > 0;
        var discA  = disc ? gross/3 : 0;
        var netG   = gross - discA;
        var tax    = netG > 0 ? netG * 0.15 : 0;
        S.events.push({
          disposalId:     d.id,  parcelId:       p.id,
          asset:          k,     saleDate:       d.date,
          acquireDate:    p.dateStr,
          qtySold:        used,  proceeds:       procS,
          costBase:       costB, grossGain:      gross,
          discountApplied:disc,  discountAmt:    discA,
          discountedGain: netG,  taxPayable:     tax,
          holdingDays:    days,  type:           d.type||'sale',
          fy:             getFY(d.date)
        });
        p.remaining -= used;
        qty -= used;
      });
    });

    // Unrealised — same pool after disposals applied
    S.unreal = [];
    var today = new Date();
    Object.keys(pool).forEach(function(asset) {
      var qty=0, cost=0, earliest=null;
      pool[asset].forEach(function(p) {
        if (p.remaining < 0.000001) return;
        var frac = p.totalQty > 0 ? p.remaining/p.totalQty : 0;
        qty  += p.remaining;
        cost += p.grossCost * frac;
        if (!earliest || p.date < earliest) earliest = p.date;
      });
      if (qty < 0.000001) return;
      var price = S.prices[asset] || 0;
      var val   = qty * price;
      var unr   = val - cost;
      var days  = earliest ? daysApart(earliest, today) : 0;
      var disc  = days > 365;
      var netG  = (disc && unr>0) ? unr*2/3 : unr;
      var tax   = netG>0 ? netG*0.15 : 0;
      S.unreal.push({
        asset: asset, qty: qty, costBase: cost,
        currentValue: val, unrealisedGain: unr,
        holdingDays: days, discountElig: disc,
        estimatedTax: tax, priceAvailable: price>0
      });
    });
    S.unreal.sort(function(a,b){ return b.unrealisedGain-a.unrealisedGain; });
  }

  /* ────────────────────────────────────────────────────────────────────────
     PRICE SCRAPING  — multiple strategies, most reliable first
  ──────────────────────────────────────────────────────────────────────── */
  function refreshPrices() {
    var p = {};

    // Strategy 1: window.state / window.appState holdings array
    try {
      var states = [window.state, window.appState, window.portfolioState];
      states.forEach(function(st) {
        if (!st) return;
        var arr = st.holdings || st.positions || st.assets || st.crypto || [];
        if (!Array.isArray(arr)) return;
        arr.forEach(function(h) {
          var tk = (h.ticker||h.asset||h.symbol||'').toUpperCase();
          var pr = pf(h.price||h.current_price||h.currentPrice||h.lastPrice||h.aud_price||h.priceAUD);
          if (tk && pr>0) p[tk] = pr;
        });
      });
    } catch(e){}

    // Strategy 2: scan #allHoldingsB — find column with "Price" heading
    try {
      var tbl = document.querySelector('#allHoldingsB');
      if (tbl) {
        // Find price column index from thead
        var thead = tbl.closest('table');
        var priceColIdx = -1;
        if (thead) {
          thead.querySelectorAll('thead th').forEach(function(th, idx) {
            var txt = th.textContent.toLowerCase();
            if (txt.includes('price') && priceColIdx < 0) priceColIdx = idx;
          });
        }

        tbl.querySelectorAll('tr').forEach(function(tr) {
          // Get ticker from .tkr-sym element
          var symEl = tr.querySelector('.tkr-sym');
          if (!symEl) return;
          var tk = symEl.textContent.trim().toUpperCase();
          if (!tk || p[tk]) return; // already have it

          var cells = tr.querySelectorAll('td');
          // Try the detected price column first
          if (priceColIdx > 0 && cells[priceColIdx]) {
            var v = pf(cells[priceColIdx].textContent.replace(/[$,\s\u00a0]/g,''));
            if (v > 0) { p[tk] = v; return; }
          }
          // Fallback: try column index 4 (standard table layout)
          if (cells[4]) {
            var v2 = pf(cells[4].textContent.replace(/[$,\s\u00a0]/g,''));
            if (v2 > 0) { p[tk] = v2; return; }
          }
          // Last resort: scan all cells for a plausible price value
          cells.forEach(function(td, ci) {
            if (ci < 2 || p[tk]) return;
            var raw = td.textContent.replace(/[$,\s\u00a0+%−]/g,'');
            var v3 = pf(raw);
            if (v3 > 0.0001 && v3 < 100000000) p[tk] = v3;
          });
        });
      }
    } catch(e){}

    // Strategy 3: data-price or data-ticker attributes in DOM
    try {
      document.querySelectorAll('[data-ticker][data-price]').forEach(function(el) {
        var tk = el.getAttribute('data-ticker').toUpperCase();
        var pr = pf(el.getAttribute('data-price'));
        if (tk && pr>0 && !p[tk]) p[tk] = pr;
      });
    } catch(e){}

    if (Object.keys(p).length > 0) S.prices = p;
  }

  /* ────────────────────────────────────────────────────────────────────────
     CGT TAB RENDERER
  ──────────────────────────────────────────────────────────────────────── */
  window.renderCGTTab = function() {
    var el = document.getElementById('cgt-summary-container');
    if (!el) return;
    runEngine();

    var method   = getCGTMethod();
    var fy       = S.fyFilter;
    var allEvs   = S.events;
    var filtered = fy ? allEvs.filter(function(e){ return e.fy===fy; }) : allEvs;

    var allFYs = [];
    allEvs.forEach(function(e){ if(allFYs.indexOf(e.fy)<0) allFYs.push(e.fy); });
    allFYs.sort();

    var tGross = filtered.reduce(function(s,e){ return s+e.grossGain; },0);
    var tDisc  = filtered.reduce(function(s,e){ return s+e.discountAmt; },0);
    var tNet   = filtered.reduce(function(s,e){ return s+e.discountedGain; },0);
    var tTax   = filtered.reduce(function(s,e){ return s+e.taxPayable; },0);

    var methLabel = {fifo:'FIFO — First in, first out', lifo:'LIFO — Last in, first out', mincgt:'Minimise CGT'}[method]||method;

    var fyOpts = '<option value="">All financial years</option>'+
      allFYs.map(function(f){ return '<option value="'+f+'"'+(f===fy?' selected':'')+'>'+f+'</option>'; }).join('');

    /* ── Realised rows ── */
    var eRows = filtered.length===0
      ? '<tr><td colspan="9" style="text-align:center;color:var(--text4);padding:28px;">'+
          'No disposals found. Import a Swyftx CSV containing sell transactions, '+
          'or record a sale via the + Add button.</td></tr>'
      : filtered.map(function(e) {
          var disc = e.discountApplied
            ? '<span class="cgt-badge cgt-disc">✓ −⅓</span>'
            : '<span class="cgt-badge cgt-none">—</span>';
          return '<tr>'+
            '<td><span class="badge b-amber" style="font-size:10px;">'+e.asset+'</span></td>'+
            '<td style="white-space:nowrap;font-size:12px;">'+e.saleDate+'</td>'+
            '<td class="mob-hide" style="color:var(--text3);font-size:11px;white-space:nowrap;">'+e.acquireDate+'</td>'+
            '<td class="r mob-hide" style="font-size:11px;">'+e.qtySold.toLocaleString('en-AU',{maximumFractionDigits:6})+'</td>'+
            '<td class="r">'+fmtAUD(e.proceeds)+'</td>'+
            '<td class="r mob-hide">'+fmtAUD(e.costBase)+'</td>'+
            '<td class="r '+cc(e.grossGain)+'" style="font-weight:600;">'+fmtAUD(e.grossGain)+'</td>'+
            '<td class="r" style="text-align:center;">'+disc+'</td>'+
            '<td class="r '+cc(e.taxPayable)+'" style="font-weight:700;">'+fmtAUD(e.taxPayable)+'</td>'+
          '</tr>';
        }).join('');

    var tRow = filtered.length>0
      ? '<tfoot><tr class="cgt-totals-row">'+
          '<td colspan="4" style="font-size:10px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;">Totals</td>'+
          '<td class="r">'+fmtAUD(filtered.reduce(function(s,e){return s+e.proceeds;},0))+'</td>'+
          '<td class="r mob-hide">'+fmtAUD(filtered.reduce(function(s,e){return s+e.costBase;},0))+'</td>'+
          '<td class="r '+cc(tGross)+'" style="font-weight:700;">'+fmtAUD(tGross)+'</td>'+
          '<td></td>'+
          '<td class="r cgt-neg" style="font-weight:700;">'+fmtAUD(tTax)+'</td>'+
        '</tr></tfoot>'
      : '';

    /* ── Unrealised rows ── */
    var uRows = S.unreal.length===0
      ? '<tr><td colspan="7" style="text-align:center;color:var(--text4);padding:20px;">'+
          'No open positions. Make sure you have imported your Swyftx buy transactions, '+
          'then click <strong>Refresh prices</strong> on the Portfolio tab and return here.</td></tr>'
      : S.unreal.map(function(u) {
          var disc = u.discountElig
            ? '<span class="cgt-badge cgt-disc">✓ −⅓</span>'
            : '<span class="cgt-badge cgt-none">'+u.holdingDays+'d</span>';
          var noP = !u.priceAvailable
            ? ' <span style="font-size:10px;color:var(--text4);">(refresh prices)</span>' : '';
          return '<tr>'+
            '<td><span class="badge b-amber" style="font-size:10px;">'+u.asset+'</span></td>'+
            '<td class="r mob-hide" style="font-size:11px;">'+u.qty.toLocaleString('en-AU',{maximumFractionDigits:6})+'</td>'+
            '<td class="r">'+fmtAUD(u.costBase)+'</td>'+
            '<td class="r">'+(u.priceAvailable?fmtAUD(u.currentValue):'—')+noP+'</td>'+
            '<td class="r '+cc(u.unrealisedGain)+'" style="font-weight:600;">'+(u.priceAvailable?fmtAUD(u.unrealisedGain):'—')+'</td>'+
            '<td class="r" style="text-align:center;">'+disc+'</td>'+
            '<td class="r '+cc(u.estimatedTax)+'" style="font-weight:700;">'+(u.priceAvailable?fmtAUD(u.estimatedTax):'—')+'</td>'+
          '</tr>';
        }).join('');

    el.innerHTML =
    /* ─ Settings bar ─ */
    '<div class="cgt-settings-bar">'+
      '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">'+
        '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="var(--accent)" stroke-width="1.5"><circle cx="8" cy="8" r="6"/><path d="M8 5v3l2 1"/></svg>'+
        '<span style="font-size:11px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;">SMSF · Accumulation · 15% CGT · ⅓ discount after 12 months</span>'+
      '</div>'+
      '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">'+
        '<select onchange="window._cgtMethod(this.value)" style="font-size:12px;padding:4px 10px;border:1px solid var(--border4);border-radius:99px;background:var(--surface2);color:var(--text);font-family:Arial,Helvetica,sans-serif;cursor:pointer;">'+
          '<option value="fifo"'+(method==='fifo'?' selected':'')+'>FIFO — First in, first out</option>'+
          '<option value="lifo"'+(method==='lifo'?' selected':'')+'>LIFO — Last in, first out</option>'+
          '<option value="mincgt"'+(method==='mincgt'?' selected':'')+'>Minimise CGT</option>'+
        '</select>'+
        '<select onchange="window._cgtFY(this.value)" style="font-size:12px;padding:4px 10px;border:1px solid var(--border4);border-radius:99px;background:var(--surface2);color:var(--text);font-family:Arial,Helvetica,sans-serif;cursor:pointer;">'+fyOpts+'</select>'+
      '</div>'+
    '</div>'+
    /* ─ Summary cards ─ */
    '<div class="cgt-cards">'+
      card('Gross capital gain', fmtAUD(tGross), 'Before discount', cc(tGross))+
      card('12-month discount', fmtAUD(tDisc), '⅓ off gains held >12 months', 'cgt-acc')+
      card('Net taxable gain', fmtAUD(tNet), 'After discount', cc(tNet))+
      cardHL('Estimated tax @ 15%', fmtAUD(tTax), 'Accumulation phase')+
    '</div>'+
    /* ─ Realised table ─ */
    secHead('Realised capital gains &amp; losses',
            'Method: <strong style="color:var(--text2);">'+method.toUpperCase()+'</strong>')+
    '<div class="tbl-wrap"><table>'+
      '<thead><tr>'+
        '<th>Asset</th><th>Sale date</th><th class="mob-hide">Acquired</th>'+
        '<th class="r mob-hide">Qty</th><th class="r">Net proceeds</th>'+
        '<th class="r mob-hide">Cost base</th><th class="r">Gross gain</th>'+
        '<th class="r" style="text-align:center;">Discount</th><th class="r">Est. tax</th>'+
      '</tr></thead><tbody>'+eRows+'</tbody>'+tRow+
    '</table></div>'+
    /* ─ Unrealised table ─ */
    secHead('Unrealised gains &amp; losses — open positions',
            'Estimated if sold today &nbsp;·&nbsp; <a href="#" onclick="window._cgtRefresh();return false;" style="color:var(--accent);text-decoration:none;">↺ Refresh prices</a>')+
    '<div class="tbl-wrap"><table>'+
      '<thead><tr>'+
        '<th>Asset</th><th class="r mob-hide">Qty held</th><th class="r">Cost base</th>'+
        '<th class="r">Current value</th><th class="r">Unrealised gain</th>'+
        '<th class="r" style="text-align:center;">Discount elig.</th><th class="r">Est. tax if sold</th>'+
      '</tr></thead><tbody>'+uRows+'</tbody>'+
    '</table></div>'+
    /* ─ Footnote ─ */
    '<div style="padding:12px 16px 4px;font-size:11px;color:var(--text4);line-height:1.7;">'+
      '⚠ Estimates only — verify with your SMSF accountant. '+
      'CGT rate 15% (accumulation). 12-month discount (⅓, effective 10%) per s.115 ITAA 1997. '+
      'Cost base includes brokerage per ATO s.110-25 ITAA 1997. '+
      'Parcel method: <strong style="color:var(--text3);">'+methLabel+'</strong>.'+
    '</div>';
  };

  function card(lbl, val, sub, cls) {
    return '<div class="cgt-card"><div class="cgt-card-lbl">'+lbl+'</div>'+
           '<div class="cgt-card-val '+(cls||'')+'">'+val+'</div>'+
           '<div class="cgt-card-sub">'+sub+'</div></div>';
  }
  function cardHL(lbl, val, sub) {
    return '<div class="cgt-card cgt-card-hl"><div class="cgt-card-lbl">'+lbl+'</div>'+
           '<div class="cgt-card-val cgt-neg" style="font-size:22px;">'+val+'</div>'+
           '<div class="cgt-card-sub">'+sub+'</div></div>';
  }
  function secHead(title, meta) {
    return '<div class="cgt-sec-head">'+
      '<span class="cgt-sec-title">'+title+'</span>'+
      '<span style="font-size:11px;color:var(--text4);">'+meta+'</span>'+
    '</div>';
  }

  /* ── Settings handlers ── */
  window._cgtMethod  = function(v){ setCGTMethod(v); window.renderCGTTab(); };
  window._cgtFY      = function(v){ S.fyFilter=v; window.renderCGTTab(); };
  window._cgtRefresh = function(){
    // Trigger app's own price refresh
    var btn = document.getElementById('rfBtn');
    if (btn && !btn.disabled) btn.click();
    // Re-render CGT after prices settle
    setTimeout(function(){ window.renderCGTTab(); }, 3500);
  };

  /* ── CGT CSV export ── */
  window.exportCGTCSV = function() {
    var rows = S.fyFilter ? S.events.filter(function(e){ return e.fy===S.fyFilter; }) : S.events;
    if (!rows.length) { alert('No CGT events to export.'); return; }
    var h = 'FY,Asset,Sale Date,Acquire Date,Qty Sold,Net Proceeds (AUD),Cost Base (AUD),'+
            'Gross Gain (AUD),12m Discount Applied,Discount Amount (AUD),'+
            'Discounted Gain (AUD),Tax @ 15% (AUD),Holding Days,Type\n';
    var csv = h + rows.map(function(e){
      return [e.fy,e.asset,e.saleDate,e.acquireDate,e.qtySold.toFixed(8),
              e.proceeds.toFixed(2),e.costBase.toFixed(2),e.grossGain.toFixed(2),
              e.discountApplied?'Yes':'No',e.discountAmt.toFixed(2),
              e.discountedGain.toFixed(2),e.taxPayable.toFixed(2),e.holdingDays,e.type].join(',');
    }).join('\n');
    var a=document.createElement('a');
    a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv);
    a.download='SMSF-CGT-'+(S.fyFilter||'AllYears')+'.csv';
    a.click();
  };

  /* ────────────────────────────────────────────────────────────────────────
     CSV IMPORT LISTENER
     ─────────────────────────────────────────────────────────────────────
     We attach a SEPARATE 'change' listener on the file inputs that reads
     the CSV independently for CGT purposes, completely separate from the
     app's own handler. We do NOT wrap or modify the app's functions at all.
     This eliminates the file-read-once bug entirely.
  ──────────────────────────────────────────────────────────────────────── */
  function attachCSVListeners() {
    var inputIds = ['importFileInput', 'swyftxCSVInput'];
    inputIds.forEach(function(id) {
      var el = document.getElementById(id);
      if (!el || el._cgtListening) return;
      el.addEventListener('change', function(evt) {
        var file = evt.target.files && evt.target.files[0];
        if (!file || !file.name.toLowerCase().endsWith('.csv')) return;
        var fr = new FileReader();
        fr.onload = function(e) {
          var text = e.target.result;
          if (!text.includes('AUD Value Fee')) return; // not a Swyftx CSV
          var txns = parseSwyftxCSV(text);
          if (ingest(txns)) {
            runEngine();
            // Delay CGT badge injection to let app finish rendering the ledger
            setTimeout(addCGTBadges, 1500);
            setTimeout(addCGTBadges, 4000);
          }
        };
        fr.readAsText(file);
      }, false); // false = bubbling phase, runs AFTER app's capturing listener
      el._cgtListening = true;
    });
  }

  /* ────────────────────────────────────────────────────────────────────────
     XANO API INTERCEPT  — capture all ledger data
     ─────────────────────────────────────────────────────────────────────
     Intercept fetch/XHR to pick up the full ledger from Xano after the
     app saves and re-fetches. Captures both swyftx imports AND manually
     entered trades/sales.
  ──────────────────────────────────────────────────────────────────────── */
  function hookFetch() {
    var origFetch = window.fetch;
    window.fetch = function() {
      var args = arguments;
      var p = origFetch.apply(this, args);
      var url = String(args[0]||'');
      if (isLedgerURL(url)) {
        p.then(function(res) {
          res.clone().json().then(processAPIData).catch(function(){});
        }).catch(function(){});
      }
      return p;
    };

    var origOpen = XMLHttpRequest.prototype.open;
    var origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function(m, url) {
      this._cgtUrl = String(url||'');
      return origOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function() {
      if (isLedgerURL(this._cgtUrl)) {
        var self = this;
        this.addEventListener('load', function() {
          try { processAPIData(JSON.parse(self.responseText)); } catch(e){}
        });
      }
      return origSend.apply(this, arguments);
    };
  }

  function isLedgerURL(url) {
    if (!url) return false;
    return url.includes('xano') || url.includes('/fees') ||
           url.includes('/transactions') || url.includes('/ledger') ||
           url.includes('/holdings');
  }

  function processAPIData(data) {
    var items = Array.isArray(data) ? data
      : (data.items||data.fees||data.transactions||data.ledger||data.result||[]);
    if (!Array.isArray(items)||!items.length) return;

    // Normalise each item into our format
    var normalised = [];
    items.forEach(function(t) {
      var rawType = String(t.type||t.event||t.category||'').toLowerCase().replace('swyftx-','');
      var desc    = String(t.description||t.desc||t.note||'').toLowerCase();
      var asset   = String(t.asset||t.ticker||t.symbol||'').toUpperCase();
      var id      = String(t.id||t.uuid||t.txn_id||'');
      var date    = toISO(t.date||t.created_at||t.transaction_date||'');
      if (!asset||!id||!date) return;

      var ev = rawType;
      // Map 'trade' to buy/sell based on amount sign or description
      if (rawType==='trade') {
        var amt = pf(t.amount||t.amount_aud||t.aud_value||0);
        ev = (amt < 0 || desc.includes('sell')) ? 'sell' : 'buy';
      }
      if (!['buy','sell','swap','convert','purchase','sale'].includes(ev)) return;
      ev = normaliseEvent(ev);

      var gross = pf(t.gross_cost||t.gross_proceeds||t.aud_value||t.amount_aud||
                     Math.abs(pf(t.amount||0)));
      var fee   = pf(t.fee||t.fee_aud||t.brokerage||0);
      var qty   = pf(t.qty||t.quantity||t.amount_asset||t.amount||0);

      normalised.push({
        id:       id,
        date:     date,
        event:    ev,
        asset:    asset,
        qty:      Math.abs(qty),
        audValue: gross,
        feeAUD:   fee,
        netValue: gross - fee,
        source:   t.source||'manual'
      });
    });

    if (normalised.length && ingest(normalised)) {
      runEngine();
      setTimeout(addCGTBadges, 500);
    }
  }

  /* ────────────────────────────────────────────────────────────────────────
     CGT BADGE INJECTION  — adds a small pill to disposal ledger rows only
     ─────────────────────────────────────────────────────────────────────
     Only adds a CGT badge. Does NOT modify the amount column at all.
     The app's own fee display (separate Brokerage rows) is left untouched.
  ──────────────────────────────────────────────────────────────────────── */
  function addCGTBadges() {
    var tbody = document.getElementById('feesB');
    if (!tbody || !S.events.length) return;

    // Build lookup: disposalId → CGT events
    var byId = {};
    S.events.forEach(function(ev) {
      if (!byId[ev.disposalId]) byId[ev.disposalId] = [];
      byId[ev.disposalId].push(ev);
    });

    tbody.querySelectorAll('tr').forEach(function(row) {
      if (row.dataset.cgtBadge) return;

      var txnId = row.dataset.txnId || row.dataset.id ||
                  row.getAttribute('data-txn-id') || row.getAttribute('data-id');
      if (!txnId || !byId[txnId]) return;

      var evs     = byId[txnId];
      var totTax  = evs.reduce(function(s,e){ return s+e.taxPayable; },0);
      var totGain = evs.reduce(function(s,e){ return s+e.grossGain; },0);
      var hasDisc = evs.some(function(e){ return e.discountApplied; });

      // Add pill to last cell
      var cells   = row.querySelectorAll('td');
      var lastTd  = cells[cells.length-1];
      if (!lastTd || lastTd.querySelector('.cgt-ledger-pill')) return;

      var pill = document.createElement('span');
      pill.className = 'cgt-ledger-pill '+(totGain>=0?'cgt-pill-pos':'cgt-pill-neg');
      pill.title = 'CGT: Gross gain '+fmtAUD(totGain)+
                   ' · Est. tax '+fmtAUD(totTax)+
                   (hasDisc?' · 12-month discount applied':'');
      pill.textContent = 'CGT '+fmtAUD(totTax);
      lastTd.appendChild(pill);
      row.dataset.cgtBadge = '1';
    });
  }

  /* ────────────────────────────────────────────────────────────────────────
     TAB ROUTING  — hook switchTab and data-action clicks
  ──────────────────────────────────────────────────────────────────────── */
  function hookTabs() {
    // Wrap switchTab once it's defined by the app
    var wrap = function() {
      if (typeof window.switchTab!=='function'||window.switchTab._cgtV3) return false;
      var orig = window.switchTab;
      window.switchTab = function(tab) {
        orig.call(this, tab);
        if (tab==='cgt') setTimeout(window.renderCGTTab, 60);
        else if (tab==='fees') setTimeout(addCGTBadges, 400);
      };
      window.switchTab._cgtV3 = true;
      return true;
    };
    if (!wrap()) {
      var n=0, iv=setInterval(function(){ if(wrap()||++n>80) clearInterval(iv); }, 250);
    }
  }

  // Also handle data-action clicks directly (belt + braces)
  document.addEventListener('click', function(e) {
    var btn = e.target.closest('[data-action="switchTab"]');
    if (!btn) return;
    var tab = btn.getAttribute('data-tab');
    if (tab==='cgt')  setTimeout(window.renderCGTTab, 80);
    if (tab==='fees') setTimeout(addCGTBadges, 450);
  }, false);

  /* ────────────────────────────────────────────────────────────────────────
     MUTATION OBSERVER  — re-badge ledger after re-renders
  ──────────────────────────────────────────────────────────────────────── */
  function watchLedger() {
    var obs = new MutationObserver(function() {
      clearTimeout(window._cgtBT);
      window._cgtBT = setTimeout(addCGTBadges, 350);
    });
    var attach = function() {
      var tb = document.getElementById('feesB');
      if (!tb) return false;
      obs.observe(tb, { childList:true, subtree:false });
      return true;
    };
    if (!attach()) {
      var bObs = new MutationObserver(function(){ if(attach()) bObs.disconnect(); });
      bObs.observe(document.body, { childList:true, subtree:true });
    }
  }

  /* ────────────────────────────────────────────────────────────────────────
     BOOT
  ──────────────────────────────────────────────────────────────────────── */
  function boot() {
    hookFetch();
    hookTabs();
    watchLedger();

    // Attach CSV listeners — retry to handle dynamic inputs
    attachCSVListeners();
    setTimeout(attachCSVListeners, 1000);
    setTimeout(attachCSVListeners, 3000);

    // Initial badge pass after app renders
    setTimeout(addCGTBadges, 2000);
    setTimeout(addCGTBadges, 5000);
  }

  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

})();
