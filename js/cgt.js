/* ═══════════════════════════════════════════════════════════════════════════
   cgt.js  —  SMSF Capital Gains Tax Engine
   ───────────────────────────────────────────────────────────────────────────
   Australian SMSF / Accumulation Phase rules implemented:
   • CGT rate        : 15% (accumulation phase)
   • 12-month discount: one-third reduction → effective 10%  (s.115 ITAA97)
   • Parcel matching : FIFO (default) | LIFO | Minimise CGT  (user-selectable)
   • Cost base       : gross AUD paid including brokerage fee
   • Proceeds        : gross AUD received minus brokerage fee (net proceeds)
   • Swap events     : treated as disposal + reacquisition  (TR 2014/1)
   ═══════════════════════════════════════════════════════════════════════════ */

'use strict';

// ── Constants ────────────────────────────────────────────────────────────────
const CGT_TAX_RATE          = 0.15;   // 15% accumulation phase rate
const CGT_DISCOUNT_FRACTION = 1/3;    // one-third discount for assets held >12m
const CGT_DISCOUNT_DAYS     = 365;    // holding period threshold

// ── CGT Settings (persisted to localStorage) ─────────────────────────────────
const CGT_SETTINGS_KEY = 'smsf_cgt_settings';

function cgtLoadSettings() {
  try {
    const raw = localStorage.getItem(CGT_SETTINGS_KEY);
    if (raw) return JSON.parse(raw);
  } catch(e) {}
  return { parcelMethod: 'fifo' };   // default: FIFO
}

function cgtSaveSettings(settings) {
  try { localStorage.setItem(CGT_SETTINGS_KEY, JSON.stringify(settings)); } catch(e) {}
}

function cgtGetParcelMethod() {
  return cgtLoadSettings().parcelMethod || 'fifo';
}

function cgtSetParcelMethod(method) {
  const s = cgtLoadSettings();
  s.parcelMethod = method;
  cgtSaveSettings(s);
}

// ── Date helpers ─────────────────────────────────────────────────────────────
function parseDateStr(d) {
  // Accepts ISO (YYYY-MM-DD) or DD/MM/YYYY
  if (!d) return null;
  if (d.includes('/')) {
    const [day, mon, yr] = d.split('/');
    return new Date(Number(yr), Number(mon)-1, Number(day));
  }
  return new Date(d);
}

function daysBetween(dateA, dateB) {
  const msPerDay = 86400000;
  return Math.floor((dateB - dateA) / msPerDay);
}

function dateToISO(d) {
  if (!d) return '';
  if (typeof d === 'string') return d;
  const dd = String(d.getDate()).padStart(2,'0');
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const yyyy = d.getFullYear();
  return `${yyyy}-${mm}-${dd}`;
}

// ── Financial year helpers ────────────────────────────────────────────────────
function getFY(dateStr) {
  // Returns string like "FY2024-25"
  const d = parseDateStr(dateStr);
  if (!d) return 'Unknown';
  const yr = d.getFullYear();
  const mon = d.getMonth() + 1; // 1-based
  if (mon >= 7) return `FY${yr}-${String(yr+1).slice(2)}`;
  return `FY${yr-1}-${String(yr).slice(2)}`;
}

function getFYBounds(fyLabel) {
  // "FY2024-25" → { start: Date(2024-07-01), end: Date(2025-06-30) }
  const match = fyLabel.match(/FY(\d{4})-(\d{2})/);
  if (!match) return null;
  const startYr = Number(match[1]);
  return {
    start: new Date(startYr, 6, 1),    // 1 Jul
    end:   new Date(startYr+1, 5, 30)  // 30 Jun
  };
}

// ── Core CGT calculation ──────────────────────────────────────────────────────
/*
  calculateCGT(disposals, acquisitions, method)
  ─────────────────────────────────────────────
  disposals    : array of { id, asset, date, qty, grossProceeds, fee, type }
                 net proceeds = grossProceeds - fee
  acquisitions : array of { id, asset, date, qty, grossCost, fee, type }
                 cost base per unit = grossCost / qty   (fee included in grossCost)
  method       : 'fifo' | 'lifo' | 'mincgt'

  Returns array of CGT events:
  {
    disposalId, asset, saleDate, acquireDate,
    qtySold, proceeds, costBase,
    grossGain, discountApplied, discountedGain, taxPayable,
    holdingDays, parcelId
  }
*/
function calculateCGT(disposals, acquisitions, method) {
  method = method || cgtGetParcelMethod();
  const results = [];

  // Group acquisitions by asset, sort per method
  const parcelsByAsset = {};
  for (const acq of acquisitions) {
    const key = (acq.asset || '').toUpperCase();
    if (!parcelsByAsset[key]) parcelsByAsset[key] = [];
    parcelsByAsset[key].push({
      id:        acq.id,
      date:      parseDateStr(acq.date),
      dateStr:   acq.date,
      totalQty:  Number(acq.qty) || 0,
      remaining: Number(acq.qty) || 0,
      grossCost: Number(acq.grossCost) || 0,   // total cost including fee
    });
  }

  // Sort parcels according to selected method
  // For mincgt we sort per-disposal after we know the sale date
  const sortParcels = (parcels, saleDate, method) => {
    const p = [...parcels];
    if (method === 'fifo') {
      p.sort((a,b) => a.date - b.date);
    } else if (method === 'lifo') {
      p.sort((a,b) => b.date - a.date);
    } else if (method === 'mincgt') {
      // Prefer parcels that: (1) produce a loss, (2) qualify for discount, (3) smallest gain
      p.sort((a,b) => {
        const saleDateObj = parseDateStr(saleDate) || new Date();
        const daysA = daysBetween(a.date, saleDateObj);
        const daysB = daysBetween(b.date, saleDateObj);
        const discA = daysA > CGT_DISCOUNT_DAYS ? 1 : 0;
        const discB = daysB > CGT_DISCOUNT_DAYS ? 1 : 0;
        // Prefer discount-eligible parcels first
        if (discA !== discB) return discB - discA;
        // Among same discount status, sort oldest first (maximises holding period)
        return a.date - b.date;
      });
    }
    return p;
  };

  // Process each disposal against the parcel pool
  for (const disposal of disposals) {
    const asset = (disposal.asset || '').toUpperCase();
    const parcels = parcelsByAsset[asset];
    if (!parcels || parcels.length === 0) continue;

    let qtyToSell     = Number(disposal.qty) || 0;
    const saleDate    = parseDateStr(disposal.date);
    const grossProc   = Number(disposal.grossProceeds) || 0;
    const saleFee     = Number(disposal.fee) || 0;
    const netProceeds = grossProc - saleFee;
    // Allocate proceeds proportionally across matched parcels (we match by qty)
    const totalQtySold = qtyToSell;  // save original for pro-rata

    const sortedParcels = sortParcels(parcels.filter(p => p.remaining > 0), disposal.date, method);

    for (const parcel of sortedParcels) {
      if (qtyToSell <= 0) break;

      const qtyFromParcel  = Math.min(qtyToSell, parcel.remaining);
      const fraction       = qtyFromParcel / parcel.totalQty;
      const costBase       = parcel.grossCost * (qtyFromParcel / parcel.totalQty);
      // Pro-rata proceeds for this parcel slice
      const proceedsSlice  = netProceeds * (qtyFromParcel / totalQtySold);

      const grossGain      = proceedsSlice - costBase;
      const holdingDays    = saleDate ? daysBetween(parcel.date, saleDate) : 0;
      const discountElig   = holdingDays > CGT_DISCOUNT_DAYS;
      const discountAmt    = discountElig && grossGain > 0 ? grossGain * CGT_DISCOUNT_FRACTION : 0;
      const discountedGain = grossGain - discountAmt;
      const taxPayable     = discountedGain > 0 ? discountedGain * CGT_TAX_RATE : 0;

      results.push({
        disposalId:       disposal.id,
        parcelId:         parcel.id,
        asset:            asset,
        saleDate:         disposal.date,
        acquireDate:      parcel.dateStr,
        qtySold:          qtyFromParcel,
        proceeds:         proceedsSlice,
        costBase:         costBase,
        grossGain:        grossGain,
        discountApplied:  discountElig && grossGain > 0,
        discountAmt:      discountAmt,
        discountedGain:   discountedGain,
        taxPayable:       taxPayable,
        holdingDays:      holdingDays,
        type:             disposal.type || 'sale',
        fy:               getFY(disposal.date)
      });

      // Reduce remaining parcel qty
      parcel.remaining -= qtyFromParcel;
      qtyToSell -= qtyFromParcel;
    }
  }

  return results;
}

// ── Unrealised gains ──────────────────────────────────────────────────────────
/*
  calculateUnrealised(openPositions, currentPrices)
  openPositions  : array of { asset, qty, grossCost, acquireDate }  (open parcels)
  currentPrices  : { BTC: 95000, SOL: 127.5, ... }
  Returns array of { asset, qty, costBase, currentValue, unrealisedGain, holdingDays,
                     discountElig, estimatedTax }
*/
function calculateUnrealised(openPositions, currentPrices) {
  // Aggregate by asset
  const byAsset = {};
  for (const pos of openPositions) {
    const key = (pos.asset || '').toUpperCase();
    if (!byAsset[key]) byAsset[key] = { asset: key, qty: 0, grossCost: 0, earliestDate: null };
    byAsset[key].qty       += Number(pos.qty) || 0;
    byAsset[key].grossCost += Number(pos.grossCost) || 0;
    const d = parseDateStr(pos.acquireDate);
    if (d && (!byAsset[key].earliestDate || d < byAsset[key].earliestDate)) {
      byAsset[key].earliestDate = d;
    }
  }

  const today = new Date();
  const results = [];
  for (const key of Object.keys(byAsset)) {
    const pos   = byAsset[key];
    const price = currentPrices ? (currentPrices[key] || currentPrices[key.toLowerCase()] || 0) : 0;
    const currentValue   = pos.qty * price;
    const unrealisedGain = currentValue - pos.grossCost;
    const holdingDays    = pos.earliestDate ? daysBetween(pos.earliestDate, today) : 0;
    const discountElig   = holdingDays > CGT_DISCOUNT_DAYS;
    const discountedGain = discountElig && unrealisedGain > 0
      ? unrealisedGain * (1 - CGT_DISCOUNT_FRACTION)
      : unrealisedGain;
    const estimatedTax   = discountedGain > 0 ? discountedGain * CGT_TAX_RATE : 0;

    results.push({
      asset:          key,
      qty:            pos.qty,
      costBase:       pos.grossCost,
      currentValue:   currentValue,
      unrealisedGain: unrealisedGain,
      holdingDays:    holdingDays,
      discountElig:   discountElig,
      estimatedTax:   estimatedTax,
      priceAvailable: price > 0
    });
  }

  return results.sort((a,b) => b.unrealisedGain - a.unrealisedGain);
}

// ── Summarise CGT events by FY ────────────────────────────────────────────────
function summariseCGTByFY(cgtEvents) {
  const fyMap = {};
  for (const ev of cgtEvents) {
    if (!fyMap[ev.fy]) {
      fyMap[ev.fy] = {
        fy: ev.fy,
        totalGrossGain: 0,
        totalDiscount:  0,
        totalDiscountedGain: 0,
        totalTaxPayable: 0,
        events: []
      };
    }
    const s = fyMap[ev.fy];
    s.totalGrossGain        += ev.grossGain;
    s.totalDiscount         += ev.discountAmt;
    s.totalDiscountedGain   += ev.discountedGain;
    s.totalTaxPayable       += ev.taxPayable;
    s.events.push(ev);
  }
  return Object.values(fyMap).sort((a,b) => a.fy.localeCompare(b.fy));
}

// ── Format helpers (used by the CGT UI) ──────────────────────────────────────
function cgtFmt(n) {
  if (n == null || isNaN(n)) return '—';
  const abs = Math.abs(n);
  const str = abs.toLocaleString('en-AU', { minimumFractionDigits:2, maximumFractionDigits:2 });
  return (n < 0 ? '−$' : '$') + str;
}

function cgtFmtColour(n) {
  if (n == null || isNaN(n)) return { text:'—', cls:'' };
  const c = n > 0 ? 'cgt-pos' : n < 0 ? 'cgt-neg' : '';
  return { text: cgtFmt(n), cls: c };
}

// ── Build CGT summary HTML panel ─────────────────────────────────────────────
/*
  renderCGTSummary(cgtEvents, unrealisedRows, fyFilter, container)
  Writes the full CGT summary section into the given DOM container element.
*/
function renderCGTSummary(cgtEvents, unrealisedRows, fyFilter, container) {
  if (!container) return;

  const method = cgtGetParcelMethod();
  const fySummaries = summariseCGTByFY(cgtEvents);
  const allFYs = fySummaries.map(s => s.fy);

  // Filter events to selected FY
  const filteredEvents = fyFilter
    ? cgtEvents.filter(e => e.fy === fyFilter)
    : cgtEvents;

  // Totals for selected period
  const totGross      = filteredEvents.reduce((s,e) => s + e.grossGain, 0);
  const totDiscount   = filteredEvents.reduce((s,e) => s + e.discountAmt, 0);
  const totDiscounted = filteredEvents.reduce((s,e) => s + e.discountedGain, 0);
  const totTax        = filteredEvents.reduce((s,e) => s + e.taxPayable, 0);

  // Build FY options
  const fyOpts = ['<option value="">All financial years</option>',
    ...allFYs.map(fy => `<option value="${fy}" ${fy===fyFilter?'selected':''}>${fy}</option>`)
  ].join('');

  // Build realised events table rows
  const eventRows = filteredEvents.length === 0
    ? `<tr><td colspan="9" style="text-align:center;color:var(--text4);padding:20px;">No disposal events in this period.</td></tr>`
    : filteredEvents.map(ev => {
        const gn = cgtFmtColour(ev.grossGain);
        const dg = cgtFmtColour(ev.discountedGain);
        const tx = cgtFmtColour(ev.taxPayable);
        const discBadge = ev.discountApplied
          ? `<span class="cgt-badge cgt-badge-disc">✓ −⅓</span>`
          : `<span class="cgt-badge cgt-badge-none">—</span>`;
        return `<tr class="cgt-event-row">
          <td><span class="badge b-gray" style="font-size:10px;">${ev.asset}</span></td>
          <td style="white-space:nowrap;">${ev.saleDate}</td>
          <td style="white-space:nowrap;color:var(--text3);font-size:11px;">${ev.acquireDate}</td>
          <td class="r" style="font-size:11px;">${ev.qtySold.toLocaleString('en-AU',{maximumFractionDigits:6})}</td>
          <td class="r">${cgtFmt(ev.proceeds)}</td>
          <td class="r">${cgtFmt(ev.costBase)}</td>
          <td class="r ${gn.cls}">${gn.text}</td>
          <td class="r" style="text-align:center;">${discBadge}</td>
          <td class="r ${tx.cls}" style="font-weight:600;">${tx.text}</td>
        </tr>`;
      }).join('');

  // Unrealised table rows
  const unrRows = (!unrealisedRows || unrealisedRows.length === 0)
    ? `<tr><td colspan="7" style="text-align:center;color:var(--text4);padding:20px;">No open positions with price data available.</td></tr>`
    : unrealisedRows.map(u => {
        const gn = cgtFmtColour(u.unrealisedGain);
        const tx = cgtFmtColour(u.estimatedTax);
        const discBadge = u.discountElig
          ? `<span class="cgt-badge cgt-badge-disc">✓ −⅓</span>`
          : `<span class="cgt-badge cgt-badge-none">${u.holdingDays}d</span>`;
        const noPrice = !u.priceAvailable
          ? `<span style="font-size:10px;color:var(--text4);margin-left:4px;">(no price)</span>` : '';
        return `<tr>
          <td><span class="badge b-gray" style="font-size:10px;">${u.asset}</span></td>
          <td class="r" style="font-size:11px;">${u.qty.toLocaleString('en-AU',{maximumFractionDigits:6})}</td>
          <td class="r">${cgtFmt(u.costBase)}</td>
          <td class="r">${u.priceAvailable ? cgtFmt(u.currentValue) : '—'}${noPrice}</td>
          <td class="r ${gn.cls}">${u.priceAvailable ? gn.text : '—'}</td>
          <td class="r" style="text-align:center;">${discBadge}</td>
          <td class="r ${tx.cls}">${u.priceAvailable ? tx.text : '—'}</td>
        </tr>`;
      }).join('');

  const methLabel = { fifo:'FIFO', lifo:'LIFO', mincgt:'Minimise CGT' };

  container.innerHTML = `
  <!-- CGT Settings bar -->
  <div class="cgt-settings-bar">
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-linecap="round"><circle cx="8" cy="8" r="6"/><path d="M8 5v3l2 1"/></svg>
      <span style="font-size:11px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:0.06em;">SMSF CGT — Accumulation phase · 15% tax rate · 12-month discount eligible</span>
    </div>
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
      <label style="font-size:11px;font-weight:600;color:var(--text3);white-space:nowrap;">Parcel method:</label>
      <select id="cgtMethodSelect" onchange="cgtChangeMethod(this.value)"
        style="font-size:12px;padding:4px 10px;border:1px solid var(--border4);border-radius:99px;background:var(--surface2);color:var(--text);font-family:Arial,Helvetica,sans-serif;cursor:pointer;">
        <option value="fifo"   ${method==='fifo'   ?'selected':''}>FIFO — First in, first out</option>
        <option value="lifo"   ${method==='lifo'   ?'selected':''}>LIFO — Last in, first out</option>
        <option value="mincgt" ${method==='mincgt' ?'selected':''}>Minimise CGT — prefer discounted parcels</option>
      </select>
      <select id="cgtFYSelect" onchange="cgtChangeFY(this.value)"
        style="font-size:12px;padding:4px 10px;border:1px solid var(--border4);border-radius:99px;background:var(--surface2);color:var(--text);font-family:Arial,Helvetica,sans-serif;cursor:pointer;">
        ${fyOpts}
      </select>
    </div>
  </div>

  <!-- Summary cards -->
  <div class="cgt-summary-cards">
    <div class="cgt-card">
      <div class="cgt-card-label">Gross capital gain</div>
      <div class="cgt-card-val ${totGross>=0?'cgt-pos':'cgt-neg'}">${cgtFmt(totGross)}</div>
      <div class="cgt-card-sub">Before CGT discount</div>
    </div>
    <div class="cgt-card">
      <div class="cgt-card-label">CGT discount applied</div>
      <div class="cgt-card-val" style="color:var(--accent);">${cgtFmt(totDiscount)}</div>
      <div class="cgt-card-sub">⅓ of gains held &gt;12 months</div>
    </div>
    <div class="cgt-card">
      <div class="cgt-card-label">Net taxable gain</div>
      <div class="cgt-card-val ${totDiscounted>=0?'cgt-pos':'cgt-neg'}">${cgtFmt(totDiscounted)}</div>
      <div class="cgt-card-sub">After discount</div>
    </div>
    <div class="cgt-card cgt-card-highlight">
      <div class="cgt-card-label">Estimated tax @ 15%</div>
      <div class="cgt-card-val cgt-neg" style="font-size:22px;">${cgtFmt(totTax)}</div>
      <div class="cgt-card-sub">Accumulation phase</div>
    </div>
  </div>

  <!-- Realised gains table -->
  <div class="cgt-section-head">
    <div class="cgt-section-title">
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2 12l4-4 3 3 5-7"/></svg>
      Realised capital gains / losses
    </div>
    <span style="font-size:11px;color:var(--text4);">Parcel method: <strong style="color:var(--text2);">${methLabel[method]}</strong></span>
  </div>
  <div class="tbl-wrap"><table class="cgt-table">
    <thead><tr>
      <th>Asset</th>
      <th>Sale date</th>
      <th class="mob-hide">Acquired</th>
      <th class="r mob-hide">Qty</th>
      <th class="r">Net proceeds</th>
      <th class="r mob-hide">Cost base</th>
      <th class="r">Gross gain</th>
      <th class="r" style="text-align:center;">Discount</th>
      <th class="r">Est. tax</th>
    </tr></thead>
    <tbody>${eventRows}</tbody>
    ${filteredEvents.length > 0 ? `<tfoot><tr class="cgt-totals-row">
      <td colspan="4" class="mob-hide" style="font-weight:600;font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:0.06em;">Totals</td>
      <td colspan="4" class="mob-show" style="font-weight:600;font-size:11px;color:var(--text3);">Totals</td>
      <td class="r">${cgtFmt(filteredEvents.reduce((s,e)=>s+e.proceeds,0))}</td>
      <td class="r mob-hide">${cgtFmt(filteredEvents.reduce((s,e)=>s+e.costBase,0))}</td>
      <td class="r ${totGross>=0?'cgt-pos':'cgt-neg'}" style="font-weight:700;">${cgtFmt(totGross)}</td>
      <td></td>
      <td class="r cgt-neg" style="font-weight:700;">${cgtFmt(totTax)}</td>
    </tr></tfoot>` : ''}
  </table></div>

  <!-- Unrealised gains table -->
  <div class="cgt-section-head" style="margin-top:24px;">
    <div class="cgt-section-title">
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="8" cy="8" r="6"/><path d="M8 5v3.5"/><circle cx="8" cy="11" r="0.5" fill="currentColor"/></svg>
      Unrealised gains / losses (open positions)
    </div>
    <span style="font-size:11px;color:var(--text4);">Estimated if sold today</span>
  </div>
  <div class="tbl-wrap"><table class="cgt-table">
    <thead><tr>
      <th>Asset</th>
      <th class="r mob-hide">Qty held</th>
      <th class="r">Cost base</th>
      <th class="r">Current value</th>
      <th class="r">Unrealised gain</th>
      <th class="r" style="text-align:center;">Discount</th>
      <th class="r">Est. tax if sold</th>
    </tr></thead>
    <tbody>${unrRows}</tbody>
  </table></div>
  <div style="padding:10px 0 4px;font-size:11px;color:var(--text4);">
    ⚠ Estimates only. Verify with your SMSF accountant. Discount badge shows eligibility based on earliest parcel date.
  </div>`;
}

// ── Global handlers wired to UI selects ──────────────────────────────────────
function cgtChangeMethod(val) {
  cgtSetParcelMethod(val);
  if (typeof renderCGTTab === 'function') renderCGTTab();
}

function cgtChangeFY(val) {
  window._cgtFYFilter = val;
  if (typeof renderCGTTab === 'function') renderCGTTab();
}
