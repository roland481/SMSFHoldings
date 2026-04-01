/* ═══════════════════════════════════════════════════════════════════════════
   eofy-report.js  —  SMSF End of Financial Year Report Generator
   ═══════════════════════════════════════════════════════════════════════════
   Generates a print-ready HTML report from live S state data.
   Opens in a new window → user prints to PDF via Ctrl+P / Cmd+P.
   No server calls required — reads directly from window.S.
   ═══════════════════════════════════════════════════════════════════════════ */

function generateEOFYReport() {
  var state = (typeof S !== 'undefined' ? S : window.S);
  var auth  = (typeof AUTH !== 'undefined' ? AUTH : window.AUTH);
  if (!state || !auth || !auth.currentPortfolioId) {
    alert('Please wait for the portfolio to finish loading before generating the report.');
    return;
  }

  // ── FY selection ────────────────────────────────────────────────────────
  var now     = new Date();
  var curFYEnd = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  var fyInput = prompt(
    'Generate EOFY Report for which financial year?\n\nEnter the year the FY ends (e.g. enter 2025 for FY2024-25):',
    curFYEnd
  );
  if (!fyInput) return;
  var fyEndYear = parseInt(fyInput);
  if (isNaN(fyEndYear) || fyEndYear < 2020 || fyEndYear > 2040) {
    alert('Invalid year. Please enter a year between 2020 and 2040.');
    return;
  }
  var fyStartYear = fyEndYear - 1;
  var fyLabel     = 'FY' + fyStartYear + '–' + String(fyEndYear).slice(2);
  var fyStart     = new Date(fyStartYear, 6, 1);   // 1 July
  var fyEnd       = new Date(fyEndYear,   5, 30);  // 30 June

  function inFY(dateStr) {
    if (!dateStr) return false;
    var d = new Date(dateStr + 'T00:00:00');
    return d >= fyStart && d <= fyEnd;
  }

  // ── Formatters ───────────────────────────────────────────────────────────
  function aud(n, showSign) {
    if (n == null || isNaN(n)) return '—';
    var abs = Math.abs(n).toLocaleString('en-AU', { minimumFractionDigits:2, maximumFractionDigits:2 });
    var sign = showSign && n > 0 ? '+' : '';
    return sign + (n < 0 ? '−' : '') + '$' + abs;
  }
  function fmtDate(s) {
    if (!s) return '—';
    var d = new Date(s + 'T00:00:00');
    return d.toLocaleDateString('en-AU', { day:'2-digit', month:'short', year:'numeric' });
  }
  function pf(v) { return parseFloat(v) || 0; }

  // ── Portfolio name ───────────────────────────────────────────────────────
  var portfolio = (auth.portfolios || []).find(function(p) {
    return p.id === auth.currentPortfolioId;
  });
  var portfolioName = portfolio ? portfolio.name : 'SMSF Portfolio';

  // ── 1. PORTFOLIO VALUE ───────────────────────────────────────────────────
  var r = pf(state.audUsd) || 0.64;
  var usVal=0, asxVal=0, cryVal=0, metVal=0, cashVal=0;
  var usCost=0, asxCost=0, cryCost=0, metCost=0;

  state.us.forEach(function(h) {
    var p = state.prices['us:'+h.ticker];
    if (p && h.qty) { usVal += (p.price/r)*h.qty; usCost += pf(h.cost)*h.qty; }
  });
  state.asx.forEach(function(h) {
    var p = state.prices['asx:'+h.ticker];
    if (p && h.qty) { asxVal += p.price*h.qty; asxCost += pf(h.cost)*h.qty; }
  });
  state.cry.forEach(function(h) {
    var p = state.prices['cry:'+h.ticker];
    if (p && h.qty) { cryVal += p.price*h.qty; cryCost += pf(h.cost)*h.qty; }
  });
  state.met.forEach(function(h) {
    var p = state.prices['met:'+h.ticker];
    if (p && h.qty) { metVal += p.price*h.qty; metCost += pf(h.cost)*h.qty; }
  });
  cashVal = state.cash.reduce(function(s,a){ return s+(a.balance||0); }, 0);
  var totalVal  = usVal + asxVal + cryVal + metVal + cashVal;
  var totalInv  = usVal + asxVal + cryVal + metVal;
  var totalCost = usCost + asxCost + cryCost + metCost;
  var totalGL   = totalInv - totalCost;

  // ── 2. HOLDINGS TABLE ───────────────────────────────────────────────────
  var holdingRows = [];
  var typeLabel   = { us:'US Stock', asx:'ASX Stock', cry:'Crypto', met:'Metal' };
  ['us','asx','cry','met'].forEach(function(type) {
    state[type].forEach(function(h) {
      var p    = state.prices[type+':'+h.ticker];
      var val  = p && h.qty ? (type==='us' ? (p.price/r)*h.qty : p.price*h.qty) : null;
      var cost = pf(h.cost) * h.qty;
      var gl   = val !== null ? val - cost : null;
      holdingRows.push({
        ticker: h.ticker, name: h.name, type: typeLabel[type],
        qty: h.qty, price: p ? (type==='us' ? p.price/r : p.price) : null,
        value: val, cost: cost, gl: gl
      });
    });
  });
  holdingRows.sort(function(a,b){ return (b.value||0)-(a.value||0); });

  // ── 3. FY LEDGER ENTRIES ─────────────────────────────────────────────────
  var fyFees = (state.fees||[]).filter(function(e){ return inFY(e.date); });
  var fyIncome = (state.income||[]).filter(function(e){ return inFY(e.date); });
  var fyContribs = (state.contributions||[]).filter(function(e){ return inFY(e.date); });

  var totalFees    = fyFees.reduce(function(s,e){ return s+pf(e.amount); }, 0);
  var totalIncome  = fyIncome.reduce(function(s,e){ return s+pf(e.amount); }, 0);
  var totalFranking = fyIncome.reduce(function(s,e){ return s+pf(e.franking); }, 0);
  var totalContribs = fyContribs.reduce(function(s,e){ return s+pf(e.amount); }, 0);
  var concContribs  = fyContribs.filter(function(e){ return (e.type||'').toLowerCase().includes('concess'); })
                                .reduce(function(s,e){ return s+pf(e.amount); }, 0);
  var nonConcContribs = totalContribs - concContribs;

  // ── 4. FY TRADES ────────────────────────────────────────────────────────
  var fyTrades = [];
  ['us','asx','cry','met'].forEach(function(type) {
    state[type].forEach(function(h) {
      (h.txns||[]).forEach(function(tx) {
        if (!inFY(tx.date)) return;
        var gross = pf(tx.qty) * pf(tx.price);
        var fee   = pf(tx.fee);
        // Swyftx stores price as audVal/qty where audVal is GROSS (fee inside).
        // CommSec/manual stores price as net per-unit (fee is additive).
        var isSwyftx = !!(tx.swyftxId || (tx.source_id && (String(tx.source_id).startsWith('ord_') || String(tx.source_id).startsWith('dep_'))));
        // netTotal = the trade value excluding brokerage
        var netTotal = isSwyftx ? gross - fee : gross;
        // grossTotal = actual cash movement
        var grossTotal = isSwyftx ? gross : gross + fee;
        fyTrades.push({
          date: tx.date, ticker: h.ticker, name: h.name,
          side: tx.side, qty: tx.qty, price: tx.price,
          fee: fee, netTotal: netTotal, grossTotal: grossTotal,
          isSwyftx: isSwyftx
        });
      });
    });
  });
  fyTrades.sort(function(a,b){ return a.date.localeCompare(b.date); });

  var fyBuys  = fyTrades.filter(function(t){ return t.side==='buy'; });
  var fySells = fyTrades.filter(function(t){ return t.side==='sell'; });
  // totalBought/Sold = actual cash movements (gross)
  var totalBought = fyBuys.reduce(function(s,t){ return s+t.grossTotal; }, 0);
  var totalSold   = fySells.reduce(function(s,t){ return s+t.grossTotal; }, 0);

  // ── 5. CGT (reuse cgt-patch engine if available) ─────────────────────────
  var cgtEvents = [];
  var cgtTotals = { gross:0, discount:0, net:0, tax:0 };
  if (typeof window.renderCGTTab === 'function' && typeof calcCGT === 'undefined') {
    // CGT patch is loaded — trigger a calculation
    try {
      // Access the internal runCGT via a temp render to a hidden div
      var tmp = document.createElement('div');
      tmp.id = '_eofy_tmp_cgt';
      tmp.style.display = 'none';
      document.body.appendChild(tmp);
      var origContainer = document.getElementById('cgt-summary-container');
      // Swap container temporarily
      if (origContainer) {
        origContainer.id = '_cgt_orig';
        tmp.id = 'cgt-summary-container';
        window.renderCGTTab();
        tmp.id = '_eofy_tmp_cgt';
        origContainer.id = 'cgt-summary-container';
      }
      document.body.removeChild(tmp);
    } catch(e) {}
  }

  // Build CGT from S directly (same logic as cgt-patch.js)
  var acq = [], disp = [];
  ['cry','us','asx','met'].forEach(function(type) {
    state[type].forEach(function(h) {
      var ticker = h.ticker.toUpperCase();
      (h.txns||[]).forEach(function(tx) {
        var qty   = pf(tx.qty), price = pf(tx.price), fee = pf(tx.fee);
        var gross = qty * price;
        var id    = tx.txnId || tx.swyftxId || tx.commsecIntlId || (ticker+'_'+tx.date+'_'+qty);
        // Swyftx: price = audVal/qty where audVal is GROSS (fee inside) → grossCost = gross
        // CommSec/manual: price is net per-unit → grossCost = gross + fee
        var isSwyftx  = !!(tx.swyftxId || (tx.source_id && (String(tx.source_id).startsWith('ord_') || String(tx.source_id).startsWith('dep_'))));
        var grossCost = isSwyftx ? gross : gross + fee;
        if (tx.side==='buy') {
          acq.push({ id:id, asset:ticker, date:tx.date, qty:qty, grossCost:grossCost });
        } else if (tx.side==='sell') {
          // For sells: net proceeds = gross - fee for Swyftx, gross - fee for CommSec too
          disp.push({ id:id, asset:ticker, date:tx.date, qty:qty, grossProceeds:gross, fee:fee });
        }
      });
    });
  });

  // FIFO match
  var pool = {};
  acq.forEach(function(a) {
    if (!pool[a.asset]) pool[a.asset] = [];
    pool[a.asset].push({ date:new Date(a.date+'T00:00:00'), dateStr:a.date,
                         totalQty:a.qty, remaining:a.qty, grossCost:a.grossCost });
  });
  disp.filter(function(d){ return inFY(d.date); }).forEach(function(d) {
    var k = d.asset;
    if (!pool[k]) return;
    var parcels = pool[k].filter(function(p){ return p.remaining>0.000001; });
    parcels.sort(function(a,b){ return a.date-b.date; });
    var qty = d.qty, origQty = qty;
    var saleDate = new Date(d.date+'T00:00:00');
    var netProc = d.grossProceeds - d.fee;
    parcels.forEach(function(p) {
      if (qty <= 0.000001) return;
      var used  = Math.min(qty, p.remaining);
      var costB = p.grossCost * (used/p.totalQty);
      var procS = netProc * (used/origQty);
      var gross = procS - costB;
      var days  = Math.floor((saleDate - p.date)/86400000);
      var disc  = days > 365 && gross > 0;
      var discA = disc ? gross/3 : 0;
      var netG  = gross - discA;
      var tax   = netG > 0 ? netG*0.15 : 0;
      cgtEvents.push({
        asset:k, saleDate:d.date, acquireDate:p.dateStr,
        qtySold:used, proceeds:procS, costBase:costB,
        grossGain:gross, discountApplied:disc, discountAmt:discA,
        discountedGain:netG, taxPayable:tax, holdingDays:days
      });
      cgtTotals.gross    += gross;
      cgtTotals.discount += discA;
      cgtTotals.net      += netG;
      cgtTotals.tax      += tax;
      p.remaining -= used;
      qty -= used;
    });
  });

  // ── 6. BUILD HTML ────────────────────────────────────────────────────────
  var generatedDate = new Date().toLocaleDateString('en-AU', {
    day:'2-digit', month:'long', year:'numeric'
  });

  function section(title) {
    return '<div class="section-title">'+title+'</div>';
  }
  function summaryCard(label, value, sub, colour) {
    return '<div class="summary-card">' +
      '<div class="card-label">'+label+'</div>' +
      '<div class="card-value" style="color:'+(colour||'#1a1a2e')+'">'+value+'</div>' +
      (sub ? '<div class="card-sub">'+sub+'</div>' : '') +
    '</div>';
  }

  // Holdings table rows
  var holdingRowsHTML = holdingRows.map(function(h) {
    var glCol = h.gl > 0 ? '#2d7d46' : h.gl < 0 ? '#b91c1c' : '#666';
    return '<tr>' +
      '<td><strong>'+h.ticker+'</strong></td>' +
      '<td>'+h.name+'</td>' +
      '<td>'+h.type+'</td>' +
      '<td class="r">'+pf(h.qty).toLocaleString('en-AU',{maximumFractionDigits:6})+'</td>' +
      '<td class="r">'+(h.price!==null ? aud(h.price) : '—')+'</td>' +
      '<td class="r">'+(h.value!==null ? aud(h.value) : '—')+'</td>' +
      '<td class="r">'+aud(h.cost)+'</td>' +
      '<td class="r" style="color:'+glCol+';font-weight:600;">'+(h.gl!==null ? aud(h.gl,true) : '—')+'</td>' +
    '</tr>';
  }).join('');

  // Cash rows
  var cashRowsHTML = state.cash.map(function(a) {
    return '<tr><td>'+a.name+'</td><td class="r">'+aud(a.balance||0)+'</td></tr>';
  }).join('');

  // Trades table
  var tradesHTML = fyTrades.length === 0
    ? '<tr><td colspan="7" style="text-align:center;color:#999;padding:16px;">No trades in this financial year</td></tr>'
    : fyTrades.map(function(t) {
        var isBuy = t.side === 'buy';
        return '<tr>' +
          '<td>'+fmtDate(t.date)+'</td>' +
          '<td><strong>'+t.ticker+'</strong></td>' +
          '<td>'+t.name+'</td>' +
          '<td style="color:'+(isBuy?'#2d7d46':'#b91c1c')+';font-weight:600;">'+(isBuy?'BUY':'SELL')+'</td>' +
          '<td class="r">'+pf(t.qty).toLocaleString('en-AU',{maximumFractionDigits:6})+'</td>' +
          '<td class="r">'+aud(t.price)+'</td>' +
          '<td class="r">'+aud(t.netTotal)+'</td>' +
          '<td class="r">'+aud(t.fee)+'</td>' +
        '</tr>';
      }).join('');

  // CGT table
  var cgtHTML = cgtEvents.length === 0
    ? '<tr><td colspan="8" style="text-align:center;color:#999;padding:16px;">No disposal events in '+fyLabel+'</td></tr>'
    : cgtEvents.map(function(e) {
        var glCol = e.grossGain >= 0 ? '#2d7d46' : '#b91c1c';
        var disc  = e.discountApplied ? 'Yes ('+e.holdingDays+'d)' : 'No';
        return '<tr>' +
          '<td><strong>'+e.asset+'</strong></td>' +
          '<td>'+fmtDate(e.saleDate)+'</td>' +
          '<td>'+fmtDate(e.acquireDate)+'</td>' +
          '<td class="r">'+aud(e.proceeds)+'</td>' +
          '<td class="r">'+aud(e.costBase)+'</td>' +
          '<td class="r" style="color:'+glCol+';font-weight:600;">'+aud(e.grossGain,true)+'</td>' +
          '<td class="r">'+disc+'</td>' +
          '<td class="r" style="font-weight:600;">'+aud(e.taxPayable)+'</td>' +
        '</tr>';
      }).join('');

  // Fees breakdown
  // Fees breakdown — manual fees + trade brokerage
  var brokerageFees = [];
  ['us','asx','cry','met'].forEach(function(type) {
    state[type].forEach(function(h) {
      (h.txns||[]).forEach(function(tx) {
        if (!inFY(tx.date)) return;
        if (pf(tx.fee) <= 0) return;
        brokerageFees.push({
          date: tx.date,
          desc: 'Brokerage — ' + (tx.side==='buy'?'Buy':'Sell') + ' ' + h.ticker,
          cat:  'Transaction Fee',
          amount: pf(tx.fee)
        });
      });
    });
  });

  var allFees = fyFees.map(function(e) {
    return { date:e.date, desc:e.desc, cat:e.cat, amount:pf(e.amount) };
  }).concat(brokerageFees);
  allFees.sort(function(a,b){ return a.date.localeCompare(b.date); });

  var totalAllFees = allFees.reduce(function(s,e){ return s+e.amount; }, 0);
  var totalBrokerage = brokerageFees.reduce(function(s,e){ return s+e.amount; }, 0);

  var feesHTML = allFees.length === 0
    ? '<tr><td colspan="4" style="text-align:center;color:#999;padding:12px;">No fees recorded</td></tr>'
    : allFees.map(function(e) {
        return '<tr>'+
          '<td>'+fmtDate(e.date)+'</td>'+
          '<td>'+e.desc+'</td>'+
          '<td>'+e.cat+'</td>'+
          '<td class="r">'+aud(e.amount)+'</td>'+
        '</tr>';
      }).join('');

  // Income breakdown
  var incomeHTML = fyIncome.length === 0
    ? '<tr><td colspan="5" style="text-align:center;color:#999;padding:12px;">No income recorded</td></tr>'
    : fyIncome.map(function(e) {
        return '<tr>'+
          '<td>'+fmtDate(e.date)+'</td>'+
          '<td>'+e.source+'</td>'+
          '<td>'+e.type+'</td>'+
          '<td class="r">'+aud(e.amount)+'</td>'+
          '<td class="r">'+(pf(e.franking)>0 ? aud(e.franking) : '—')+'</td>'+
        '</tr>';
      }).join('');

  // Contributions
  var contribHTML = fyContribs.length === 0
    ? '<tr><td colspan="4" style="text-align:center;color:#999;padding:12px;">No contributions recorded</td></tr>'
    : fyContribs.map(function(e) {
        return '<tr>'+
          '<td>'+fmtDate(e.date)+'</td>'+
          '<td>'+e.member+'</td>'+
          '<td>'+e.type+'</td>'+
          '<td class="r">'+aud(e.amount)+'</td>'+
        '</tr>';
      }).join('');

  var html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${portfolioName} — EOFY Report ${fyLabel}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: Arial, Helvetica, sans-serif;
    font-size: 11px;
    color: #1a1a2e;
    background: #fff;
    padding: 20px;
    max-width: 1100px;
    margin: 0 auto;
  }

  /* ── Cover ── */
  .cover {
    text-align: center;
    padding: 40px 0 32px;
    border-bottom: 3px solid #1a1a2e;
    margin-bottom: 28px;
  }
  .cover-logo {
    width: 48px; height: 48px;
    background: linear-gradient(135deg,#5757e8,#5754fd);
    border-radius: 14px;
    display: inline-flex; align-items: center; justify-content: center;
    margin-bottom: 16px;
  }
  .cover-logo svg { width: 24px; height: 24px; }
  .cover h1 { font-size: 26px; font-weight: 800; letter-spacing: -0.04em; margin-bottom: 4px; }
  .cover h2 { font-size: 16px; font-weight: 400; color: #555; margin-bottom: 16px; }
  .cover-meta { font-size: 11px; color: #888; }

  /* ── Section titles ── */
  .section-title {
    font-size: 10px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.1em; color: #5757e8;
    border-bottom: 1px solid #e5e7eb;
    padding-bottom: 5px; margin: 28px 0 14px;
  }

  /* ── Summary cards ── */
  .cards { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 8px; }
  .summary-card {
    flex: 1; min-width: 140px;
    border: 1px solid #e5e7eb; border-radius: 10px;
    padding: 14px 16px;
  }
  .card-label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.07em; color: #888; margin-bottom: 5px; }
  .card-value { font-size: 20px; font-weight: 700; letter-spacing: -0.03em; }
  .card-sub { font-size: 10px; color: #888; margin-top: 3px; }

  /* ── Tables ── */
  table { width: 100%; border-collapse: collapse; margin-bottom: 6px; }
  thead th {
    font-size: 9px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.06em; color: #666;
    border-bottom: 1px solid #e5e7eb;
    padding: 6px 8px; text-align: left; background: #f9fafb;
  }
  thead th.r { text-align: right; }
  tbody td { padding: 7px 8px; border-bottom: 1px solid #f3f4f6; font-size: 11px; vertical-align: middle; }
  tbody tr:last-child td { border-bottom: none; }
  tbody tr:hover td { background: #f9fafb; }
  td.r { text-align: right; }
  tfoot td { padding: 8px; font-weight: 700; font-size: 11px; border-top: 2px solid #1a1a2e; }
  tfoot td.r { text-align: right; }

  /* ── Disclaimer ── */
  .disclaimer {
    margin-top: 32px; padding: 14px 16px;
    background: #fefce8; border: 1px solid #fde68a;
    border-radius: 8px; font-size: 10px; color: #92400e; line-height: 1.6;
  }

  /* ── Footer ── */
  .footer {
    margin-top: 20px; padding-top: 12px;
    border-top: 1px solid #e5e7eb;
    font-size: 10px; color: #aaa; text-align: center;
  }

  /* ── Page breaks ── */
  .page-break { page-break-before: always; }

  @media print {
    body { padding: 10px; }
    .no-print { display: none; }
    .page-break { page-break-before: always; }
    a { color: inherit; text-decoration: none; }
  }
</style>
</head>
<body>

<!-- ══ PRINT BUTTON (screen only) ══ -->
<div class="no-print" style="text-align:right;margin-bottom:16px;">
  <button onclick="window.print()" style="background:#5757e8;color:#fff;border:none;padding:10px 24px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;font-family:Arial,sans-serif;">
    🖨 Print / Save as PDF
  </button>
  <span style="font-size:11px;color:#888;margin-left:12px;">Use your browser's Print dialog → Save as PDF</span>
</div>

<!-- ══ COVER ══ -->
<div class="cover">
  <div class="cover-logo">
    <svg viewBox="0 0 16 16" fill="none">
      <polyline points="2,11 6,7 9,9 14,4" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  </div>
  <h1>${portfolioName}</h1>
  <h2>End of Financial Year Report &mdash; ${fyLabel}</h2>
  <h2 style="font-size:13px;color:#888;margin-bottom:0;">1 July ${fyStartYear} &ndash; 30 June ${fyEndYear}</h2>
  <div class="cover-meta" style="margin-top:12px;">Generated ${generatedDate} &nbsp;·&nbsp; SMSF Accumulation Phase</div>
</div>

<!-- ══ 1. PORTFOLIO SNAPSHOT ══ -->
${section('1. Portfolio Snapshot at Report Date')}
<div class="cards">
  ${summaryCard('Total Portfolio Value', aud(totalVal), 'Investments + cash', '#1a1a2e')}
  ${summaryCard('Total Investments', aud(totalInv), 'Excl. cash', '#5757e8')}
  ${summaryCard('Total Cash', aud(cashVal), 'All accounts', '#2d7d46')}
  ${summaryCard('Unrealised Gain/Loss', aud(totalGL, true), 'All holdings vs cost', totalGL>=0?'#2d7d46':'#b91c1c')}
</div>
<div class="cards">
  ${summaryCard('US Stocks', aud(usVal), 'AUD value', '#5754fd')}
  ${summaryCard('ASX Stocks', aud(asxVal), 'AUD value', '#2d7d46')}
  ${summaryCard('Crypto', aud(cryVal), 'AUD value', '#b45309')}
  ${summaryCard('Metals', aud(metVal), 'AUD value', '#6b7280')}
</div>

<!-- ══ 2. HOLDINGS ══ -->
${section('2. Holdings at Report Date')}
<table>
  <thead><tr>
    <th>Ticker</th><th>Name</th><th>Type</th>
    <th class="r">Qty</th><th class="r">Price (AUD)</th>
    <th class="r">Value (AUD)</th><th class="r">Cost Base</th>
    <th class="r">Unrealised G/L</th>
  </tr></thead>
  <tbody>${holdingRowsHTML}</tbody>
  <tfoot><tr>
    <td colspan="5">Total</td>
    <td class="r">${aud(totalInv)}</td>
    <td class="r">${aud(totalCost)}</td>
    <td class="r" style="color:${totalGL>=0?'#2d7d46':'#b91c1c'}">${aud(totalGL,true)}</td>
  </tr></tfoot>
</table>

<!-- ── Cash accounts ── -->
<table style="margin-top:10px;">
  <thead><tr><th>Cash Account</th><th class="r">Balance (AUD)</th></tr></thead>
  <tbody>${cashRowsHTML}</tbody>
  <tfoot><tr><td>Total Cash</td><td class="r">${aud(cashVal)}</td></tr></tfoot>
</table>

<!-- ══ 3. FY SUMMARY ══ -->
<div class="page-break"></div>
${section('3. Financial Year Summary — ' + fyLabel)}
<div class="cards">
  ${summaryCard('Total Contributions', aud(totalContribs), 'All types', '#1a1a2e')}
  ${summaryCard('Concessional (pre-tax)', aud(concContribs), 'Employer + salary sacrifice', '#5757e8')}
  ${summaryCard('Non-concessional', aud(nonConcContribs), 'After-tax contributions', '#6b7280')}
  ${summaryCard('Investment Income', aud(totalIncome), 'Dividends, distributions, interest', '#2d7d46')}
</div>
<div class="cards">
  ${summaryCard('Franking Credits', aud(totalFranking), 'Attached to dividends', '#b45309')}
  ${summaryCard('Total Fees & Expenses', aud(totalAllFees), 'Admin, audit, brokerage etc.', '#b91c1c')}
  ${summaryCard('Total Bought', aud(totalBought), fyBuys.length+' buy trade'+(fyBuys.length!==1?'s':''), '#5757e8')}
  ${summaryCard('Total Sold', aud(totalSold), fySells.length+' sell trade'+(fySells.length!==1?'s':''), '#b45309')}
</div>

<!-- ══ 4. CONTRIBUTIONS ══ -->
${section('4. Member Contributions — ' + fyLabel)}
<table>
  <thead><tr>
    <th>Date</th><th>Member</th><th>Type</th><th class="r">Amount (AUD)</th>
  </tr></thead>
  <tbody>${contribHTML}</tbody>
  <tfoot><tr>
    <td colspan="3">Total contributions</td>
    <td class="r">${aud(totalContribs)}</td>
  </tr></tfoot>
</table>

<!-- ══ 5. INVESTMENT INCOME ══ -->
${section('5. Investment Income — ' + fyLabel)}
<table>
  <thead><tr>
    <th>Date</th><th>Source</th><th>Type</th>
    <th class="r">Amount (AUD)</th><th class="r">Franking Credits</th>
  </tr></thead>
  <tbody>${incomeHTML}</tbody>
  <tfoot><tr>
    <td colspan="3">Total income</td>
    <td class="r">${aud(totalIncome)}</td>
    <td class="r">${aud(totalFranking)}</td>
  </tr></tfoot>
</table>

<!-- ══ 6. FEES & EXPENSES ══ -->
${section('6. Fees & Expenses — ' + fyLabel)}
<table>
  <thead><tr>
    <th>Date</th><th>Description</th><th>Category</th><th class="r">Amount (AUD)</th>
  </tr></thead>
  <tbody>${feesHTML}</tbody>
  <tfoot>
    ${totalBrokerage > 0 ? '<tr><td colspan="3" style="color:#666;">Brokerage subtotal</td><td class="r" style="color:#666;">'+aud(totalBrokerage)+'</td></tr>' : ''}
    ${totalFees > 0 ? '<tr><td colspan="3" style="color:#666;">Other fees subtotal</td><td class="r" style="color:#666;">'+aud(totalFees)+'</td></tr>' : ''}
    <tr><td colspan="3">Total fees & expenses</td><td class="r">${aud(totalAllFees)}</td></tr>
  </tfoot>
</table>

<!-- ══ 7. TRADES ══ -->
<div class="page-break"></div>
${section('7. Trades — ' + fyLabel)}
<table>
  <thead><tr>
    <th>Date</th><th>Ticker</th><th>Name</th><th>Side</th>
    <th class="r">Qty</th><th class="r">Price (AUD)</th>
    <th class="r">Total (excl. brokerage)</th><th class="r">Fee (AUD)</th>
  </tr></thead>
  <tbody>${tradesHTML}</tbody>
  <tfoot><tr>
    <td colspan="6">Total bought / sold</td>
    <td class="r">${aud(totalBought+totalSold)}</td>
    <td class="r">${aud(fyTrades.reduce(function(s,t){return s+pf(t.fee);},0))}</td>
  </tr></tfoot>
</table>

<!-- ══ 8. CAPITAL GAINS TAX ══ -->
${section('8. Capital Gains Tax Schedule — ' + fyLabel)}
<div class="cards">
  ${summaryCard('Gross Capital Gain', aud(cgtTotals.gross,true), 'Before discount', cgtTotals.gross>=0?'#2d7d46':'#b91c1c')}
  ${summaryCard('CGT Discount (1/3)', aud(cgtTotals.discount), 'Assets held >12 months', '#5757e8')}
  ${summaryCard('Net Taxable Gain', aud(cgtTotals.net,true), 'After discount', cgtTotals.net>=0?'#2d7d46':'#b91c1c')}
  ${summaryCard('Estimated Tax @ 15%', aud(cgtTotals.tax), 'Accumulation phase rate', '#b91c1c')}
</div>
<table>
  <thead><tr>
    <th>Asset</th><th>Sale Date</th><th>Acquired</th>
    <th class="r">Net Proceeds</th><th class="r">Cost Base</th>
    <th class="r">Gross Gain/Loss</th><th class="r">12m Discount</th>
    <th class="r">Est. Tax</th>
  </tr></thead>
  <tbody>${cgtHTML}</tbody>
  ${cgtEvents.length > 0 ? `<tfoot><tr>
    <td colspan="3">Totals</td>
    <td class="r">${aud(cgtEvents.reduce(function(s,e){return s+e.proceeds;},0))}</td>
    <td class="r">${aud(cgtEvents.reduce(function(s,e){return s+e.costBase;},0))}</td>
    <td class="r" style="color:${cgtTotals.gross>=0?'#2d7d46':'#b91c1c'}">${aud(cgtTotals.gross,true)}</td>
    <td class="r">${aud(cgtTotals.discount)}</td>
    <td class="r">${aud(cgtTotals.tax)}</td>
  </tr></tfoot>` : ''}
</table>
<p style="font-size:10px;color:#888;margin-top:8px;">
  Parcel matching method: FIFO. CGT discount (s.115 ITAA 1997) applied to assets held &gt;365 days.
  Cost base includes brokerage fees (s.110-25 ITAA 1997). Net proceeds = gross proceeds minus brokerage.
</p>

<!-- ══ DISCLAIMER ══ -->
<div class="disclaimer">
  <strong>⚠ Important — For Accountant Use Only</strong><br>
  This report is generated from records entered into the SMSF Portfolio Tracker and is provided as a
  working document to assist with preparation of the SMSF Annual Return. All figures should be verified
  against primary source documents including broker contract notes, exchange statements, bank statements
  and Xano records. CGT calculations are estimates only — your registered SMSF auditor and tax agent
  must review and confirm all figures before lodgement. This document does not constitute financial,
  legal or tax advice.
</div>

<div class="footer">
  ${portfolioName} &nbsp;·&nbsp; ${fyLabel} &nbsp;·&nbsp; Generated ${generatedDate} &nbsp;·&nbsp;
  SMSF Portfolio Tracker &nbsp;·&nbsp; Verify all figures with your SMSF accountant before lodgement
</div>

</body>
</html>`;

  // ── Open in new window ────────────────────────────────────────────────────
  var win = window.open('', '_blank');
  if (!win) {
    alert('Pop-up blocked. Please allow pop-ups for this site and try again.');
    return;
  }
  win.document.write(html);
  win.document.close();
  win.focus();
}
