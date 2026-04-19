// ══════════════════════════════════════════════════════════════
// ── CHARTS & HISTORY ─────────────────────────────────────────
// ══════════════════════════════════════════════════════════════
let historyChart=null;const HISTORY_KEY='smsf_history';const MAX_SNAPSHOTS=90;
function saveSnapshot(totalValue){
  // Snapshots now saved to Xano on price refresh — localStorage kept as cache only
  if(!totalValue||totalValue<=0)return;
  const today=new Date().toISOString().slice(0,10);
  let history=[];
  try{history=JSON.parse(localStorage.getItem(HISTORY_KEY)||'[]');}catch(e){}
  // Only update localStorage cache, Xano save happens in refreshAll
  if(history.length&&history[history.length-1].d===today){history[history.length-1].v=totalValue;}
  else{history.push({d:today,v:totalValue});}
  try{localStorage.setItem(HISTORY_KEY,JSON.stringify(history));}catch(e){}
}
function renderHistoryChart(history){if(!history){try{history=JSON.parse(localStorage.getItem(HISTORY_KEY)||'[]');}catch(e){history=[];}}const el=document.getElementById('historyChart');const meta=document.getElementById('historyMeta');if(!history.length){if(meta)meta.textContent='No history yet — refresh prices to record first snapshot';return;}const labels=history.map(h=>{const d=new Date(h.d);return d.toLocaleDateString('en-AU',{day:'numeric',month:'short'});});const data=history.map(h=>h.v);const first=data[0],last=data[data.length-1];const change=last-first;const changePct=first>0?(change/first*100):0;const sign=change>=0?'+':'';if(meta)meta.innerHTML=`${history.length} snapshot${history.length>1?'s':''} &nbsp;·&nbsp; <span style="color:${change>=0?'var(--gain-pos)':'var(--gain-neg)'};font-weight:700;">${sign}$${f(Math.abs(change))} (${sign}${changePct.toFixed(1)}%)</span> since first recorded`;const isDarkMode=document.documentElement.getAttribute('data-theme')!=='light';const lineColor=isDarkMode?'#4f8ef5':'#3a7ae0';const fillColor=isDarkMode?'rgba(79,142,245,0.1)':'rgba(79,142,245,0.08)';const gridColor=isDarkMode?'rgba(255,255,255,0.06)':'rgba(0,0,0,0.06)';const textColor=isDarkMode?'#444':'#999';if(historyChart){historyChart.destroy();historyChart=null;}if(!el)return;(function(){const gradH=el.getContext('2d').createLinearGradient(0,0,0,180);gradH.addColorStop(0,'rgba(0,212,255,0.18)');gradH.addColorStop(1,'rgba(0,212,255,0)');historyChart=new Chart(el,{type:'line',data:{labels,datasets:[{data,borderColor:document.documentElement.getAttribute('data-theme')==='light'?'#0099cc':'#00d4ff',backgroundColor:gradH,borderWidth:2,pointRadius:0,pointHoverRadius:5,pointHoverBackgroundColor:'#00d4ff',fill:true,tension:0.4}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{backgroundColor:'rgba(6,10,20,0.85)',borderColor:'rgba(0,212,255,0.25)',borderWidth:1,bodyColor:'#00d4ff',padding:10,callbacks:{label:ctx=>' $'+f(ctx.parsed.y)}}},scales:{x:{grid:{color:gridColor},ticks:{color:textColor,maxTicksLimit:8,font:{size:11}}},y:{grid:{color:gridColor},ticks:{color:textColor,font:{size:11},callback:v=>'$'+f(v)}}}}});})();}

async function xanoSaveSnapshot(portfolioId, value, invested, cash) {
  const date = new Date().toISOString().slice(0, 10);
  try {
    await xano('POST', '/snapshot', {
      portfolio: portfolioId,
      date,
      value,
      invested,
      cash
    });
  } catch(e) {
    console.warn('Snapshot save failed:', e);
  }
}

async function xanoLoadSnapshots(portfolioId) {
  try {
    const data = await xano('GET', `/snapshot?portfolio_id=${portfolioId}`);
    return Array.isArray(data) ? data : (data.items || []);
  } catch(e) {
    console.warn('Snapshot load failed:', e);
    return [];
  }
}
