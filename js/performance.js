// ══════════════════════════════════════════════════════════════
// ── PERFORMANCE CHART — four views, granularity toggle ────────
// ══════════════════════════════════════════════════════════════
// Loads last so it can safely wrap renderHistoryChart.

var _perfView = 'portfolio';  // portfolio | costbasis | twr | mwr
var _perfGran = 'daily';      // daily | weekly | monthly
var _perfMode = 'fy';         // fy | inception
var _perfChart = null;        // Chart.js instance

// ── FY helpers ──────────────────────────────────────────────
function _perfFyStart(refDate) {
  var d   = refDate ? new Date(refDate) : new Date();
  var jul = new Date(d.getFullYear(), 6, 1);
  return d >= jul ? jul : new Date(d.getFullYear() - 1, 6, 1);
}
function _perfTodayFyStr() {
  return _perfFyStart(new Date()).toISOString().slice(0, 10);
}

// ── Downsample ───────────────────────────────────────────────
function _perfDownsample(pts, gran) {
  if (gran === 'daily') return pts;
  var buckets = {};
  pts.forEach(function(p) {
    var d   = new Date(p.d);
    var key;
    if (gran === 'weekly') {
      var day = d.getDay() || 7;
      var mon = new Date(d);
      mon.setDate(d.getDate() - day + 1);
      key = mon.toISOString().slice(0, 10);
    } else {
      key = p.d.slice(0, 7);
    }
    buckets[key] = p; // keep last point in bucket
  });
  return Object.keys(buckets).sort().map(function(k) { return buckets[k]; });
}

// ── Interpolate portfolio value at a date ────────────────────
function _perfInterp(snaps, dateStr) {
  if (!snaps.length) return 0;
  var exact = snaps.find(function(s) { return s.d === dateStr; });
  if (exact) return exact.v;
  var before = null, after = null;
  for (var i = snaps.length - 1; i >= 0; i--) {
    if (snaps[i].d <= dateStr) { before = snaps[i]; break; }
  }
  for (var j = 0; j < snaps.length; j++) {
    if (snaps[j].d >= dateStr) { after = snaps[j]; break; }
  }
  if (!before) return after ? after.v : 0;
  if (!after)  return before.v;
  if (before.d === after.d) return before.v;
  var t = (new Date(dateStr) - new Date(before.d)) /
          (new Date(after.d)  - new Date(before.d));
  return before.v + t * (after.v - before.v);
}

// ── Cost basis from recalculated holding state ───────────────
function _perfCostBasis() {
  var state = typeof S !== 'undefined' ? S : window.S;
  if (!state) return 0;
  var basis = 0;
  ['us','asx','cry','met'].forEach(function(type) {
    (state[type] || []).forEach(function(h) {
      basis += (parseFloat(h.cost) || 0) * (parseFloat(h.qty) || 0);
    });
  });
  return basis;
}

// ── Format helpers ───────────────────────────────────────────
function _perfFmtK(v) {
  if (Math.abs(v) >= 1e6) return (v/1e6).toFixed(2)+'M';
  if (Math.abs(v) >= 1e3) return (v/1e3).toFixed(1)+'k';
  return v.toFixed(0);
}
function _perfFmtNum(v) {
  return Math.abs(v).toLocaleString('en-AU',{minimumFractionDigits:2,maximumFractionDigits:2});
}

// ── XIRR solver ──────────────────────────────────────────────
// cfs: [{date: Date, amount: number}, ...]
function _perfXIRR(cfs) {
  if (cfs.length < 2) return null;
  var d0   = cfs[0].date;
  var days = cfs.map(function(cf) {
    return (cf.date - d0) / (1000 * 60 * 60 * 24);
  });
  function npv(r) {
    return cfs.reduce(function(s, cf, i) {
      return s + cf.amount / Math.pow(1 + r, days[i] / 365);
    }, 0);
  }
  function dnpv(r) {
    return cfs.reduce(function(s, cf, i) {
      return s - cf.amount * (days[i] / 365) / Math.pow(1 + r, days[i] / 365 + 1);
    }, 0);
  }
  var r = 0.1;
  for (var i = 0; i < 200; i++) {
    var n = npv(r), dn = dnpv(r);
    if (Math.abs(dn) < 1e-12) break;
    var rn = r - n / dn;
    if (Math.abs(rn - r) < 1e-8) { r = rn; break; }
    r = Math.max(-0.999, rn);
  }
  return Math.abs(npv(r)) < 10 ? r : null;
}

// ════════════════════════════════════════════════════════════
// VIEW BUILDERS
// ════════════════════════════════════════════════════════════

function _perfBuildPortfolio(snaps, gran) {
  var pts = _perfDownsample(snaps, gran);
  if (!pts.length) return null;
  var state = typeof S !== 'undefined' ? S : window.S;
  var contribs = ((state && state.contributions) || [])
    .map(function(c) { return {d: c.date, a: parseFloat(c.amount)||0}; })
    .sort(function(a,b) { return a.d > b.d ? 1 : -1; });

  var labels      = pts.map(function(p) { return p.d; });
  var valueLine   = pts.map(function(p) { return p.v; });
  var contribLine = pts.map(function(p) {
    var cum = 0;
    contribs.forEach(function(c) { if (c.d <= p.d) cum += c.a; });
    return parseFloat(cum.toFixed(2));
  });

  // FY metric
  var fyS    = _perfTodayFyStr();
  var fySnap = snaps.find(function(s) { return s.d >= fyS; }) || snaps[0];
  var last   = snaps[snaps.length - 1];
  var fyGain = (last && fySnap) ? last.v - fySnap.v : 0;
  var fyPct  = (fySnap && fySnap.v > 0) ? (fyGain / fySnap.v) * 100 : 0;

  return {
    labels: labels,
    datasets: [
      {label:'Portfolio value', data:valueLine,   borderColor:'#f5a623', backgroundColor:'rgba(245,166,35,0.08)', fill:true,  tension:0.3, pointRadius:0, borderWidth:2},
      {label:'Contributions',   data:contribLine, borderColor:'rgba(255,255,255,0.22)', backgroundColor:'transparent', fill:false, tension:0, pointRadius:0, borderWidth:1.5, borderDash:[5,4]},
    ],
    metric:  {gain:fyGain, pct:fyPct, label:'Portfolio growth this FY', isPercent:false},
    yFmt:    function(v) { return '$'+_perfFmtK(v); },
    tipFmt:  function(v,ds) { return ds+': $'+_perfFmtNum(v); },
  };
}

function _perfBuildCostBasis(snaps, gran) {
  var pts = _perfDownsample(snaps, gran);
  if (!pts.length) return null;
  var basis  = parseFloat(_perfCostBasis().toFixed(2));
  var labels = pts.map(function(p) { return p.d; });
  var mktLine = pts.map(function(p) { return parseFloat((p.invested||0).toFixed(2)); });
  var basisLine = pts.map(function() { return basis; });

  var last  = pts[pts.length - 1];
  var gain  = last ? (last.invested||0) - basis : 0;
  var pct   = basis > 0 ? (gain / basis) * 100 : 0;

  return {
    labels: labels,
    datasets: [
      {label:'Market value', data:mktLine,   borderColor:'#f5a623', backgroundColor:'rgba(245,166,35,0.08)', fill:true,  tension:0.3, pointRadius:0, borderWidth:2},
      {label:'Cost basis',   data:basisLine, borderColor:'rgba(255,255,255,0.22)', backgroundColor:'transparent', fill:false, tension:0, pointRadius:0, borderWidth:1.5, borderDash:[5,4]},
    ],
    metric:  {gain:gain, pct:pct, label:'Unrealised gain on investments', isPercent:false},
    yFmt:    function(v) { return '$'+_perfFmtK(v); },
    tipFmt:  function(v,ds) { return ds+': $'+_perfFmtNum(v); },
  };
}

function _perfBuildTWR(snaps, gran, mode) {
  var fyS       = _perfTodayFyStr();
  var sinceDate = (mode === 'fy') ? fyS : (snaps[0] ? snaps[0].d : fyS);
  var filtered  = snaps.filter(function(s) { return s.d >= sinceDate; });
  if (filtered.length < 2) return null;

  var state    = typeof S !== 'undefined' ? S : window.S;
  var contribs = ((state && state.contributions) || [])
    .filter(function(c) { return c.date > sinceDate; })
    .map(function(c) { return {d: c.date, a: parseFloat(c.amount)||0}; })
    .sort(function(a,b) { return a.d > b.d ? 1 : -1; });

  var pts    = _perfDownsample(filtered, gran);
  var labels = [];
  var line   = [];

  var runTWR       = 1.0;
  var lastBreakVal = _perfInterp(filtered, sinceDate) || filtered[0].v;
  var prevPtDate   = sinceDate;

  pts.forEach(function(pt) {
    // Apply any contributions that fell between prevPtDate and pt.d
    var between = contribs.filter(function(c) { return c.d > prevPtDate && c.d <= pt.d; });
    between.forEach(function(c) {
      var vBefore = _perfInterp(filtered, c.d);
      if (lastBreakVal > 0) runTWR *= (vBefore / lastBreakVal);
      lastBreakVal = vBefore + c.a;
    });
    if (lastBreakVal > 0) {
      var twr = (runTWR * (pt.v / lastBreakVal) - 1) * 100;
      labels.push(pt.d);
      line.push(parseFloat(twr.toFixed(4)));
    }
    prevPtDate = pt.d;
  });

  var finalTWR = line.length ? line[line.length - 1] : 0;
  return {
    labels: labels,
    datasets: [
      {label:'Time-weighted return', data:line, borderColor:'#f5a623', backgroundColor:'rgba(245,166,35,0.08)', fill:true, tension:0.3, pointRadius:0, borderWidth:2},
    ],
    metric:  {gain:finalTWR, pct:null, label:(mode==='fy'?'TWR this FY':'TWR since inception'), isPercent:true},
    yFmt:    function(v) { return v.toFixed(1)+'%'; },
    tipFmt:  function(v,ds) { return ds+': '+v.toFixed(2)+'%'; },
  };
}

function _perfBuildMWR(snaps, gran, mode) {
  var fyS       = _perfTodayFyStr();
  var sinceDate = (mode === 'fy') ? fyS : (snaps[0] ? snaps[0].d : fyS);
  var filtered  = snaps.filter(function(s) { return s.d >= sinceDate; });
  if (filtered.length < 2) return null;

  var state    = typeof S !== 'undefined' ? S : window.S;
  var contribs = ((state && state.contributions) || [])
    .filter(function(c) { return c.date > sinceDate; })
    .map(function(c) { return {d: c.date, a: parseFloat(c.amount)||0}; })
    .sort(function(a,b) { return a.d > b.d ? 1 : -1; });

  var v0   = _perfInterp(filtered, sinceDate) || filtered[0].v;
  var d0   = new Date(sinceDate);
  var pts  = _perfDownsample(filtered, gran);
  var labels = [], line = [];

  pts.forEach(function(pt) {
    var dEnd = new Date(pt.d);
    if (dEnd <= d0) return;
    var cfs = [{date: d0, amount: -v0}];
    contribs.filter(function(c) { return c.d > sinceDate && c.d <= pt.d; })
      .forEach(function(c) { cfs.push({date: new Date(c.d), amount: -c.a}); });
    cfs.push({date: dEnd, amount: pt.v});
    var r = _perfXIRR(cfs);
    if (r !== null && isFinite(r) && r > -1) {
      labels.push(pt.d);
      line.push(parseFloat((r * 100).toFixed(4)));
    }
  });

  var finalMWR = line.length ? line[line.length - 1] : 0;
  return {
    labels: labels,
    datasets: [
      {label:'Money-weighted return (ann.)', data:line, borderColor:'#f5a623', backgroundColor:'rgba(245,166,35,0.08)', fill:true, tension:0.3, pointRadius:0, borderWidth:2},
    ],
    metric:  {gain:finalMWR, pct:null, label:(mode==='fy'?'MWR this FY (annualised)':'MWR since inception (annualised)'), isPercent:true},
    yFmt:    function(v) { return v.toFixed(1)+'%'; },
    tipFmt:  function(v,ds) { return ds+': '+v.toFixed(2)+'%'; },
  };
}

// ════════════════════════════════════════════════════════════
// RENDER
// ════════════════════════════════════════════════════════════

function _perfRenderChart(vd) {
  var canvas = document.getElementById('historyChart');
  if (!canvas || !vd) return;
  var isDark    = document.documentElement.getAttribute('data-theme') !== 'light';
  var gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(80,60,180,0.08)';
  var textColor = isDark ? 'rgba(255,255,255,0.3)'  : '#8070a8';
  var tooltipBg = isDark ? 'rgba(14,11,42,0.97)'    : 'rgba(255,255,255,0.97)';
  var tooltipTx = isDark ? '#f0f0ff'                : '#1a1030';
  var tooltipBd = isDark ? 'rgba(255,255,255,0.1)'  : 'rgba(80,60,180,0.15)';

  if (_perfChart) { _perfChart.destroy(); _perfChart = null; }

  _perfChart = new Chart(canvas, {
    type: 'line',
    data: {labels: vd.labels, datasets: vd.datasets},
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {mode:'index', intersect:false},
      plugins: {
        legend: {
          display: vd.datasets.length > 1,
          position: 'top',
          labels: {color:textColor, font:{size:11, family:'DM Sans, Arial, sans-serif'}, boxWidth:12, padding:16, usePointStyle:true}
        },
        tooltip: {
          backgroundColor:tooltipBg, titleColor:tooltipTx, bodyColor:textColor,
          borderColor:tooltipBd, borderWidth:1, padding:10, cornerRadius:8,
          callbacks: {
            label: function(ctx) {
              return ' ' + vd.tipFmt(ctx.parsed.y, ctx.dataset.label);
            }
          }
        }
      },
      scales: {
        x: {grid:{color:gridColor, drawBorder:false}, ticks:{color:textColor, maxTicksLimit:8, font:{size:10}}},
        y: {grid:{color:gridColor, drawBorder:false}, ticks:{color:textColor, font:{size:10}, callback:function(v){return vd.yFmt(v);}}}
      }
    }
  });
}

function _perfUpdateMetric(metric) {
  var el = document.getElementById('perfMetric');
  if (!el || !metric) return;
  var val  = metric.gain;
  var pos  = val >= 0;
  var sign = pos ? '+' : '-';
  var cls  = pos ? 'gain-pos' : 'gain-neg';
  var html;
  if (metric.isPercent) {
    html = '<span class="'+cls+'" style="font-size:22px;font-weight:800;letter-spacing:-0.04em;">'
         + sign + Math.abs(val).toFixed(2) + '%</span>'
         + '<span style="font-size:11px;color:var(--text3);margin-left:8px;">'+metric.label+'</span>';
  } else {
    var pct  = metric.pct || 0;
    var ppos = pct >= 0;
    html = '<span class="'+cls+'" style="font-size:22px;font-weight:800;letter-spacing:-0.04em;">'
         + (pos?'+':'-') + '$'+_perfFmtNum(val) + '</span>'
         + '<span class="'+cls+'" style="font-size:13px;font-weight:600;margin-left:8px;">'
         + (ppos?'+':'-') + Math.abs(pct).toFixed(2) + '%</span>'
         + '<span style="font-size:11px;color:var(--text3);margin-left:6px;">'+metric.label+'</span>';
  }
  el.innerHTML = html;
}

function _perfUpdateUI() {
  // Tab active states
  ['portfolio','costbasis','twr','mwr'].forEach(function(v) {
    var btn = document.getElementById('perf-tab-'+v);
    if (btn) btn.classList.toggle('active', v === _perfView);
  });
  // Granularity active states
  ['daily','weekly','monthly'].forEach(function(g) {
    var btn = document.getElementById('perf-gran-'+g);
    if (btn) btn.classList.toggle('active', g === _perfGran);
  });
  // Sub-toggle active states
  ['fy','inception'].forEach(function(m) {
    var btn = document.getElementById('perf-sub-'+m);
    if (btn) btn.classList.toggle('active', m === _perfMode);
  });
  // Show sub-toggle only for TWR/MWR
  var sub = document.getElementById('perfSubToggle');
  if (sub) sub.style.display = (_perfView==='twr'||_perfView==='mwr') ? 'flex' : 'none';
}

// ── Master render (public) ───────────────────────────────────
function renderPerformance() {
  var state = typeof S !== 'undefined' ? S : window.S;
  var snaps = (state && state.snapshots) || [];

  var metricEl = document.getElementById('perfMetric');

  if (!snaps.length) {
    if (metricEl) metricEl.innerHTML = '<span style="color:var(--text4);font-size:12px;">No history yet — refresh prices to start tracking</span>';
    _perfUpdateUI();
    return;
  }

  var vd = null;
  try {
    if      (_perfView === 'portfolio') vd = _perfBuildPortfolio(snaps, _perfGran);
    else if (_perfView === 'costbasis') vd = _perfBuildCostBasis(snaps, _perfGran);
    else if (_perfView === 'twr')       vd = _perfBuildTWR(snaps, _perfGran, _perfMode);
    else if (_perfView === 'mwr')       vd = _perfBuildMWR(snaps, _perfGran, _perfMode);
  } catch(e) {
    console.error('renderPerformance error:', e);
  }

  if (!vd) {
    if (metricEl) metricEl.innerHTML = '<span style="color:var(--text4);font-size:12px;">Not enough data for this view yet</span>';
    _perfUpdateUI();
    return;
  }

  _perfRenderChart(vd);
  _perfUpdateMetric(vd.metric);
  _perfUpdateUI();
}

// ── Public tab/gran/mode setters ─────────────────────────────
function perfSetView(v) { _perfView = v; renderPerformance(); }
function perfSetGran(g) { _perfGran = g; renderPerformance(); }
function perfSetMode(m) { _perfMode = m; renderPerformance(); }

// ── Hook renderHistoryChart (performance.js loads last) ──────
// Wrap the existing function so renderPerformance fires after every snapshot update.
(function() {
  var _orig = window.renderHistoryChart;
  if (typeof _orig === 'function' && !_orig._perfHooked) {
    window.renderHistoryChart = function(h) {
      _orig(h);
      setTimeout(renderPerformance, 80);
    };
    window.renderHistoryChart._perfHooked = true;
  }
})();

// ── Also fire on DOMContentLoaded in case snapshots already loaded ──
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function() { setTimeout(renderPerformance, 200); });
} else {
  setTimeout(renderPerformance, 200);
}
