function rows(type){if(type==='cash'){renderCash();return;}if(type==='fees'){renderFees();return;}if(type==='wl'){renderWl();return;}const body=document.getElementById(type+'B');const showAud=document.getElementById('audToggle').checked,r=S.audUsd;const wasOpen=openDrawer&&openDrawer.startsWith(type+':')?openDrawer:null;if(!body)return;body.innerHTML=S[type].map((item,i)=>{const p=S.prices[type+':'+item.ticker];const price=p?p.price:null,chg=p?p.change:null;const val=price!==null&&item.qty?price*item.qty:null;let dp=price,dv=val;if(type==='us'&&showAud&&price!==null){dp=price/r;dv=val/r;}const hasCost=item.cost&&item.cost>0;let gl=null,glPct=null;if(hasCost&&val!==null){const tc=item.cost*item.qty;const dv2=type==='us'?(showAud?val/r:val*S.audUsd):val;gl=dv2-tc;glPct=tc>0?(gl/tc)*100:0;}const cc=chg>0?'pos':chg<0?'neg':'';const cs=chg!==null?(chg>0?'+':'')+f(chg,2)+'%':'—';const isF=(type==='cry'||type==='met');const isOpen=wasOpen===type+':'+i;const txCount=(item.txns||[]).length;const txBadge=txCount>0?` <span style="font-size:10px;color:var(--text4);">${txCount} trade${txCount>1?'s':''}</span>`:'';const costDisp=item.cost>0?item.cost:'';const drawerHtml=isOpen?buildDrawer(type,i,item,showAud,r):'';const ro=isReadOnly();return`<tr class="holding-row${isOpen?' open':''}" onclick="toggleDrawer('${type}',${i})"><td><div class="sym">${item.ticker}${txBadge}</div></td><td class="mob-hide"><div class="aname">${item.name}</div></td><td class="r"><input class="ni" type="number" step="${isF?'any':'1'}" value="${item.qty}" onclick="event.stopPropagation()" onchange="upField('${type}',${i},'qty',this.value)" ${ro?'disabled':''}></td><td class="r">${price!==null?'$'+f(dp):'<span class="dim">—</span>'}</td><td class="r ${cc} mob-hide">${cs}</td><td class="r mob-hide"><input class="ni" type="number" step="any" value="${costDisp}" placeholder="0.00" onclick="event.stopPropagation()" onchange="upField('${type}',${i},'cost',this.value)" ${ro||txCount>0?'disabled':''}></td><td class="r valbold">${val!==null?'$'+f(dv):'<span class="dim">—</span>'}</td><td class="r mob-hide">${glChip(gl,glPct)}</td><td><button class="del" onclick="event.stopPropagation();delA('${type}',${i})" ${ro?'disabled':''}>✕</button></td></tr>${drawerHtml?`<tr class="tx-row"><td colspan="9">${drawerHtml}</td></tr>`:''}`;}).join('');summary();}

function buildDrawer(type,i,item,showAud,r){const txns=item.txns||[];const cur=(type==='us'&&!showAud)?'USD':'AUD';const ro=isReadOnly();const txRows=txns.length?[...txns].sort((a,b)=>new Date(b.date)-new Date(a.date)).map((tx,ti)=>{const origIdx=txns.indexOf(tx);const d=tx.date?new Date(tx.date).toLocaleDateString('en-AU',{day:'2-digit',month:'short',year:'numeric'}):'—';const isBuy=tx.side==='buy';const sideLabel=`<span class="${isBuy?'tx-buy':'tx-sell'}">${isBuy?'Buy':'Sell'}</span>`;const feeStr=tx.fee>0?'$'+f(tx.fee):'<span style="color:var(--text4)">—</span>';return`<tr><td>${d}</td><td>${sideLabel}</td><td class="r">${f(tx.qty,tx.qty%1===0?0:4)}</td><td class="r">$${f(tx.price)}</td><td class="r">$${f(tx.qty*tx.price)}</td><td class="r">${feeStr}</td><td style="width:24px;text-align:right;"><button class="del" style="opacity:1;" onclick="delTxn('${type}',${i},${origIdx})" ${ro?'disabled':''}>✕</button></td></tr>`;}).join(''):`<tr><td colspan="7" class="tx-empty">No transactions yet</td></tr>`;return`<div class="tx-drawer"><div class="tx-header"><span class="tx-title">${item.ticker} · Trade history</span>${!ro?`<button class="tx-addbtn" onclick="event.stopPropagation();showTxForm('${type}',${i})">+ Add trade</button>`:''}</div><table class="tx-table"><thead><tr><th>Date</th><th>Side</th><th class="r">Qty</th><th class="r">Price (${cur})</th><th class="r">Total (${cur})</th><th class="r">Fee (AUD)</th><th style="width:24px"></th></tr></thead><tbody>${txRows}</tbody></table>${!ro?`<div class="tx-add-form" id="txForm_${type}_${i}"><input type="date" id="txDate_${type}_${i}" style="width:130px;"><select id="txSide_${type}_${i}" style="width:80px;"><option value="buy">Buy</option><option value="sell">Sell</option></select><input type="number" step="any" id="txQty_${type}_${i}" placeholder="Qty" style="width:80px;"><input type="number" step="any" id="txPrice_${type}_${i}" placeholder="Price (${cur})" style="width:110px;"><input type="number" step="any" id="txFee_${type}_${i}" placeholder="Fee AUD (opt.)" style="width:120px;"><button class="okbtn" style="font-size:12px;padding:4px 12px;" onclick="event.stopPropagation();saveTxn('${type}',${i})">Add</button><button class="tx-addbtn" onclick="event.stopPropagation();hideTxForm('${type}',${i})">Cancel</button></div>`:''}</div>`;}

function toggleDrawer(type,i){const key=type+':'+i;openDrawer=(openDrawer===key)?null:key;renderAllHoldings();setTimeout(()=>{const d=document.getElementById(`txDate_${type}_${i}`);if(d&&!d.value)d.value=new Date().toISOString().slice(0,10);},20);}
function showTxForm(type,i){const el=document.getElementById(`txForm_${type}_${i}`);if(el){el.style.display='flex';const d=document.getElementById(`txDate_${type}_${i}`);if(d&&!d.value)d.value=new Date().toISOString().slice(0,10);}}
function hideTxForm(type,i){const el=document.getElementById(`txForm_${type}_${i}`);if(el)el.style.display='none';}

async function saveTxn(type,i){
  if(isReadOnly()) return;
  const date=document.getElementById(`txDate_${type}_${i}`).value;
  const side=document.getElementById(`txSide_${type}_${i}`).value;
  const qty=parseFloat(document.getElementById(`txQty_${type}_${i}`).value)||0;
  const price=parseFloat(document.getElementById(`txPrice_${type}_${i}`).value)||0;
  const fee=parseFloat(document.getElementById(`txFee_${type}_${i}`).value)||0;
  if(!qty||!price)return;
  const showAud=document.getElementById('audToggle').checked;
  const storePrice=(type==='us'&&!showAud)?price/S.audUsd:price;
  if(!S[type][i].txns)S[type][i].txns=[];
  S[type][i].txns.push({date,side,qty,price:storePrice,fee,txnId:generateTxnId(date),cashAcct:null});
  recalcFromTxns(type,i);
  try {
    await xanoUpdateHolding(type, i);
    await xanoAddTransaction(type, i);
    syncUI('synced','Saved · '+new Date().toLocaleTimeString('en-AU',{hour:'2-digit',minute:'2-digit'}));
  } catch(e) {
    syncUI('err','Save failed: '+e.message);
    // Rollback local state if Xano save failed
    S[type][i].txns.pop();
    recalcFromTxns(type,i);
    console.error('saveTxn error:', e);
    alert('Transaction save failed: ' + e.message + '\nholding._id: ' + S[type][i]?._id + '\nportfolioId: ' + AUTH.currentPortfolioId);
  }
  rows(type);renderAllHoldings();renderFees();
}

async function delTxn(type,i,ti){
  if(isReadOnly()) return;
  const item=S[type][i];
  const tx=item.txns[ti];
  if(!tx) return;
  const xanoId=tx._id;
  item.txns.splice(ti,1);
  recalcFromTxns(type,i);
  try {
    // Update holding qty/cost first, then delete the transaction record
    await xanoUpdateHolding(type,i);
    await xanoDeleteTransaction(xanoId);
    // Reverse cash account balance if the transaction was linked to one
    if(tx.cashAcct!=null&&S.cash[tx.cashAcct]){
      const tradeTotal=tx.qty*tx.price;
      const withFee=tx.fee>0?tradeTotal+tx.fee:tradeTotal;
      S.cash[tx.cashAcct].balance=(S.cash[tx.cashAcct].balance||0)+(tx.side==='buy'?withFee:-withFee);
      await xanoUpdateCash(tx.cashAcct);
      renderCash();
    }
    syncUI('synced','Transaction removed · '+new Date().toLocaleTimeString('en-AU',{hour:'2-digit',minute:'2-digit'}));
  } catch(e) { syncUI('err','Delete failed: '+e.message); }
  rows(type);renderAllHoldings();renderFees();
}

function renderAllocTable(){
  const body=document.getElementById('allocTableBody');if(!body)return;
  const r=S.audUsd||1;
  const tots={};
  const costs={};
  // Calculate values by type
  S.us.forEach(h=>{const p=S.prices['us:'+h.ticker];if(p){const v=p.price*h.qty/r;tots.us=(tots.us||0)+v;const c=(h.cost||0)*h.qty;costs.us=(costs.us||0)+c;}});
  S.asx.forEach(h=>{const p=S.prices['asx:'+h.ticker];if(p){const v=p.price*h.qty;tots.asx=(tots.asx||0)+v;const c=(h.cost||0)*h.qty;costs.asx=(costs.asx||0)+c;}});
  S.cry.forEach(h=>{const p=S.prices['cry:'+h.ticker];if(p){const v=p.price*h.qty;tots.cry=(tots.cry||0)+v;const c=(h.cost||0)*h.qty;costs.cry=(costs.cry||0)+c;}});
  S.met.forEach(h=>{const p=S.prices['met:'+h.ticker];if(p){const v=p.price*h.qty;tots.met=(tots.met||0)+v;const c=(h.cost||0)*h.qty;costs.met=(costs.met||0)+c;}});
  const cashTot=S.cash.reduce((s,a)=>s+(a.balance||0),0);
  const grand=((tots.us||0)+(tots.asx||0)+(tots.cry||0)+(tots.met||0)+cashTot)||1;
  // 24h change by type
  function day24(type){let cur=0,prev=0;S[type].forEach(h=>{const p=S.prices[type+':'+h.ticker];if(p&&p.change!=null){const v=p.price*h.qty*(type==='us'?1/r:1);cur+=v;prev+=v/(1+p.change/100);}});return cur-prev;}
  const rows=[
    {label:'US Stocks',dot:'#818cf8',val:tots.us||0,cost:costs.us||0,d24:day24('us')},
    {label:'ASX Stocks',dot:'#10b981',val:tots.asx||0,cost:costs.asx||0,d24:day24('asx')},
    {label:'Crypto',dot:'#f59e0b',val:tots.cry||0,cost:costs.cry||0,d24:day24('cry')},
    {label:'Metals',dot:'#9b9fc8',val:tots.met||0,cost:costs.met||0,d24:day24('met')},
    {label:'Cash',dot:'#00d4ff',val:cashTot,cost:cashTot,d24:0},
  ];
  // Update alloc bar
  const bar=document.getElementById('allocBar');
  if(bar){bar.innerHTML=rows.map(row=>{const pct=((row.val/grand)*100).toFixed(1);return`<div class="alloc-seg" style="background:${row.dot};width:${pct}%"></div>`;}).join('');}
  body.innerHTML=rows.map(row=>{
    const pct=((row.val/grand)*100).toFixed(1);
    const gl=row.val-row.cost;const glPct=row.cost>0?(gl/row.cost*100):0;
    const d24=row.d24;const d24Pct=row.val>0?(d24/(row.val-d24)*100):0;
    const d24str=d24!==0?(d24>0?'+':'')+f(d24)+' ('+(d24Pct>0?'+':'')+d24Pct.toFixed(2)+'%)':'—';
    const d24col=d24>0?'var(--gain-pos)':d24<0?'var(--gain-neg)':'var(--text3)';
    const glstr=gl!==0?(gl>0?'+':'')+f(gl)+' ('+(glPct>0?'+':'')+glPct.toFixed(1)+'%)':'—';
    const glcol=gl>0?'var(--gain-pos)':gl<0?'var(--gain-neg)':'var(--text3)';
    return`<tr>
      <td><div style="display:flex;align-items:center;gap:8px;"><div style="width:8px;height:8px;border-radius:50%;background:${row.dot};flex-shrink:0;"></div>${row.label}</div></td>
      <td class="r valbold">$${f(row.val)}</td>
      <td class="r">${pct}%</td>
      <td class="r mob-hide" style="color:${d24col};">${d24str}</td>
      <td class="r mob-hide" style="color:${glcol};">${glstr}</td>
    </tr>`;
  }).join('');
}

function summary(){
  const showAud=document.getElementById('audToggle').checked,r=S.audUsd;
  let usU=0,asxA=0,cryA=0,metA=0,usCU=0,asxCA=0,cryCA=0,metCA=0;
  S.us.forEach(item=>{const p=S.prices['us:'+item.ticker];if(p&&item.qty){usU+=p.price*item.qty;if(item.cost)usCU+=item.cost*item.qty;}});
  S.asx.forEach(item=>{const p=S.prices['asx:'+item.ticker];if(p&&item.qty){asxA+=p.price*item.qty;if(item.cost)asxCA+=item.cost*item.qty;}});
  S.cry.forEach(item=>{const p=S.prices['cry:'+item.ticker];if(p&&item.qty){cryA+=p.price*item.qty;if(item.cost)cryCA+=item.cost*item.qty;}});
  S.met.forEach(item=>{const p=S.prices['met:'+item.ticker];if(p&&item.qty){metA+=p.price*item.qty;if(item.cost)metCA+=item.cost*item.qty;}});
  const cashA=S.cash.reduce((s,a)=>s+(a.balance||0),0);
  const usA=usU/r,total=usA+asxA+cryA+metA+cashA,totalCost=usCU+asxCA+cryCA+metCA;
  function glStr(val,cost){if(!cost||!val)return'';const gl=val-cost,pct=cost>0?(gl/cost)*100:0;const cls=gl>0?'gain-pos':gl<0?'gain-neg':'gain-neu';const sign=gl>=0?'+':'';return`<span class="${cls}">${sign}$${f(Math.abs(gl))} (${sign}${f(pct,1)}%)</span>`;}
  document.getElementById('tot').textContent=total>0?'$'+f(total):'\u2014';
  // Update topbar P&L
  (function(){
    const pnlEl=document.getElementById('topbar-pnl-val');
    const pnlPct=document.getElementById('topbar-pnl-pct');
    if(!pnlEl||!pnlPct)return;
    // Compute today's estimated P&L from price changes
    let dayPnl=0;
    S.us.forEach(item=>{const p=S.prices['us:'+item.ticker];if(p&&p.change&&item.qty){const curAud=p.price*item.qty/S.audUsd;const prevAud=curAud/(1+(p.change/100));dayPnl+=curAud-prevAud;}});
    S.asx.forEach(item=>{const p=S.prices['asx:'+item.ticker];if(p&&p.change&&item.qty){const cur=p.price*item.qty;const prev=cur/(1+(p.change/100));dayPnl+=cur-prev;}});
    S.cry.forEach(item=>{const p=S.prices['cry:'+item.ticker];if(p&&p.change&&item.qty){const cur=p.price*item.qty;const prev=cur/(1+(p.change/100));dayPnl+=cur-prev;}});
    S.met.forEach(item=>{const p=S.prices['met:'+item.ticker];if(p&&p.change&&item.qty){const cur=p.price*item.qty;const prev=cur/(1+(p.change/100));dayPnl+=cur-prev;}});
    if(total>0&&dayPnl!==0){
      const sign=dayPnl>=0?'+':'';const pct=total>0?(dayPnl/total*100):0;
      pnlEl.textContent=(dayPnl>=0?'+':'')+f(dayPnl);
      pnlEl.style.color=dayPnl>=0?'var(--gain-pos)':'var(--gain-neg)';
      pnlPct.textContent=(pct>=0?'\u25b2 ':'\u25bc ')+Math.abs(pct).toFixed(2)+'%';
      pnlPct.style.background=dayPnl>=0?'var(--gl-pos-bg)':'var(--gl-neg-bg)';
      pnlPct.style.color=dayPnl>=0?'var(--gain-pos)':'var(--gain-neg)';
    }
  })();
  if(total>0)animateValue(document.getElementById('tot'),total);
  if(usA>0)animateValue(document.getElementById('usT'),usA);else document.getElementById('usT').textContent='\u2014';
  document.getElementById('usGL').innerHTML=usCU>0?glStr(usA,usCU):'';
  if(asxA>0)animateValue(document.getElementById('asxT'),asxA);else document.getElementById('asxT').textContent='\u2014';
  document.getElementById('asxGL').innerHTML=asxCA>0?glStr(asxA,asxCA):'';
  if(cryA>0)animateValue(document.getElementById('crypT'),cryA);else document.getElementById('crypT').textContent='\u2014';
  document.getElementById('crypGL').innerHTML=cryCA>0?glStr(cryA,cryCA):'';
  if(metA>0)animateValue(document.getElementById('metT'),metA);else document.getElementById('metT').textContent='\u2014';
  document.getElementById('metGL').innerHTML=metCA>0?glStr(metA,metCA):'';
  if(cashA>0)animateValue(document.getElementById('cashT'),cashA);else document.getElementById('cashT').textContent='\u2014';
  const invested=usA+asxA+cryA+metA;
  const subInv=document.getElementById('tot-invested');const subCash=document.getElementById('tot-cash');const subRate=document.getElementById('tot-rate');
  if(subInv)subInv.textContent=invested>0?'$'+f(invested):'\u2014';
  if(subCash)subCash.textContent=cashA>0?'$'+f(cashA):'\u2014';
  if(subRate)subRate.textContent=S.audUsd.toFixed(4);
  document.getElementById('cashSecTot').textContent=cashA>0?'$'+f(cashA)+' AUD':'';
  document.getElementById('usSecTot').textContent=usU>0?'$'+f(showAud?usA:usU)+' '+(showAud?'AUD':'USD'):'';
  document.getElementById('asxSecTot').textContent=asxA>0?'$'+f(asxA)+' AUD':'';
  document.getElementById('crypSecTot').textContent=cryA>0?'$'+f(cryA)+' AUD':'';
  document.getElementById('metSecTot').textContent=metA>0?'$'+f(metA)+' AUD':'';
  if(total>0){
    const up=v=>((v/total)*100).toFixed(1)+'%';const pct=v=>total>0?((v/total)*100).toFixed(0)+'%':'0%';
    document.getElementById('allocBar').innerHTML=`<div class="alloc-seg" style="background:#378ADD;width:${up(usA)};min-width:${usA>0?'4px':'0'}"></div><div class="alloc-seg" style="background:#10b981;width:${up(asxA)};min-width:${asxA>0?'4px':'0'}"></div><div class="alloc-seg" style="background:#BA7517;width:${up(cryA)};min-width:${cryA>0?'4px':'0'}"></div><div class="alloc-seg" style="background:#888780;width:${up(metA)};min-width:${metA>0?'4px':'0'}"></div><div class="alloc-seg" style="background:#397968;width:${up(cashA)};min-width:${cashA>0?'4px':'0'}"></div>`;
    document.getElementById('usAllocVal').textContent=usA>0?'$'+f(usA):'\u2014';
    document.getElementById('asxAllocVal').textContent=asxA>0?'$'+f(asxA):'\u2014';
    document.getElementById('crypAllocVal').textContent=cryA>0?'$'+f(cryA):'\u2014';
    document.getElementById('metAllocVal').textContent=metA>0?'$'+f(metA):'\u2014';
    document.getElementById('cashAllocVal').textContent=cashA>0?'$'+f(cashA):'\u2014';
    document.getElementById('usAlloc').textContent=pct(usA);document.getElementById('asxAlloc').textContent=pct(asxA);
    document.getElementById('crypAlloc').textContent=pct(cryA);document.getElementById('metAlloc').textContent=pct(metA);document.getElementById('cashAlloc').textContent=pct(cashA);
  }
  updatePie();setTimeout(applyRowTints,100);
  if(total>0&&Object.keys(S.prices).length>0)saveSnapshot(total);
  renderSparklines();
}


function updatePie(){
  const labels=[],data=[],colors=[];
  const isDark=document.documentElement.getAttribute('data-theme')!=='light';
  // Per-type color palettes
  const US_COLORS=['#818cf8','#a5b4fc','#6366f1','#4f46e5','#c7d2fe'];
  const ASX_COLORS=['#10b981','#34d399','#6ee7b7','#059669','#047857'];
  const CRY_COLORS=['#f59e0b','#fbbf24','#f97316','#d97706','#fb923c'];
  const MET_COLORS=['#9b9fc8','#b0b4d8','#7070a8','#8888bb','#aaaacc'];
  const CASH_GREEN=isDark?'#00d4ff':'#0099cc';
  const CASH_COLORS=[CASH_GREEN,'#38e8ff','#7ef0ff','#00b8e0','#0099cc'];
  let ui=0,ai=0,ci2=0,mi=0,cai=0;
  S.us.forEach(item=>{const p=S.prices['us:'+item.ticker];if(p&&item.qty){const v=(p.price*item.qty)/S.audUsd;if(v>0){labels.push(item.ticker);data.push(parseFloat(v.toFixed(2)));colors.push(US_COLORS[ui%US_COLORS.length]);ui++;}}});
  S.asx.forEach(item=>{const p=S.prices['asx:'+item.ticker];if(p&&item.qty){const v=p.price*item.qty;if(v>0){labels.push(item.ticker);data.push(parseFloat(v.toFixed(2)));colors.push(ASX_COLORS[ai%ASX_COLORS.length]);ai++;}}});
  S.cry.forEach(item=>{const p=S.prices['cry:'+item.ticker];if(p&&item.qty){const v=p.price*item.qty;if(v>0){labels.push(item.ticker);data.push(parseFloat(v.toFixed(2)));colors.push(CRY_COLORS[ci2%CRY_COLORS.length]);ci2++;}}});
  S.met.forEach(item=>{const p=S.prices['met:'+item.ticker];if(p&&item.qty){const v=p.price*item.qty;if(v>0){labels.push(item.name);data.push(parseFloat(v.toFixed(2)));colors.push(MET_COLORS[mi%MET_COLORS.length]);mi++;}}});
  S.cash.forEach(item=>{if(item.balance>0){labels.push(item.name);data.push(parseFloat(item.balance.toFixed(2)));colors.push(CASH_COLORS[cai%CASH_COLORS.length]);cai++;}});
  if(!data.length)return;
  const gt=data.reduce((a,b)=>a+b,0);
  document.getElementById('pieLegend').innerHTML=labels.map((l,i)=>{const pct=gt>0?((data[i]/gt)*100).toFixed(1):0;return`<div class="pie-leg-row"><div class="pie-leg-left"><div class="pie-leg-sw" style="background:${colors[i]}"></div><span>${l}</span></div><span style="font-weight:500;">${pct}%</span></div>`;}).join('');
  if(pieChart){pieChart.data.labels=labels;pieChart.data.datasets[0].data=data;pieChart.data.datasets[0].backgroundColor=colors;pieChart.data.datasets[0].borderColor=document.documentElement.getAttribute('data-theme')==='light'?'rgba(240,245,252,0.8)':'rgba(8,13,23,0.8)';pieChart.update();const pc=document.getElementById('pieCenterNum');if(pc)pc.textContent=data.length;}
  else{pieChart=new Chart(document.getElementById('pieChart'),{type:'doughnut',data:{labels,datasets:[{data,backgroundColor:colors,borderWidth:2,borderColor:document.documentElement.getAttribute('data-theme')==='light'?'rgba(240,245,252,0.8)':'rgba(8,13,23,0.8)',hoverOffset:4}]},options:{responsive:true,maintainAspectRatio:false,cutout:'62%',plugins:{legend:{display:false},tooltip:{backgroundColor:'rgba(8,13,23,0.9)',bodyColor:'#f0f6ff',padding:10,callbacks:{label:(ctx)=>{const pct=gt>0?((ctx.parsed/gt)*100).toFixed(1):0;return ctx.label+': $'+f(ctx.parsed)+' ('+pct+'%)';}}}}}});}const pc=document.getElementById('pieCenterNum');if(pc)pc.textContent=data.length;
}
function clearErr(type){const el=document.getElementById(type+'Err');if(el)el.innerHTML='';}
function showErr(type,msg){const el=document.getElementById(type+'Err');if(el)el.innerHTML=`<div class="err-note">${msg}</div>`;}
function setDot(id,s){document.getElementById(id).className='dot dot-'+s;}
function renderSparklines(){
  // Draw real sparklines on all summary cards using portfolio history
  const history=[];
  try{const h=JSON.parse(localStorage.getItem('smsf_history')||'[]');history.push(...h);}catch(e){}
  const pts=history.slice(-14); // last 2 weeks
  // Draw sparkline into any .sparkline element \u2014 use overall portfolio trajectory
  document.querySelectorAll('.sparkline').forEach((el,idx)=>{
    if(pts.length<2){el.innerHTML='<svg viewBox="0 0 100 36" style="width:100%;height:100%;"><line x1="0" y1="18" x2="100" y2="18" stroke="rgba(201,149,42,0.2)" stroke-width="1" stroke-dasharray="3,3"/></svg>';return;}
    const vals=pts.map(p=>p.v);
    const min=Math.min(...vals),max=Math.max(...vals),range=max-min||1;
    const H=34;
    const coords=pts.map((p,i)=>{
      const x=(i/(pts.length-1))*100;
      const y=H-((p.v-min)/range)*(H-4)-2;
      return x+','+y;
    });
    const pathD='M'+coords.join(' L');
    const last=vals[vals.length-1],first=vals[0];
    const up=last>=first;
    const stroke=up?'#4ade80':'#f87171';
    const fillId='spkfill'+idx;
    el.innerHTML=`<svg viewBox="0 0 100 36" preserveAspectRatio="none" style="width:100%;height:100%;overflow:visible">
      <defs><linearGradient id="${fillId}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${stroke}" stop-opacity="0.22"/>
        <stop offset="100%" stop-color="${stroke}" stop-opacity="0"/>
      </linearGradient></defs>
      <path d="${pathD}" fill="none" stroke="${stroke}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="${pathD} L100,36 L0,36 Z" fill="url(#${fillId})"/>
    </svg>`;
  });
}
function delFee(i){
  const fee=S.fees[i];
  if(fee&&fee.cashAcct!=null&&S.cash[fee.cashAcct]){
    S.cash[fee.cashAcct].balance=(S.cash[fee.cashAcct].balance||0)+fee.amount;
    renderCash();
  }
  S.fees.splice(i,1);save();renderFees();
}
function delIncome(i){S.income.splice(i,1);save();renderFees();}
function delContribution(i){S.contributions.splice(i,1);save();renderFees();}
function delTransfer(i){
  const t=S.transfers[i];if(!t)return;
  // Reverse the balance adjustments
  if(S.cash[t.from]!=null)S.cash[t.from].balance=(S.cash[t.from].balance||0)+t.amount;
  if(S.cash[t.to]!=null)S.cash[t.to].balance=(S.cash[t.to].balance||0)-t.amount;
  S.transfers.splice(i,1);save();renderCash();renderFees();
}

function recalcFromTxns(type,i){const txns=S[type][i].txns||[];if(!txns.length)return;let totalQty=0,totalCost=0;[...txns].sort((a,b)=>new Date(a.date)-new Date(b.date)).forEach(tx=>{if(tx.side==='buy'){totalCost+=tx.qty*tx.price+(tx.fee||0);totalQty+=tx.qty;}else{const sf=Math.min(tx.qty/(totalQty||1),1);totalCost-=totalCost*sf;totalQty-=tx.qty;if(totalQty<0)totalQty=0;if(totalCost<0)totalCost=0;}});S[type][i].qty=parseFloat(totalQty.toFixed(8));S[type][i].cost=totalQty>0?parseFloat((totalCost/totalQty).toFixed(6)):0;}
function recalcAll(){['us','asx','cry','met'].forEach(type=>{S[type].forEach((item,i)=>{if((item.txns||[]).length)recalcFromTxns(type,i);});});}

async function upField(t,i,field,v){
  if(isReadOnly()) return;
  S[t][i][field]=parseFloat(v)||0;
  try { await xanoUpdateHolding(t,i); } catch(e) { syncUI('err','Save failed'); }
  rows(t);renderAllHoldings();
}

async function delA(t,i){
  if(isReadOnly()) return;
  if(!confirm(`Remove ${S[t][i].ticker} from portfolio?`)) return;
  try { await xanoDeleteHolding(t,i); } catch(e) { syncUI('err','Delete failed'); return; }
  S[t].splice(i,1);
  if(openDrawer&&openDrawer.startsWith(t+':'))openDrawer=null;
  rows(t);renderAllHoldings();
}

function renderCash(){
  const body=document.getElementById('cashB');if(!body)return;
  const total=S.cash.reduce((s,a)=>s+(a.balance||0),0);
  const ro=isReadOnly();
  if(!S.cash.length){body.innerHTML='<tr><td colspan="3" style="text-align:center;color:var(--text4);padding:20px;">No cash accounts yet</td></tr>';}
  else{body.innerHTML=S.cash.map((item,i)=>`<tr><td style="font-weight:500;">${(item.name||'—').replace(/</g,'&lt;')}</td><td class="r valbold" style="font-size:15px;">$${f(item.balance||0)}</td><td style="text-align:right;white-space:nowrap;min-width:150px;"><input class="ni" type="number" step="any" value="${parseFloat((item.balance||0).toFixed(2))}" style="width:90px;margin-right:6px;" onchange="upCashBal(${i},this.value)" ${ro?'disabled':''}><button class="del" onclick="delCash(${i})" ${ro?'disabled':''}>✕</button></td></tr>`).join('');}
  const el=document.getElementById('cashSecTot');if(el)el.textContent=total>0?'$'+f(total)+' AUD':'';
}

async function upCashBal(i,v){
  if(isReadOnly()) return;
  S.cash[i].balance=parseFloat(v)||0;
  try { await xanoUpdateCash(i); } catch(e) { syncUI('err','Save failed'); }
  renderCash();
}

async function delCash(i){
  if(isReadOnly()) return;
  if(!confirm(`Remove ${S.cash[i].name}?`)) return;
  try { await xanoDeleteCash(i); } catch(e) { syncUI('err','Delete failed'); return; }
  S.cash.splice(i,1);renderCash();
}

function fyLabel(){const now=new Date();const fyStart=now.getMonth()>=6?now.getFullYear():now.getFullYear()-1;return{label:`FY${fyStart}/${String(fyStart+1).slice(2)}`,start:new Date(fyStart,6,1),end:new Date(fyStart+1,5,30,23,59,59)};}

function showFeesAdd(){if(isReadOnly())return;document.getElementById('feesAR').style.display='flex';document.getElementById('feesDate').value=new Date().toISOString().slice(0,10);const sel=document.getElementById('feesAcct');if(sel){sel.innerHTML='<option value="">— No cash account —</option>'+S.cash.map((a,i)=>`<option value="${i}">${a.name} ($${f(a.balance||0)} AUD)</option>`).join('');}}
function hideFeesAdd(){document.getElementById('feesAR').style.display='none';}
async function addFee(){
  if(isReadOnly()) return;
  const date=document.getElementById('feesDate').value;const desc=document.getElementById('feesDesc').value.trim();const cat=document.getElementById('feesCat').value;const amount=parseFloat(document.getElementById('feesAmt').value)||0;const acctVal=document.getElementById('feesAcct')?.value;const cashAcct=acctVal!==''&&acctVal!=null?parseInt(acctVal):null;
  if(!desc||!amount)return;
  const txnId=generateTxnId(date);
  const cashId=cashAcct!=null&&S.cash[cashAcct]?S.cash[cashAcct]._id:null;
  try{
    const rec=await xanoAddLedger({portfolio:AUTH.currentPortfolioId,date,type:'fee',category:cat,description:desc,amount,txn_id:txnId,cash_acct_id:cashId});
    S.fees.push({_id:rec,date,desc,cat,amount,txnId,cashAcct});
    if(cashAcct!==null&&S.cash[cashAcct]){S.cash[cashAcct].balance=(S.cash[cashAcct].balance||0)-amount;await xanoUpdateCash(cashAcct);renderCash();}
    hideFeesAdd();document.getElementById('feesDesc').value='';document.getElementById('feesAmt').value='';renderFees();
    syncUI('synced','Saved');
  }catch(e){syncUI('err','Save failed: '+e.message);}
}

function renderWl(){
  const body=document.getElementById('wlB');if(!body)return;const ro=isReadOnly();
  if(!S.wl.length){body.innerHTML='<tr><td colspan="8" style="text-align:center;color:var(--text4);padding:16px;">No items yet</td></tr>';return;}
  body.innerHTML=S.wl.map((item,i)=>{const key='wl:'+item.type+':'+item.ticker;const p=S.prices[key];const price=p?p.price:null,chg=p?p.change:null;const cc=chg>0?'pos':chg<0?'neg':'';const cs=chg!==null?(chg>0?'+':'')+f(chg,2)+'%':'—';const typeBadge={us:'<span class="wl-type" style="color:#378ADD;">US</span>',asx:'<span class="wl-type" style="color:#10b981;">ASX</span>',crypto:'<span class="wl-type" style="color:#BA7517;">Crypto</span>',metal:'<span class="wl-type" style="color:#888780;">Metal</span>'}[item.type]||'';let vsTarget='<span class="dim">—</span>';if(price!==null&&item.target>0){const diff=price-item.target,pct=(diff/item.target)*100;const sign=diff>=0?'+':'';if(Math.abs(pct)<=3)vsTarget=`<span class="wl-near">${sign}${f(pct,1)}% · Near target</span>`;else if(diff>0)vsTarget=`<span class="wl-above">${sign}${f(pct,1)}% above</span>`;else vsTarget=`<span class="wl-below">${f(pct,1)}% below</span>`;}
  return`<tr><td><div class="sym">${item.ticker}</div></td><td><div class="aname">${item.name}</div></td><td>${typeBadge}</td><td class="r valbold">${price!==null?'$'+f(price):'<span class="dim">—</span>'}</td><td class="r ${cc}">${cs}</td><td class="r"><input class="ni" type="number" step="any" value="${item.target||''}" placeholder="0.00" onchange="upWlTarget(${i},this.value)" ${ro?'disabled':''}></td><td class="r">${vsTarget}</td><td><button class="del" onclick="delWl(${i})" ${ro?'disabled':''}>✕</button></td></tr>`;}).join('');
}

async function upWlTarget(i,v){if(isReadOnly())return;S.wl[i].target=parseFloat(v)||0;try{await xanoUpdateWatchlist(i);}catch(e){syncUI('err','Save failed');}renderWl();}
async function delWl(i){if(isReadOnly())return;try{await xanoDeleteWatchlist(i);}catch(e){syncUI('err','Delete failed');return;}S.wl.splice(i,1);renderWl();}
function showWlAdd(){if(isReadOnly())return;document.getElementById('wlAR').style.display='flex';}
function hideWlAdd(){document.getElementById('wlAR').style.display='none';}
async function addWl(){
  if(isReadOnly()) return;
  const tk=document.getElementById('wlTk').value.trim().toUpperCase();const nm=document.getElementById('wlNm').value.trim()||tk;const type=document.getElementById('wlType').value;const target=parseFloat(document.getElementById('wlTarget').value)||0;
  if(!tk)return;
  S.wl.push({ticker:tk,name:nm,type,target});
  try{await xanoAddWatchlist(S.wl.length-1);syncUI('synced','Saved');}catch(e){syncUI('err','Save failed');S.wl.pop();return;}
  hideWlAdd();document.getElementById('wlTk').value='';document.getElementById('wlNm').value='';document.getElementById('wlTarget').value='';renderWl();
}

async function fetchWl(){
  if(!S.wl.length){setDot('wlDot','stale');return;}
  setDot('wlDot','loading');let ok=false;
  const usItems=S.wl.filter(w=>w.type==='us');
  const asxItems=S.wl.filter(w=>w.type==='asx');
  const cryptoItems=S.wl.filter(w=>w.type==='crypto');
  const metalItems=S.wl.filter(w=>w.type==='metal');
  const r=S.audUsd||0.64;
  await Promise.allSettled([
    ...usItems.map(async w=>{try{const res=await fetch(`https://finnhub.io/api/v1/quote?symbol=${w.ticker}&token=${FINHUB_KEY}`);const d=await res.json();if(d&&d.c&&d.c>0){S.prices['wl:us:'+w.ticker]={price:d.c/r,change:d.pc>0?((d.c-d.pc)/d.pc*100):0};ok=true;}}catch(e){}}),
    ...asxItems.map(async w=>{try{const yahooUrl=`https://query1.finance.yahoo.com/v8/finance/chart/${w.ticker}.AX?interval=1d&range=2d`;const proxyUrl=`https://api.allorigins.win/get?url=${encodeURIComponent(yahooUrl)}`;const res=await fetch(proxyUrl);const outer=await res.json();if(!outer.contents)return;const d=JSON.parse(outer.contents);const meta=d?.chart?.result?.[0]?.meta;if(meta&&meta.regularMarketPrice>0){const prev=meta.chartPreviousClose||meta.previousClose||meta.regularMarketPrice;S.prices['wl:asx:'+w.ticker]={price:meta.regularMarketPrice,change:prev>0?((meta.regularMarketPrice-prev)/prev*100):0};ok=true;}}catch(e){}}),
    cryptoItems.length?fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${cryptoItems.map(w=>CID[w.ticker]||w.ticker.toLowerCase()).join(',')}&vs_currencies=aud&include_24hr_change=true`).then(r=>r.json()).then(d=>{cryptoItems.forEach(w=>{const id=CID[w.ticker]||w.ticker.toLowerCase();if(d[id]){S.prices['wl:crypto:'+w.ticker]={price:d[id].aud,change:d[id].aud_24h_change};ok=true;}});}).catch(()=>{}):Promise.resolve(),
    ...metalItems.map(async w=>{try{const res=await fetch(XANO_BASE+'/metals/price?symbol='+w.ticker,{headers:authHeaders()});const raw=await res.json();const d=raw.response&&raw.response.result?raw.response.result:raw;if(d&&d.price>0){S.prices['wl:metal:'+w.ticker]={price:d.price,change:d.chp!=null?d.chp:0};ok=true;}}catch(e){}}),
  ]);
  setDot('wlDot',ok?'live':'err');renderWl();
}

async function fetchRate(){const sources=[async()=>{const r=await fetch('https://api.frankfurter.app/latest?from=USD&to=AUD');const d=await r.json();if(d.rates&&d.rates.AUD)return 1/d.rates.AUD;return null;},async()=>{const r=await fetch('https://api.coingecko.com/api/v3/simple/price?ids=usd&vs_currencies=aud');const d=await r.json();if(d.usd&&d.usd.aud)return 1/d.usd.aud;return null;}];for(const source of sources){try{const rate=await source();if(rate&&rate>0.5&&rate<1.2){S.audUsd=rate;return;}}catch(e){}}}
function summary(){
  const showAud=document.getElementById('audToggle').checked,r=S.audUsd;
  let usU=0,asxA=0,cryA=0,metA=0,usCU=0,asxCA=0,cryCA=0,metCA=0;
  S.us.forEach(item=>{const p=S.prices['us:'+item.ticker];if(p&&item.qty){usU+=p.price*item.qty;if(item.cost)usCU+=item.cost*item.qty;}});
  S.asx.forEach(item=>{const p=S.prices['asx:'+item.ticker];if(p&&item.qty){asxA+=p.price*item.qty;if(item.cost)asxCA+=item.cost*item.qty;}});
  S.cry.forEach(item=>{const p=S.prices['cry:'+item.ticker];if(p&&item.qty){cryA+=p.price*item.qty;if(item.cost)cryCA+=item.cost*item.qty;}});
  S.met.forEach(item=>{const p=S.prices['met:'+item.ticker];if(p&&item.qty){metA+=p.price*item.qty;if(item.cost)metCA+=item.cost*item.qty;}});
  const cashA=S.cash.reduce((s,a)=>s+(a.balance||0),0);
  const usA=usU/r,total=usA+asxA+cryA+metA+cashA,totalCost=usCU+asxCA+cryCA+metCA;
  function glStr(val,cost){if(!cost||!val)return'';const gl=val-cost,pct=cost>0?(gl/cost)*100:0;const cls=gl>0?'gain-pos':gl<0?'gain-neg':'gain-neu';const sign=gl>=0?'+':'';return`<span class="${cls}">${sign}$${f(Math.abs(gl))} (${sign}${f(pct,1)}%)</span>`;}
  document.getElementById('tot').textContent=total>0?'$'+f(total):'\u2014';
  // Update topbar P&L
  (function(){
    const pnlEl=document.getElementById('topbar-pnl-val');
    const pnlPct=document.getElementById('topbar-pnl-pct');
    if(!pnlEl||!pnlPct)return;
    // Compute today's estimated P&L from price changes
    let dayPnl=0;
    S.us.forEach(item=>{const p=S.prices['us:'+item.ticker];if(p&&p.change&&item.qty){const curAud=p.price*item.qty/S.audUsd;const prevAud=curAud/(1+(p.change/100));dayPnl+=curAud-prevAud;}});
    S.asx.forEach(item=>{const p=S.prices['asx:'+item.ticker];if(p&&p.change&&item.qty){const cur=p.price*item.qty;const prev=cur/(1+(p.change/100));dayPnl+=cur-prev;}});
    S.cry.forEach(item=>{const p=S.prices['cry:'+item.ticker];if(p&&p.change&&item.qty){const cur=p.price*item.qty;const prev=cur/(1+(p.change/100));dayPnl+=cur-prev;}});
    S.met.forEach(item=>{const p=S.prices['met:'+item.ticker];if(p&&p.change&&item.qty){const cur=p.price*item.qty;const prev=cur/(1+(p.change/100));dayPnl+=cur-prev;}});
    if(total>0&&dayPnl!==0){
      const sign=dayPnl>=0?'+':'';const pct=total>0?(dayPnl/total*100):0;
      pnlEl.textContent=(dayPnl>=0?'+':'')+f(dayPnl);
      pnlEl.style.color=dayPnl>=0?'var(--gain-pos)':'var(--gain-neg)';
      pnlPct.textContent=(pct>=0?'\u25b2 ':'\u25bc ')+Math.abs(pct).toFixed(2)+'%';
      pnlPct.style.background=dayPnl>=0?'var(--gl-pos-bg)':'var(--gl-neg-bg)';
      pnlPct.style.color=dayPnl>=0?'var(--gain-pos)':'var(--gain-neg)';
    }
  })();
  if(total>0)animateValue(document.getElementById('tot'),total);
  if(usA>0)animateValue(document.getElementById('usT'),usA);else document.getElementById('usT').textContent='\u2014';
  document.getElementById('usGL').innerHTML=usCU>0?glStr(usA,usCU):'';
  if(asxA>0)animateValue(document.getElementById('asxT'),asxA);else document.getElementById('asxT').textContent='\u2014';
  document.getElementById('asxGL').innerHTML=asxCA>0?glStr(asxA,asxCA):'';
  if(cryA>0)animateValue(document.getElementById('crypT'),cryA);else document.getElementById('crypT').textContent='\u2014';
  document.getElementById('crypGL').innerHTML=cryCA>0?glStr(cryA,cryCA):'';
  if(metA>0)animateValue(document.getElementById('metT'),metA);else document.getElementById('metT').textContent='\u2014';
  document.getElementById('metGL').innerHTML=metCA>0?glStr(metA,metCA):'';
  if(cashA>0)animateValue(document.getElementById('cashT'),cashA);else document.getElementById('cashT').textContent='\u2014';
  const invested=usA+asxA+cryA+metA;
  const subInv=document.getElementById('tot-invested');const subCash=document.getElementById('tot-cash');const subRate=document.getElementById('tot-rate');
  if(subInv)subInv.textContent=invested>0?'$'+f(invested):'\u2014';
  if(subCash)subCash.textContent=cashA>0?'$'+f(cashA):'\u2014';
  if(subRate)subRate.textContent=S.audUsd.toFixed(4);
  document.getElementById('cashSecTot').textContent=cashA>0?'$'+f(cashA)+' AUD':'';
  document.getElementById('usSecTot').textContent=usU>0?'$'+f(showAud?usA:usU)+' '+(showAud?'AUD':'USD'):'';
  document.getElementById('asxSecTot').textContent=asxA>0?'$'+f(asxA)+' AUD':'';
  document.getElementById('crypSecTot').textContent=cryA>0?'$'+f(cryA)+' AUD':'';
  document.getElementById('metSecTot').textContent=metA>0?'$'+f(metA)+' AUD':'';
  if(total>0){
    const up=v=>((v/total)*100).toFixed(1)+'%';const pct=v=>total>0?((v/total)*100).toFixed(0)+'%':'0%';
    document.getElementById('allocBar').innerHTML=`<div class="alloc-seg" style="background:#378ADD;width:${up(usA)};min-width:${usA>0?'4px':'0'}"></div><div class="alloc-seg" style="background:#10b981;width:${up(asxA)};min-width:${asxA>0?'4px':'0'}"></div><div class="alloc-seg" style="background:#BA7517;width:${up(cryA)};min-width:${cryA>0?'4px':'0'}"></div><div class="alloc-seg" style="background:#888780;width:${up(metA)};min-width:${metA>0?'4px':'0'}"></div><div class="alloc-seg" style="background:#397968;width:${up(cashA)};min-width:${cashA>0?'4px':'0'}"></div>`;
    document.getElementById('usAllocVal').textContent=usA>0?'$'+f(usA):'\u2014';
    document.getElementById('asxAllocVal').textContent=asxA>0?'$'+f(asxA):'\u2014';
    document.getElementById('crypAllocVal').textContent=cryA>0?'$'+f(cryA):'\u2014';
    document.getElementById('metAllocVal').textContent=metA>0?'$'+f(metA):'\u2014';
    document.getElementById('cashAllocVal').textContent=cashA>0?'$'+f(cashA):'\u2014';
    document.getElementById('usAlloc').textContent=pct(usA);document.getElementById('asxAlloc').textContent=pct(asxA);
    document.getElementById('crypAlloc').textContent=pct(cryA);document.getElementById('metAlloc').textContent=pct(metA);document.getElementById('cashAlloc').textContent=pct(cashA);
  }
  updatePie();setTimeout(applyRowTints,100);
  if(total>0&&Object.keys(S.prices).length>0)saveSnapshot(total);
  renderSparklines();
}


async function fetchUS(){setDot('usDot','loading');clearErr('us');const tickers=S.us.map(a=>a.ticker);if(!tickers.length){setDot('usDot','stale');return;}let ok=false;await Promise.all(tickers.map(async tk=>{try{const r=await fetch(`https://finnhub.io/api/v1/quote?symbol=${tk}&token=${FINHUB_KEY}`);const d=await r.json();if(d&&d.c&&d.c>0){S.prices['us:'+tk]={price:d.c,change:d.pc>0?((d.c-d.pc)/d.pc*100):0};ok=true;}}catch(e){}}));setDot('usDot',ok?'live':'err');if(!ok)showErr('us','Could not load US prices.');rows('us');}
async function fetchASX(){setDot('asxDot','loading');clearErr('asx');const tickers=S.asx.map(a=>a.ticker);if(!tickers.length){setDot('asxDot','stale');return;}let ok=false;await Promise.all(tickers.map(async tk=>{try{
    // Yahoo Finance — free, no key required, covers ASX with .AX suffix
    // Try query1 first, fall back to query2 (Yahoo Finance mirrors)
    let meta=null;
    for(const host of['query1','query2']){
      try{
        const r=await fetch(`https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(tk+'.AX')}?interval=1d&range=2d`,{headers:{'Accept':'application/json'}});
        if(!r.ok)continue;
        const d=await r.json();
        meta=d?.chart?.result?.[0]?.meta;
        if(meta&&meta.regularMarketPrice>0)break;
      }catch(e){continue;}
    }
    if(meta&&meta.regularMarketPrice>0){
      const prev=meta.chartPreviousClose||meta.previousClose||meta.regularMarketPrice;
      const change=prev>0?((meta.regularMarketPrice-prev)/prev*100):0;
      S.prices['asx:'+tk]={price:meta.regularMarketPrice,change};
      ok=true;
    }
  }catch(e){}}));setDot('asxDot',ok?'live':'err');if(!ok)showErr('asx','Could not load ASX prices — check ticker is correct (e.g. CBA, BHP, SVL).');rows('asx');}
async function fetchCry(){setDot('crypDot','loading');const coins=S.cry.map(a=>CID[a.ticker.toUpperCase()]||a.ticker.toLowerCase());if(!coins.length){setDot('crypDot','stale');return;}try{const r=await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${coins.join(',')}&vs_currencies=aud&include_24hr_change=true`);const d=await r.json();S.cry.forEach(item=>{const id=CID[item.ticker.toUpperCase()]||item.ticker.toLowerCase();if(d[id])S.prices['cry:'+item.ticker]={price:d[id].aud,change:d[id].aud_24h_change};});setDot('crypDot','live');}catch(e){setDot('crypDot','err');}rows('cry');}
async function fetchMetals(){setDot('metDot','loading');clearErr('met');if(!S.met.length){setDot('metDot','stale');return;}let ok=false;try{
    // Xano metals_price proxy → returns all metals per-gram in AUD
    const res=await fetch(XANO_BASE+'/metals_price',{headers:authHeaders()});
    if(!res.ok) throw new Error('HTTP '+res.status);
    const d=await res.json();
    const GRAMS_PER_OZ=31.1034768;
    const map={
      XAU:d.goldGram, GOLD:d.goldGram,
      XAG:d.silverGram, SILVER:d.silverGram,
      XPT:d.platinumGram, PLATINUM:d.platinumGram,
      XPD:d.palladiumGram, PALLADIUM:d.palladiumGram
    };
    S.met.forEach(item=>{
      const perGram=map[item.ticker.toUpperCase()];
      if(perGram&&perGram>0){
        const pricePerOz=perGram*GRAMS_PER_OZ;
        S.prices['met:'+item.ticker]={price:pricePerOz,change:0};
        ok=true;
      }
    });
  }catch(e){console.warn('Metal fetch failed:',e);}
  setDot('metDot',ok?'live':'err');if(!ok)showErr('met','Could not load metal prices.');rows('met');}
  

async function refreshAll(){const btn=document.getElementById('rfBtn'),icon=document.getElementById('rfIcon');btn.disabled=true;icon.classList.add('spin');try{await fetchRate();await Promise.allSettled([fetchUS(),fetchASX(),fetchCry(),fetchMetals(),fetchWl()]);summary();renderAllHoldings();renderAllocTable();
      // Save snapshot to Xano after price refresh
      setTimeout(async () => {
        try {
          const val = parseFloat(document.getElementById('tot')?.textContent?.replace(/[^0-9.]/g,''))||0;
          const inv = parseFloat(document.getElementById('tot-invested')?.textContent?.replace(/[^0-9.]/g,''))||0;
          const csh = parseFloat(document.getElementById('tot-cash')?.textContent?.replace(/[^0-9.]/g,''))||0;
          if(val > 0 && AUTH.currentPortfolioId) {
            await xanoSaveSnapshot(AUTH.currentPortfolioId, val, inv, csh);
            // Reload snapshots and re-render history
            const snapshots = await xanoLoadSnapshots(AUTH.currentPortfolioId);
            if(snapshots && snapshots.length) {
              const history = snapshots.sort((a,b)=>a.date>b.date?1:-1).map(s=>({d:s.date,v:parseFloat(s.value)||0,invested:parseFloat(s.invested)||0,cash:parseFloat(s.cash)||0}));
              S.snapshots = history;
              try{localStorage.setItem(HISTORY_KEY+'_'+AUTH.currentPortfolioId, JSON.stringify(history));}catch(e){}
              renderHistoryChart(history);
            }
          }
        } catch(e) { console.warn('Post-refresh snapshot error:', e); }
      }, 500);const lrb=document.getElementById('lastRefreshedBar');const lrt=document.getElementById('lastRefreshedTime');if(lrb&&lrt){lrt.textContent=new Date().toLocaleTimeString('en-AU',{hour:'2-digit',minute:'2-digit'});lrb.style.display='block';}}catch(e){console.warn('refreshAll error:',e);}finally{btn.disabled=false;icon.classList.remove('spin');}}

function renderAllHoldings(){
  const body=document.getElementById('allHoldingsB');if(!body)return;
  const showAud=document.getElementById('audToggle').checked;const r=S.audUsd;const allRows=[];const ro=isReadOnly();
  const TYPE_BADGE={us:'<span class="badge b-blue" style="font-size:9px;">US</span>',asx:'<span class="badge b-green" style="font-size:9px;">ASX</span>',cry:'<span class="badge b-amber" style="font-size:9px;">Crypto</span>',met:'<span class="badge b-gray" style="font-size:9px;">Metal</span>'};
  ['us','asx','cry','met'].forEach(type=>{S[type].forEach((item,i)=>{const priceKey=type+':'+item.ticker;const p=S.prices[priceKey];const price=p?p.price:null;const chg=p?p.change:null;let val=price!==null?price*item.qty:null;if(type==='us'&&price!==null&&showAud)val=val/r;const hasCost=item.cost&&item.cost>0;let gl=null,glPct=null;if(hasCost&&val!==null){const tc=item.cost*item.qty;gl=val-tc;glPct=tc>0?(gl/tc)*100:0;}const cc=chg>0?'pos':chg<0?'neg':'';const cs=chg!==null?(chg>0?'+':'')+f(chg,2)+'%':'—';const isF=type==='cry'||type==='met';const txCount=(item.txns||[]).length;const txBadge=txCount>0?` <span style="font-size:10px;color:var(--text4);">${txCount} trade${txCount>1?'s':''}</span>`:'';const costDisp=item.cost>0?item.cost:'';const isOpen=openDrawer===type+':'+i;const drawerHtml=isOpen?buildDrawer(type,i,item,showAud,r):'';let dp=price;if(type==='us'&&price!==null&&showAud)dp=price/r;const tileClass={us:'tkr-us',asx:'tkr-asx',cry:'tkr-cry',met:'tkr-met'}[type]||'';const rowClass={us:'hrow-us',asx:'hrow-asx',cry:'hrow-cry',met:'hrow-met'}[type]||'';const valAUD=val||0;// Mini sparkline path (simple up/down visual based on 24h change)
    const sparkColor=chg>0?'#10b981':chg<0?'#f43f5e':'#475569';
    const sparkD=chg>0?'M0,14 L10,11 L20,9 L30,7 L40,5 L50,4':chg<0?'M0,4 L10,6 L20,9 L30,11 L40,13 L50,14':'M0,9 L10,8 L20,10 L30,9 L40,8 L50,9';
    const glVal=gl!==null&&!isNaN(gl)?`<span class="${gl>=0?'gain-pos':'gain-neg'}" style="font-family:var(--mono);font-size:12px;">${gl>=0?'+':'-'}$${f(Math.abs(gl))}</span>`:'<span class="dim">—</span>';
    allRows.push({valAUD,html:`<tr class="holding-row ${rowClass}${isOpen?' open':''}" onclick="toggleDrawer('${type}',${i})">
      <td><div class="tkr-cell"><div class="tkr-tile ${tileClass}">${item.ticker.slice(0,2).toUpperCase()}</div><div class="tkr-info"><div class="tkr-sym">${item.ticker}</div><div class="tkr-name">${item.name}</div></div></div></td>
      <td class="mob-hide">${TYPE_BADGE[type]||''}</td>
      <td class="r" style="font-family:var(--mono);font-size:12px;">${item.qty%1===0?f(item.qty,0):f(item.qty,4)}</td>
      <td class="r" style="font-family:var(--mono);font-size:12px;">${price!==null?'$'+f(dp):'<span class="dim">—</span>'}</td>
      <td class="r" style="font-family:var(--mono);font-size:13px;font-weight:500;">${val!==null?'$'+f(type==='us'&&showAud?val/r:val):'<span class="dim">—</span>'}</td>
      <td class="r mob-hide">${chg!==null?`<span class="gl-chip ${chg>=0?'gl-pos':'gl-neg'}">${chg>=0?'+':''}${f(chg,2)}%</span>`:'<span class="dim">—</span>'}</td>
      <td class="r mob-hide">${glVal}</td>
      <td class="r mob-hide" style="width:60px;"><svg width="52" height="18" viewBox="0 0 52 18" preserveAspectRatio="none"><path d="${sparkD}" fill="none" stroke="${sparkColor}" stroke-width="1.5" stroke-linecap="round"/></svg></td>
      <td><button class="del" onclick="event.stopPropagation();delA('${type}',${i})" ${ro?'disabled':''}>✕</button></td>
    </tr>${drawerHtml?`<tr class="tx-row"><td colspan="9">${drawerHtml}</td></tr>`:''}`});});});
  allRows.sort((a,b)=>b.valAUD-a.valAUD);
  body.innerHTML=allRows.length?allRows.map(r=>r.html).join(''):'<tr><td colspan="10" style="text-align:center;color:var(--text4);padding:20px;">No holdings yet — tap + Add to get started</td></tr>';
  const dot=document.getElementById('allDot');if(dot)dot.className='dot '+(Object.keys(S.prices).length>0?'dot-live':'dot-stale');
  const allTotal=allRows.reduce((s,row)=>s+row.valAUD,0);const totEl=document.getElementById('allSecTot');if(totEl)totEl.textContent=allTotal>0?'$'+f(allTotal)+' AUD':'';
  setTimeout(applyRowTints,50);
}
