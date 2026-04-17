// ══════════════════════════════════════════════════════════════
// ── PERFORMANCE CHART — four views, granularity toggle ────────
// ══════════════════════════════════════════════════════════════
// Views:
//   1. portfolio  — total value vs cumulative contributions (AUD $)
//   2. costbasis  — market value of investments vs cost basis (AUD $)
//   3. twr        — time-weighted return % (FY + since inception)
//   4. mwr        — money-weighted return / XIRR % (FY + since inception)
// Granularity: daily | weekly | monthly

(function(){

  // ── State ──────────────────────────────────────────────────
  let _view        = 'portfolio'; // active view key
  let _granularity = 'daily';     // daily | weekly | monthly
  let _chart       = null;        // Chart.js instance on #historyChart

  // ── FY helpers ─────────────────────────────────────────────
  function fyStart(date){
    const d = date ? new Date(date) : new Date();
    const jul1 = new Date(d.getFullYear(), 6, 1);
    return d >= jul1 ? jul1 : new Date(d.getFullYear()-1, 6, 1);
  }
  function fyStartStr(dateStr){
    return fyStart(dateStr).toISOString().slice(0,10);
  }
  function todayFyStart(){ return fyStart(new Date()).toISOString().slice(0,10); }

  // ── Downsample snapshots by granularity ────────────────────
  function downsample(pts, gran){
    if(gran === 'daily') return pts;
    const buckets = {};
    pts.forEach(p => {
      const d = new Date(p.d);
      let key;
      if(gran === 'weekly'){
        // ISO week: Monday of the week
        const day = d.getDay() || 7;
        const mon = new Date(d); mon.setDate(d.getDate() - day + 1);
        key = mon.toISOString().slice(0,10);
      } else {
        key = p.d.slice(0,7); // YYYY-MM
      }
      buckets[key] = p; // keep last point of the bucket
    });
    return Object.values(buckets).sort((a,b)=>a.d>b.d?1:-1);
  }

  // ── Interpolate portfolio value at a given date ────────────
  function interpValue(snapshots, dateStr){
    if(!snapshots.length) return 0;
    const exact = snapshots.find(s=>s.d===dateStr);
    if(exact) return exact.v;
    const before = [...snapshots].reverse().find(s=>s.d<=dateStr);
    const after  = snapshots.find(s=>s.d>=dateStr);
    if(!before) return after ? after.v : 0;
    if(!after)  return before.v;
    if(before.d === after.d) return before.v;
    const t = (new Date(dateStr)-new Date(before.d))/(new Date(after.d)-new Date(before.d));
    return before.v + t*(after.v-before.v);
  }

  // ── Cost basis from transactions ───────────────────────────
  // US stock transactions already store price in AUD (converted at purchase rate by importer).
  // ASX/crypto/metals also store price in AUD.
  // Returns total cost basis in AUD across all holdings.
  function calcCostBasis(){
    let basis = 0;
    const state = typeof S !== 'undefined' ? S : window.S;
    if(!state) return 0;
    ['us','asx','cry','met'].forEach(type => {
      (state[type]||[]).forEach(holding => {
        (holding.txns||[]).forEach(tx => {
          const qty   = parseFloat(tx.qty)   || 0;
          const price = parseFloat(tx.price) || 0;
          const fee   = parseFloat(tx.fee)   || 0;
          if(tx.side === 'buy')  basis += qty*price + fee;
          if(tx.side === 'sell'){
            // reduce basis proportionally (simplified — matches recalcFromTxns logic)
            // We just use the net holdings cost from S[type].cost * S[type].qty
          }
        });
      });
    });
    // Better: use already-recalculated cost × qty from each holding
    basis = 0;
    ['us','asx','cry','met'].forEach(type => {
      (state[type]||[]).forEach(h => {
        const cost = parseFloat(h.cost) || 0;
        const qty  = parseFloat(h.qty)  || 0;
        basis += cost * qty;
      });
    });
    return basis;
  }

  // ── Build cumulative contributions series ──────────────────
  // Returns array of {d, cumulative} sorted by date.
  function buildContribSeries(sinceDate){
    const state = typeof S !== 'undefined' ? S : window.S;
    if(!state) return [];
    const contribs = (state.contributions||[])
      .filter(c => c.date && (!sinceDate || c.date >= sinceDate))
      .map(c => ({d: c.date, amount: parseFloat(c.amount)||0}))
      .sort((a,b) => a.d>b.d?1:-1);
    let cum = 0;
    return contribs.map(c => { cum += c.amount; return {d:c.d, cum}; });
  }

  // ── View 1: Portfolio vs Contributions ─────────────────────
  function buildPortfolioView(snapshots, gran){
    const pts = downsample(snapshots, gran);
    if(!pts.length) return null;

    // Build a cumulative contributions lookup by date
    const state = typeof S !== 'undefined' ? S : window.S;
    const allContribs = (state.contributions||[])
      .map(c => ({d:c.date, amount:parseFloat(c.amount)||0}))
      .sort((a,b)=>a.d>b.d?1:-1);

    // For each snapshot point, find cumulative contributions up to that date
    const labels    = pts.map(p=>p.d);
    const valueLine = pts.map(p=>p.v);
    const contribLine = pts.map(p=>{
      let cum=0;
      allContribs.forEach(c=>{ if(c.d<=p.d) cum+=c.amount; });
      return parseFloat(cum.toFixed(2));
    });

    // FY metric: change in portfolio value since FY start
    const fyS = todayFyStart();
    const fySnap = snapshots.find(s=>s.d>=fyS) || snapshots[0];
    const latest = snapshots[snapshots.length-1];
    const fyGain = latest && fySnap ? latest.v - fySnap.v : 0;
    const fyPct  = fySnap && fySnap.v > 0 ? (fyGain/fySnap.v)*100 : 0;

    return {
      labels,
      datasets:[
        {label:'Portfolio value', data:valueLine,    borderColor:'#f5a623', backgroundColor:'rgba(245,166,35,0.08)', fill:true,  tension:0.3, pointRadius:0, borderWidth:2},
        {label:'Contributions',   data:contribLine,  borderColor:'rgba(255,255,255,0.25)', backgroundColor:'transparent',       fill:false, tension:0,   pointRadius:0, borderWidth:1.5, borderDash:[4,4]},
      ],
      metric: { fyGain, fyPct, label:'Portfolio growth this FY', isPercent:false },
      yFormat: v => '$'+fmtK(v),
      tooltipFormat: (v,ds) => ds+': $'+fmtNum(v),
    };
  }

  // ── View 2: Market Value vs Cost Basis ─────────────────────
  function buildCostBasisView(snapshots, gran){
    const pts = downsample(snapshots, gran);
    if(!pts.length) return null;

    // invested = market value of holdings from snapshot (excludes cash)
    const labels       = pts.map(p=>p.d);
    const marketLine   = pts.map(p=>parseFloat((p.invested||0).toFixed(2)));

    // Cost basis is current (from transactions) — project as a flat line for now.
    // We don't have historical cost basis in snapshots, so we show current basis as reference.
    const currentBasis = parseFloat(calcCostBasis().toFixed(2));
    const basisLine    = pts.map(()=>currentBasis);

    const latest = pts[pts.length-1];
    const gain   = latest ? (latest.invested||0) - currentBasis : 0;
    const pct    = currentBasis > 0 ? (gain/currentBasis)*100 : 0;

    return {
      labels,
      datasets:[
        {label:'Market value', data:marketLine, borderColor:'#f5a623', backgroundColor:'rgba(245,166,35,0.08)', fill:true,  tension:0.3, pointRadius:0, borderWidth:2},
        {label:'Cost basis',   data:basisLine,  borderColor:'rgba(255,255,255,0.25)', backgroundColor:'transparent',       fill:false, tension:0,   pointRadius:0, borderWidth:1.5, borderDash:[4,4]},
      ],
      metric:{ fyGain:gain, fyPct:pct, label:'Unrealised gain on investments', isPercent:false },
      yFormat: v=>'$'+fmtK(v),
      tooltipFormat:(v,ds)=>ds+': $'+fmtNum(v),
    };
  }

  // ── View 3: Time-Weighted Return ──────────────────────────
  // TWR chains sub-period returns between contribution dates.
  // sub-period return = V_end_before_contrib / V_start_after_prev_contrib - 1
  function buildTWRView(snapshots, gran, mode){
    // mode: 'fy' | 'inception'
    const fyS       = todayFyStart();
    const sinceDate = mode==='fy' ? fyS : (snapshots[0]?.d || fyS);
    const filtSnaps = snapshots.filter(s=>s.d>=sinceDate);
    if(filtSnaps.length<2) return null;

    const state       = typeof S !== 'undefined' ? S : window.S;
    const contribs    = (state.contributions||[])
      .filter(c=>c.date>=sinceDate)
      .map(c=>({d:c.date, amount:parseFloat(c.amount)||0}))
      .sort((a,b)=>a.d>b.d?1:-1);

    // Build break-points: start + each contribution date + end
    const breakDates = [sinceDate, ...contribs.map(c=>c.d)];
    const uniqueDates = [...new Set(breakDates)].sort();

    // For each point in the downsampled snapshots, compute running TWR
    const pts = downsample(filtSnaps, gran);
    const labels  = [];
    const twrLine = [];

    let runningTWR = 1.0; // product of (1 + sub-period return)
    let lastBreakIdx = 0;
    let lastBreakValue = interpValue(filtSnaps, sinceDate) || filtSnaps[0].v;
    let lastContribCum = 0;

    // Pre-compute contribution amounts by date
    const contribByDate = {};
    contribs.forEach(c=>{ contribByDate[c.d]=(contribByDate[c.d]||0)+c.amount; });

    pts.forEach(pt => {
      // Check if any contribution fell between last point and this point
      const relevantContribs = contribs.filter(c=>c.d>lastBreakDate(uniqueDates,pt.d,sinceDate)&&c.d<=pt.d);
      relevantContribs.forEach(c=>{
        // Close the sub-period just before this contribution
        const vBeforeContrib = interpValue(filtSnaps, c.d);
        if(lastBreakValue>0){
          const subReturn = vBeforeContrib / lastBreakValue;
          runningTWR *= subReturn;
        }
        // Open new sub-period after contribution
        lastBreakValue = vBeforeContrib + c.amount;
      });

      if(lastBreakValue>0){
        const currentSubReturn = pt.v / lastBreakValue;
        const twr = (runningTWR * currentSubReturn - 1)*100;
        labels.push(pt.d);
        twrLine.push(parseFloat(twr.toFixed(4)));
      }
    });

    const finalTWR = twrLine[twrLine.length-1] || 0;

    return {
      labels,
      datasets:[
        {label:'Time-weighted return', data:twrLine, borderColor:'#f5a623', backgroundColor:'rgba(245,166,35,0.08)', fill:true, tension:0.3, pointRadius:0, borderWidth:2},
      ],
      metric:{ fyGain:finalTWR, fyPct:null, label:(mode==='fy'?'TWR this FY':'TWR since inception'), isPercent:true },
      yFormat: v=>v.toFixed(1)+'%',
      tooltipFormat:(v,ds)=>ds+': '+v.toFixed(2)+'%',
    };
  }

  function lastBreakDate(uniqueDates, ptDate, sinceDate){
    // Find the most recent break date <= ptDate
    let last = sinceDate;
    for(const d of uniqueDates){
      if(d<=ptDate) last=d; else break;
    }
    return last;
  }

  // ── View 4: Money-Weighted Return (XIRR) ─────────────────
  // XIRR: find rate r such that NPV of all cashflows = 0
  // Cashflows: contributions as negative (money going in), current value as positive (exit)
  function buildMWRView(snapshots, gran, mode){
    const fyS       = todayFyStart();
    const sinceDate = mode==='fy' ? fyS : (snapshots[0]?.d || fyS);
    const filtSnaps = snapshots.filter(s=>s.d>=sinceDate);
    if(filtSnaps.length<2) return null;

    const state    = typeof S !== 'undefined' ? S : window.S;
    const contribs = (state.contributions||[])
      .filter(c=>c.date>=sinceDate)
      .map(c=>({d:c.date, amount:parseFloat(c.amount)||0}))
      .sort((a,b)=>a.d>b.d?1:-1);

    // Build MWR line: for each snapshot point, compute XIRR from sinceDate to that point
    const pts    = downsample(filtSnaps, gran);
    const labels = [];
    const mwrLine= [];

    // Starting value (treated as initial investment)
    const v0 = interpValue(filtSnaps, sinceDate) || filtSnaps[0].v;
    const d0 = new Date(sinceDate);

    pts.forEach(pt => {
      const dEnd = new Date(pt.d);
      if(dEnd <= d0) return;

      // Build cashflow array: [initial outflow, ...contributions, final inflow]
      const cfs = [{date:d0, amount:-v0}];
      contribs.filter(c=>c.d>sinceDate&&c.d<=pt.d).forEach(c=>{
        cfs.push({date:new Date(c.d), amount:-c.amount});
      });
      cfs.push({date:dEnd, amount:pt.v});

      const rate = xirr(cfs);
      if(rate !== null && isFinite(rate) && rate > -1){
        labels.push(pt.d);
        mwrLine.push(parseFloat((rate*100).toFixed(4)));
      }
    });

    const finalMWR = mwrLine[mwrLine.length-1] || 0;

    return {
      labels,
      datasets:[
        {label:'Money-weighted return (annualised)', data:mwrLine, borderColor:'#f5a623', backgroundColor:'rgba(245,166,35,0.08)', fill:true, tension:0.3, pointRadius:0, borderWidth:2},
      ],
      metric:{ fyGain:finalMWR, fyPct:null, label:(mode==='fy'?'MWR this FY (annualised)':'MWR since inception (annualised)'), isPercent:true },
      yFormat: v=>v.toFixed(1)+'%',
      tooltipFormat:(v,ds)=>ds+': '+v.toFixed(2)+'%',
    };
  }

  // ── XIRR solver (Newton's method) ─────────────────────────
  // cfs: [{date: Date, amount: number}, ...]
  function xirr(cfs){
    if(cfs.length < 2) return null;
    const d0   = cfs[0].date;
    const days = cfs.map(cf=>(cf.date-d0)/(1000*60*60*24));
    function npv(r){
      return cfs.reduce((s,cf,i)=>s + cf.amount / Math.pow(1+r, days[i]/365), 0);
    }
    function dnpv(r){
      return cfs.reduce((s,cf,i)=> s - cf.amount*(days[i]/365) / Math.pow(1+r, days[i]/365+1), 0);
    }
    let r = 0.1;
    for(let i=0; i<100; i++){
      const n = npv(r);
      const d = dnpv(r);
      if(Math.abs(d) < 1e-12) break;
      const rNew = r - n/d;
      if(Math.abs(rNew-r) < 1e-8){ r=rNew; break; }
      r = rNew;
      if(r < -0.999) r = -0.999;
    }
    return Math.abs(npv(r)) < 1 ? r : null;
  }

  // ── Number formatters ──────────────────────────────────────
  function fmtK(v){
    if(Math.abs(v)>=1000000) return (v/1000000).toFixed(2)+'M';
    if(Math.abs(v)>=1000)    return (v/1000).toFixed(1)+'k';
    return v.toFixed(0);
  }
  function fmtNum(v){
    return v.toLocaleString('en-AU',{minimumFractionDigits:2,maximumFractionDigits:2});
  }

  // ── Render chart from view data ────────────────────────────
  function renderChart(viewData){
    if(!viewData) return;
    const canvas = document.getElementById('historyChart');
    if(!canvas) return;
    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    const gridColor  = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(80,60,180,0.08)';
    const textColor  = isDark ? 'rgba(255,255,255,0.3)'  : '#8070a8';

    if(_chart){ _chart.destroy(); _chart=null; }

    _chart = new Chart(canvas, {
      type:'line',
      data:{ labels:viewData.labels, datasets:viewData.datasets },
      options:{
        responsive:true,
        maintainAspectRatio:false,
        interaction:{ mode:'index', intersect:false },
        plugins:{
          legend:{
            display: viewData.datasets.length > 1,
            position:'top',
            labels:{ color:textColor, font:{size:11}, boxWidth:12, padding:16, usePointStyle:true }
          },
          tooltip:{
            backgroundColor: isDark ? 'rgba(14,11,42,0.97)' : 'rgba(255,255,255,0.97)',
            titleColor: isDark ? '#f0f0ff' : '#1a1030',
            bodyColor:  isDark ? 'rgba(255,255,255,0.6)' : '#4a3870',
            borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(80,60,180,0.15)',
            borderWidth:1, padding:10, cornerRadius:8,
            callbacks:{
              label: ctx => {
                const ds = ctx.dataset.label;
                const v  = ctx.parsed.y;
                return ' '+viewData.tooltipFormat(v,ds);
              }
            }
          }
        },
        scales:{
          x:{
            grid:{ color:gridColor, drawBorder:false },
            ticks:{ color:textColor, maxTicksLimit:8, font:{size:10} }
          },
          y:{
            grid:{ color:gridColor, drawBorder:false },
            ticks:{ color:textColor, callback: v=>viewData.yFormat(v), font:{size:10} }
          }
        }
      }
    });
  }

  // ── Update metric display ──────────────────────────────────
  function updateMetric(metric){
    const el = document.getElementById('perfMetric');
    if(!el || !metric) return;
    const val   = metric.fyGain;
    const isPos = val >= 0;
    const sign  = isPos ? '+' : '';
    const cls   = isPos ? 'gain-pos' : 'gain-neg';
    let html;
    if(metric.isPercent){
      html = `<span class="${cls}" style="font-size:22px;font-weight:800;letter-spacing:-0.04em;">${sign}${val.toFixed(2)}%</span>
              <span style="font-size:11px;color:var(--text3);margin-left:8px;">${metric.label}</span>`;
    } else {
      const pct = metric.fyPct;
      html = `<span class="${cls}" style="font-size:22px;font-weight:800;letter-spacing:-0.04em;">${sign}$${fmtNum(Math.abs(val))}</span>
              <span class="${cls}" style="font-size:13px;font-weight:600;margin-left:8px;">${sign}${(pct||0).toFixed(2)}%</span>
              <span style="font-size:11px;color:var(--text3);margin-left:6px;">${metric.label}</span>`;
    }
    el.innerHTML = html;
  }

  // ── TWR/MWR sub-mode (FY vs inception) ────────────────────
  let _twrMode = 'fy'; // 'fy' | 'inception'

  // ── Master render ──────────────────────────────────────────
  function renderPerformance(){
    const snapshots = (typeof S !== 'undefined' ? S : window.S)?.snapshots || [];
    if(!snapshots.length){
      const el = document.getElementById('perfMetric');
      if(el) el.innerHTML = '<span style="color:var(--text4);font-size:12px;">No history yet — refresh prices to start tracking</span>';
      return;
    }

    let viewData = null;
    switch(_view){
      case 'portfolio': viewData = buildPortfolioView(snapshots, _granularity); break;
      case 'costbasis': viewData = buildCostBasisView(snapshots, _granularity); break;
      case 'twr':       viewData = buildTWRView(snapshots, _granularity, _twrMode); break;
      case 'mwr':       viewData = buildMWRView(snapshots, _granularity, _twrMode); break;
    }

    if(!viewData){
      const el = document.getElementById('perfMetric');
      if(el) el.innerHTML = '<span style="color:var(--text4);font-size:12px;">Not enough data for this view</span>';
      if(_chart){ _chart.destroy(); _chart=null; }
      return;
    }

    renderChart(viewData);
    updateMetric(viewData.metric);

    // Show/hide FY vs inception toggle for TWR/MWR
    const subToggle = document.getElementById('perfSubToggle');
    if(subToggle) subToggle.style.display = (_view==='twr'||_view==='mwr') ? 'flex' : 'none';

    // Update active tab styles
    ['portfolio','costbasis','twr','mwr'].forEach(v=>{
      const btn = document.getElementById('perf-tab-'+v);
      if(btn) btn.classList.toggle('active', v===_view);
    });

    // Update granularity button styles
    ['daily','weekly','monthly'].forEach(g=>{
      const btn = document.getElementById('perf-gran-'+g);
      if(btn) btn.classList.toggle('active', g===_granularity);
    });

    // Update sub-toggle (FY/inception) styles
    ['fy','inception'].forEach(m=>{
      const btn = document.getElementById('perf-sub-'+m);
      if(btn) btn.classList.toggle('active', m===_twrMode);
    });
  }

  // ── Public API ─────────────────────────────────────────────
  window.perfSetView = function(v){ _view=v; renderPerformance(); };
  window.perfSetGran = function(g){ _granularity=g; renderPerformance(); };
  window.perfSetMode = function(m){ _twrMode=m; renderPerformance(); };
  window.renderPerformance = renderPerformance;

  // Re-render whenever theme changes
  const _origToggle = window.toggleTheme;
  window.toggleTheme = function(){
    if(_origToggle) _origToggle();
    setTimeout(renderPerformance, 80);
  };

})();
