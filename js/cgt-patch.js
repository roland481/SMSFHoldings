/* ═══════════════════════════════════════════════════════════════════════════
   cgt-patch.js  —  SMSF CGT Patch (self-contained interceptor)
   ═══════════════════════════════════════════════════════════════════════════
   Strategy:
   1. Intercepts fetch/XHR to Xano to capture transaction data
   2. Parses Swyftx transactions and corrects the ledger double-count display
   3. Runs the CGT engine and renders the CGT Summary tab
   4. Patches switchTab() so CGT tab always shows fresh data
   5. Patches importSwyftxCSV() to capture data on CSV upload
   ═══════════════════════════════════════════════════════════════════════════ */

(function() {
  'use strict';

  /* ── Internal state ─────────────────────────────────────────────────────── */
  const CGT = {
    acquisitions : [],
    disposals    : [],
    cgtEvents    : [],
    unrealised   : [],
    fyFilter     : '',
    rawTxns      : [],
  };

  /* ── Utility ─────────────────────────────────────────────────────────────── */
  function aud(n) {
    if (n == null || isNaN(n)) return '—';
    const abs = Math.abs(n);
    const s = abs.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (n < 0 ? '−$' : '$') + s;
  }
  function audAbs(n) {
    return '$' + Math.abs(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function colClass(n) { return n > 0 ? 'cgt-pos' : n < 0 ? 'cgt-neg' : ''; }
  function parseDate(s) {
    if (!s) return null;
    if (String(s).includes('/')) { const [d,m,y] = String(s).split('/'); return new Date(+y, +m-1, +d); }
    return new Date(s);
  }
  function daysBetween(a, b) { return Math.floor((b - a) / 86400000); }
  function getFY(dateStr) {
    const d = parseDate(dateStr);
    if (!d) return 'Unknown';
    const y = d.getFullYear(), m = d.getMonth() + 1;
    return m >= 7 ? ('FY'+y+'-'+String(y+1).slice(2)) : ('FY'+(y-1)+'-'+String(y).slice(2));
  }

  /* ── CSV line parser ────────────────────────────────────────────────────── */
  function parseCSVLine(line) {
    const r = []; let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { if (q && line[i+1]==='"') { cur+='"'; i++; } else q=!q; }
      else if (c===',' && !q) { r.push(cur); cur=''; }
      else cur += c;
    }
    r.push(cur); return r;
  }
  function swyftxDateToISO(s) {
    if (!s) return '';
    if (String(s).includes('/')) {
      const p = String(s).split('/');
      return p[2]+'-'+p[1].padStart(2,'0')+'-'+p[0].padStart(2,'0');
    }
    return s;
  }

  /* ── Parse Swyftx CSV text ──────────────────────────────────────────────── */
  function parseSwyftxText(text) {
    const lines = text.split('\n').map(function(l){ return l.trim(); }).filter(Boolean);
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
      if (!event || event === 'sub total' || event === 'open position') continue;
      var dateRaw = (row[col['Date']]||'').trim();
      if (!dateRaw) continue;
      var asset    = (row[col['Asset']]||'').trim().toUpperCase();
      var qty      = parseFloat(row[col['Amount']]) || 0;
      var audValue = parseFloat(row[col['AUD Value']]) || 0;
      var feeAUD   = parseFloat(row[col['AUD Value Fee']]) || 0;
      var netValue = audValue - feeAUD;
      var rate     = parseFloat(row[col['Rate']]) || 0;
      var txnId    = (row[col['Transaction ID']]||row[col['UUID']]||'').trim() ||
                     ('sw_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,6));
      txns.push({
        id: txnId, date: swyftxDateToISO(dateRaw), event: event, asset: asset,
        qty: qty, audValue: audValue, feeAUD: feeAUD, netValue: netValue, rate: rate,
        source: 'swyftx'
      });
    }
    return txns;
  }

  /* ── Ingest transactions ────────────────────────────────────────────────── */
  function ingestTxns(txns) {
    CGT.rawTxns = txns;
    CGT.acquisitions = [];
    CGT.disposals    = [];
    txns.forEach(function(t) {
      var ev = (t.event || t.type || '').toLowerCase().replace('swyftx-','');
      if (ev === 'buy') {
        CGT.acquisitions.push({ id:t.id, asset:t.asset, date:t.date, qty:t.qty,
          grossCost: t.audValue || t.grossCost || 0 });
      } else if (ev === 'sell') {
        CGT.disposals.push({ id:t.id, asset:t.asset, date:t.date, qty:t.qty,
          grossProceeds: t.audValue || t.grossProceeds || 0, fee: t.feeAUD || t.fee || 0, type:'sale' });
      } else if (ev === 'swap' || ev === 'convert') {
        CGT.disposals.push({ id:t.id, asset:t.asset, date:t.date, qty:t.qty,
          grossProceeds: t.audValue || t.grossCost || 0, fee: t.feeAUD || t.fee || 0, type:'swap' });
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
    var method = getCGTMethod();
    CGT.cgtEvents = calcCGT(CGT.disposals, CGT.acquisitions, method);
    CGT.unrealised = buildUnrealised();
  }

  function calcCGT(disposals, acquisitions, method) {
    var results = [];
    var pool = {};
    acquisitions.forEach(function(a) {
      var k = a.asset.toUpperCase();
      if (!pool[k]) pool[k] = [];
      pool[k].push({ id:a.id, date:parseDate(a.date), dateStr:a.date,
                     totalQty:+a.qty, remaining:+a.qty, grossCost:+a.grossCost });
    });

    function sortPool(arr, saleDate, m) {
      var p = arr.filter(function(x){ return x.remaining > 0; });
      if (m === 'lifo') {
        p.sort(function(a,b){ return b.date - a.date; });
      } else if (m === 'mincgt') {
        var sd = saleDate ? parseDate(saleDate) : new Date();
        p.sort(function(a,b){
          var da = daysBetween(a.date,sd) > 365 ? 1 : 0;
          var db = daysBetween(b.date,sd) > 365 ? 1 : 0;
          return (db-da) || (a.date - b.date);
        });
      } else {
        p.sort(function(a,b){ return a.date - b.date; });
      }
      return p;
    }

    disposals.forEach(function(d) {
      var k = (d.asset||'').toUpperCase();
      if (!pool[k]) return;
      var qty = +d.qty;
      var saleDate = parseDate(d.date);
      var netProc  = (+d.grossProceeds) - (+d.fee||0);
      var origQty  = qty;

      sortPool(pool[k], d.date, method).forEach(function(p) {
        if (qty <= 0) return;
        var used  = Math.min(qty, p.remaining);
        var costB = p.grossCost * (used / p.totalQty);
        var procS = netProc * (used / origQty);
        var gross = procS - costB;
        var days  = saleDate ? daysBetween(p.date, saleDate) : 0;
        var disc  = days > 365 && gross > 0;
        var discA = disc ? gross / 3 : 0;
        var netG  = gross - discA;
        var tax   = netG > 0 ? netG * 0.15 : 0;
        results.push({
          disposalId:d.id, parcelId:p.id, asset:k,
          saleDate:d.date, acquireDate:p.dateStr,
          qtySold:used, proceeds:procS, costBase:costB,
          grossGain:gross, discountApplied:disc, discountAmt:discA,
          discountedGain:netG, taxPayable:tax,
          holdingDays:days, type:d.type||'sale', fy:getFY(d.date)
        });
        p.remaining -= used; qty -= used;
      });
    });
    return results;
  }

  /* ── Unrealised gains ───────────────────────────────────────────────────── */
  function buildUnrealised() {
    var pool = {};
    CGT.acquisitions.forEach(function(a) {
      var k = a.asset.toUpperCase();
      if (!pool[k]) pool[k] = [];
      pool[k].push({ date:parseDate(a.date), totalQty:+a.qty, remaining:+a.qty,
                     grossCost:+a.grossCost, dateStr:a.date });
    });
    CGT.disposals.forEach(function(d) {
      var k = (d.asset||'').toUpperCase();
      if (!pool[k]) return;
      pool[k].sort(function(a,b){ return a.date-b.date; });
      var qty = +d.qty;
      pool[k].forEach(function(p){
        if (qty<=0) return;
        var u=Math.min(qty,p.remaining); p.remaining-=u; qty-=u;
      });
    });

    // Get prices from holdings table
    var prices = {};
    document.querySelectorAll('#allHoldingsB tr').forEach(function(tr) {
      var sym = tr.querySelector('.tkr-sym');
      var cells = tr.querySelectorAll('td');
      if (!sym || cells.length < 5) return;
      var k = sym.textContent.trim().toUpperCase();
      // Price column is index 4 (Price AUD)
      var pCell = cells[4];
      var p = parseFloat((pCell ? pCell.textContent : '').replace(/[$,\s]/g,''));
      if (k && p > 0) prices[k] = p;
    });

    var today = new Date();
    var rows = [];
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
      var price = prices[asset] || 0;
      var val   = qty * price;
      var unr   = val - cost;
      var days  = earliest ? daysBetween(earliest, today) : 0;
      var disc  = days > 365;
      var netG  = disc && unr > 0 ? unr * 2/3 : unr;
      var tax   = netG > 0 ? netG * 0.15 : 0;
      rows.push({ asset:asset, qty:qty, costBase:cost, currentValue:val,
                  unrealisedGain:unr, holdingDays:days, discountElig:disc,
                  estimatedTax:tax, priceAvailable:price>0 });
    });
    rows.sort(function(a,b){ return b.unrealisedGain - a.unrealisedGain; });
    return rows;
  }

  /* ══ LEDGER PATCH — fix Swyftx double-count display ═════════════════════ */
  function patchLedger() {
    var tbody = document.getElementById('feesB');
    if (!tbody) return;

    tbody.querySelectorAll('tr').forEach(function(row) {
      if (row.dataset.cgtPatched) return;
      var cells = row.querySelectorAll('td');
      if (cells.length < 3) return;

      // Try to match this row to a Swyftx transaction
      var txnId = row.dataset.txnId || row.dataset.id || row.getAttribute('data-txn-id');
      var matched = null;

      if (txnId) {
        matched = CGT.rawTxns.find(function(t){ return t.id === txnId; });
      }

      // Fallback: match by description text
      if (!matched) {
        var allText = row.textContent.toUpperCase();
        CGT.rawTxns.forEach(function(t) {
          if (!matched && t.asset && allText.includes(t.asset)) {
            if ((t.event==='buy' && allText.includes('BUY')) ||
                (t.event==='sell' && allText.includes('SELL')) ||
                (t.event==='swap' && allText.includes('SWAP'))) {
              matched = t;
            }
          }
        });
      }

      if (!matched) return;
      var ev = matched.event || '';
      if (!['buy','sell','swap','convert'].includes(ev)) return;
      if (!matched.feeAUD || matched.feeAUD === 0) { row.dataset.cgtPatched='1'; return; }

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
    for (var i = cells.length-1; i >= 0; i--) {
      var txt = cells[i].textContent.replace(/[$,\s\u2212\-]/g,'');
      if (/^\d+(\.\d+)?$/.test(txt)) return cells[i];
    }
    return cells[Math.max(0, cells.length-2)];
  }

  function buildSplitHTML(gross, fee, net, isSell) {
    var sign     = isSell ? '' : '−';
    var netCol   = isSell ? 'var(--gain-pos)' : 'var(--gain-neg)';
    var label    = isSell ? 'Net proceeds' : 'Net cost';
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
    var evs = CGT.cgtEvents.filter(function(e){ return e.disposalId === txnId; });
    if (!evs.length) return;
    var lastCell = cells[cells.length-1];
    if (!lastCell || lastCell.querySelector('.cgt-ledger-pill')) return;
    var totTax  = evs.reduce(function(s,e){ return s+e.taxPayable; },0);
    var totGain = evs.reduce(function(s,e){ return s+e.grossGain; },0);
    var hasDisc = evs.some(function(e){ return e.discountApplied; });
    var pill = document.createElement('span');
    pill.className = 'cgt-ledger-pill ' + (totGain>=0?'cgt-pill-pos':'cgt-pill-neg');
    pill.title = 'CGT: Gross gain '+aud(totGain)+' · Est. tax '+aud(totTax)+(hasDisc?' · 12m discount applied':'');
    pill.textContent = 'CGT '+aud(totTax);
    lastCell.appendChild(pill);
  }

  function injectAllBadges() {
    var byDisp = {};
    CGT.cgtEvents.forEach(function(ev){ if(!byDisp[ev.disposalId]) byDisp[ev.disposalId]=[]; byDisp[ev.disposalId].push(ev); });
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
    allEvs.forEach(function(e){ if(allFYs.indexOf(e.fy)<0) allFYs.push(e.fy); });
    allFYs.sort();

    var totGross = filtered.reduce(function(s,e){ return s+e.grossGain; },0);
    var totDisc  = filtered.reduce(function(s,e){ return s+e.discountAmt; },0);
    var totNet   = filtered.reduce(function(s,e){ return s+e.discountedGain; },0);
    var totTax   = filtered.reduce(function(s,e){ return s+e.taxPayable; },0);

    var fyOpts = '<option value="">All financial years</option>' +
      allFYs.map(function(fy){ return '<option value="'+fy+'"'+(fy===fyFilter?' selected':'')+'>'+fy+'</option>'; }).join('');

    var methLabel = {fifo:'FIFO — First in, first out', lifo:'LIFO — Last in, first out', mincgt:'Minimise CGT'}[method]||method;

    /* Realised rows */
    var eventRows = filtered.length === 0
      ? '<tr><td colspan="9" style="text-align:center;color:var(--text4);padding:28px;">No disposal events in this period. Import sell transactions to see CGT calculations.</td></tr>'
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

    /* Unrealised rows */
    var unrRows = CGT.unrealised.length === 0
      ? '<tr><td colspan="7" style="text-align:center;color:var(--text4);padding:20px;">No open positions found. Prices may not have loaded yet — try refreshing prices first, then re-open this tab.</td></tr>'
      : CGT.unrealised.map(function(u) {
          var disc = u.discountElig
            ? '<span class="cgt-badge cgt-disc">✓ −⅓</span>'
            : '<span class="cgt-badge cgt-none">'+u.holdingDays+'d</span>';
          var noP  = !u.priceAvailable ? ' <span style="font-size:10px;color:var(--text4);">(no price)</span>' : '';
          return '<tr>'+
            '<td><span class="badge b-amber" style="font-size:10px;">'+u.asset+'</span></td>'+
            '<td class="r mob-hide" style="font-size:11px;">'+u.qty.toLocaleString('en-AU',{maximumFractionDigits:6})+'</td>'+
            '<td class="r">'+aud(u.costBase)+'</td>'+
            '<td class="r">'+(u.priceAvailable?aud(u.currentValue):'—')+noP+'</td>'+
            '<td class="r '+colClass(u.unrealisedGain)+'" style="font-weight:600;">'+(u.priceAvailable?aud(u.unrealisedGain):'—')+'</td>'+
            '<td class="r" style="text-align:center;">'+disc+'</td>'+
            '<td class="r '+colClass(u.estimatedTax)+'" style="font-weight:700;">'+(u.priceAvailable?aud(u.estimatedTax):'—')+'</td>'+
          '</tr>';
        }).join('');

    container.innerHTML =
    /* Settings bar */
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
        '<select id="cgtFYSelect" onchange="window._cgtChangeFY(this.value)" style="font-size:12px;padding:4px 10px;border:1px solid var(--border4);border-radius:99px;background:var(--surface2);color:var(--text);font-family:Arial,Helvetica,sans-serif;cursor:pointer;">'+
          fyOpts+
        '</select>'+
      '</div>'+
    '</div>'+

    /* Summary cards */
    '<div class="cgt-cards">'+
      '<div class="cgt-card"><div class="cgt-card-lbl">Gross capital gain</div><div class="cgt-card-val '+colClass(totGross)+'">'+aud(totGross)+'</div><div class="cgt-card-sub">Before discount</div></div>'+
      '<div class="cgt-card"><div class="cgt-card-lbl">12-month discount</div><div class="cgt-card-val" style="color:var(--accent);">'+aud(totDisc)+'</div><div class="cgt-card-sub">⅓ off gains held &gt;12 months</div></div>'+
      '<div class="cgt-card"><div class="cgt-card-lbl">Net taxable gain</div><div class="cgt-card-val '+colClass(totNet)+'">'+aud(totNet)+'</div><div class="cgt-card-sub">After discount</div></div>'+
      '<div class="cgt-card cgt-card-hl"><div class="cgt-card-lbl">Estimated tax @ 15%</div><div class="cgt-card-val cgt-neg" style="font-size:22px;">'+aud(totTax)+'</div><div class="cgt-card-sub">Accumulation phase</div></div>'+
    '</div>'+

    /* Realised table */
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

    /* Unrealised table */
    '<div class="cgt-sec-head" style="margin-top:20px;">'+
      '<span class="cgt-sec-title"><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="8" cy="8" r="6"/><path d="M8 5v3"/><circle cx="8" cy="11.5" r=".5" fill="currentColor"/></svg> Unrealised gains &amp; losses — open positions</span>'+
      '<span style="font-size:11px;color:var(--text4);">Estimated if sold today</span>'+
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
      '12-month discount (⅓ reduction, effective rate 10%) per s.115 ITAA 1997. '+
      'Cost base includes brokerage fees per ATO s.110-25 ITAA 1997. '+
      'Parcel method: <strong style="color:var(--text3);">'+methLabel+'</strong>.'+
    '</div>';
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
      return [e.fy,e.asset,e.saleDate,e.acquireDate,e.qtySold.toFixed(8),
              e.proceeds.toFixed(2),e.costBase.toFixed(2),e.grossGain.toFixed(2),
              e.discountApplied?'Yes':'No',e.discountAmt.toFixed(2),
              e.discountedGain.toFixed(2),e.taxPayable.toFixed(2),e.holdingDays,e.type].join(',');
    })).join('\n');
    var a = document.createElement('a');
    a.href = 'data:text/csv;charset=utf-8,'+encodeURIComponent(csv);
    a.download = 'SMSF-CGT-'+(CGT.fyFilter||'AllYears')+'.csv';
    a.click();
  };

  /* ── Settings handlers ──────────────────────────────────────────────────── */
  window._cgtChangeMethod = function(val) { setCGTMethod(val); window.renderCGTTab(); };
  window._cgtChangeFY     = function(val) { CGT.fyFilter=val; window.renderCGTTab(); };

  /* ══ INTERCEPT SWYFTX IMPORT ══════════════════════════════════════════════ */
  function hookImport() {
    var origU = window.handleUniversalImport;
    var origS = window.importSwyftxCSV;

    if (typeof origU === 'function') {
      window.handleUniversalImport = function(input) {
        var file = input && input.files && input.files[0];
        if (file && file.name.toLowerCase().endsWith('.csv')) {
          var fr = new FileReader();
          fr.onload = function(e) {
            var text = e.target.result;
            if (text.includes('AUD Value Fee') || text.includes('Crypto Transactions')) {
              var txns = parseSwyftxText(text);
              ingestTxns(txns); runCGT();
            }
            origU.call(window, input);
            setTimeout(function(){ patchLedger(); }, 900);
            setTimeout(function(){ patchLedger(); }, 2500);
          };
          fr.readAsText(file); return;
        }
        origU.call(window, input);
      };
    }

    if (typeof origS === 'function') {
      window.importSwyftxCSV = function(input) {
        var file = input && input.files && input.files[0];
        if (file) {
          var fr = new FileReader();
          fr.onload = function(e) {
            var txns = parseSwyftxText(e.target.result);
            ingestTxns(txns); runCGT();
            origS.call(window, input);
            setTimeout(function(){ patchLedger(); }, 900);
            setTimeout(function(){ patchLedger(); }, 2500);
          };
          fr.readAsText(file); return;
        }
        origS.call(window, input);
      };
    }
  }

  /* ══ INTERCEPT XANO API ═══════════════════════════════════════════════════ */
  function hookFetch() {
    var origFetch = window.fetch;
    window.fetch = function() {
      var args = arguments;
      return origFetch.apply(this, args).then(function(res) {
        var url = (args[0]||'').toString();
        if (url.includes('xano') || url.includes('/fees') || url.includes('/transactions') || url.includes('/ledger')) {
          res.clone().json().then(extractXanoTxns).catch(function(){});
        }
        return res;
      });
    };
    var origOpen = XMLHttpRequest.prototype.open;
    var origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function(method, url) {
      this._patchUrl = url; return origOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function() {
      var self = this;
      this.addEventListener('load', function() {
        if (self._patchUrl && (self._patchUrl.includes('xano')||self._patchUrl.includes('/fees'))) {
          try { extractXanoTxns(JSON.parse(self.responseText)); } catch(e){}
        }
      });
      return origSend.apply(this, arguments);
    };
  }

  function extractXanoTxns(data) {
    var items = Array.isArray(data) ? data : (data.items||data.fees||data.transactions||data.ledger||[]);
    if (!Array.isArray(items)||!items.length) return;
    var swyftx = items.filter(function(t){
      var type = (t.type||t.event||'').toLowerCase();
      return t.source==='swyftx' || type.includes('swyftx');
    });
    if (!swyftx.length) return;
    var existing = {};
    CGT.rawTxns.forEach(function(t){ existing[t.id]=true; });
    var fresh = swyftx.filter(function(t){ return !existing[t.id||t.uuid]; }).map(function(t){
      var gross = parseFloat(t.gross_cost||t.gross_proceeds||t.aud_value||t.amount_aud||0);
      var fee   = parseFloat(t.fee||t.fee_aud||0);
      return {
        id:    t.id||t.uuid||t.txn_id,
        date:  t.date||t.created_at,
        event: (t.type||t.event||'').replace('swyftx-','').toLowerCase(),
        asset: (t.asset||t.ticker||'').toUpperCase(),
        qty:   parseFloat(t.qty||t.amount||0),
        audValue: gross, feeAUD: fee, netValue: gross-fee, source:'swyftx'
      };
    });
    if (fresh.length) {
      ingestTxns(CGT.rawTxns.concat(fresh));
      runCGT();
      setTimeout(function(){ patchLedger(); }, 600);
    }
  }

  /* ══ PATCH switchTab ══════════════════════════════════════════════════════ */
  function hookSwitchTab() {
    var tryWrap = function() {
      if (typeof window.switchTab !== 'function') return false;
      var orig = window.switchTab;
      window.switchTab = function(tab) {
        orig.call(this, tab);
        if (tab==='cgt') setTimeout(function(){ window.renderCGTTab(); }, 60);
        else if (tab==='fees') setTimeout(function(){ patchLedger(); }, 450);
      };
      return true;
    };
    if (!tryWrap()) {
      var n=0, iv=setInterval(function(){ if(tryWrap()||++n>60) clearInterval(iv); }, 250);
    }
  }

  /* ══ CLICK LISTENER FOR DATA-ACTION TABS ═════════════════════════════════ */
  document.addEventListener('click', function(e) {
    var btn = e.target.closest('[data-action="switchTab"]');
    if (!btn) return;
    var tab = btn.getAttribute('data-tab');
    if (tab==='cgt') setTimeout(function(){ window.renderCGTTab(); }, 80);
    else if (tab==='fees') setTimeout(function(){ patchLedger(); }, 500);
  }, true);

  /* ══ MUTATION OBSERVER — patch ledger whenever feesB updates ════════════ */
  function watchLedger() {
    var obs = new MutationObserver(function() {
      clearTimeout(window._cgtPT);
      window._cgtPT = setTimeout(function(){ patchLedger(); }, 250);
    });
    var attach = function() {
      var tb = document.getElementById('feesB');
      if (tb) { obs.observe(tb, {childList:true, subtree:true}); return true; }
      return false;
    };
    if (!attach()) {
      var bObs = new MutationObserver(function(){
        if (attach()) bObs.disconnect();
      });
      bObs.observe(document.body, {childList:true, subtree:true});
    }
  }

  /* ══ BOOT ═════════════════════════════════════════════════════════════════ */
  function boot() {
    hookFetch();
    hookSwitchTab();
    watchLedger();
    setTimeout(hookImport, 600);
    setTimeout(hookImport, 1800);
    setTimeout(function(){ patchLedger(); }, 1800);
    setTimeout(function(){ patchLedger(); }, 4000);
  }

  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

})();
