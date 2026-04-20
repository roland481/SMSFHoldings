// ══════════════════════════════════════════════════════════════
// ── APP INIT, EVENTS, THEME & UTILITIES ──────────────────────
// ══════════════════════════════════════════════════════════════
function animateValue(el,newVal,prefix='$',decimals=2){if(!el)return;const raw=el.getAttribute('data-raw');const oldVal=raw?parseFloat(raw):null;el.setAttribute('data-raw',newVal);if(oldVal===null||isNaN(oldVal)||oldVal===newVal){el.textContent=prefix+f(newVal,decimals);return;}const dir=newVal>oldVal?'up':'down';el.classList.remove('flash-up','flash-down');void el.offsetWidth;el.classList.add('flash-'+dir);setTimeout(()=>el.classList.remove('flash-up','flash-down'),1200);const duration=600,steps=30,increment=(newVal-oldVal)/steps;let current=oldVal,step=0;const timer=setInterval(()=>{step++;current+=increment;if(step>=steps){current=newVal;clearInterval(timer);}el.textContent=prefix+f(current,decimals);},duration/steps);}

function updateSessions(){
  const el=document.getElementById('sessions');if(!el)return;
  const now=new Date();
  const dayUTC=now.getUTCDay(); // 0=Sun,6=Sat
  const hAEST=((now.getUTCHours()+10)%24);
  const hAEDT=((now.getUTCHours()+11)%24);
  const isWeekend=dayUTC===0||dayUTC===6;
  // ASX: 10:00-16:10 AEDT (UTC+11) Mon-Fri
  const asxOpen=!isWeekend&&hAEDT>=10&&hAEDT<16||(hAEDT===16&&now.getUTCMinutes()<10);
  // NYSE: 9:30-16:00 ET. ET is UTC-5 (EST) or UTC-4 (EDT). Approx: UTC 14:30-21:00
  const hUTC=now.getUTCHours(),mUTC=now.getUTCMinutes();
  const nyseMinUTC=hUTC*60+mUTC;
  const nyseOpen=!isWeekend&&nyseMinUTC>=870&&nyseMinUTC<1260; // 14:30-21:00 UTC
  // LSE: 8:00-16:30 GMT Mon-Fri
  const lseOpen=!isWeekend&&hUTC>=8&&(hUTC<16||(hUTC===16&&mUTC<30));
  // Crypto: always open
  function minsUntil(targetH,targetM,currentH,currentM){
    const cur=currentH*60+currentM;const tgt=targetH*60+targetM;
    return tgt>cur?tgt-cur:1440-(cur-tgt);
  }
  function fmt(mins){const h=Math.floor(mins/60);const m=mins%60;return h>0?h+'h '+m+'m':m+'m';}
  // Countdown strings (desktop only)
  const isDesktop=window.innerWidth>800;
  function pill(label,open,openInMins,closeInMins){
    const dot=open?'<span style="width:5px;height:5px;border-radius:50%;background:var(--gain-pos);box-shadow:0 0 5px rgba(93,227,108,0.5);display:inline-block;flex-shrink:0;"></span>':'<span style="width:5px;height:5px;border-radius:50%;background:var(--text4);display:inline-block;flex-shrink:0;"></span>';
    let timer='';
    if(isDesktop){
      if(open&&closeInMins!=null)timer=`<span style="font-size:9px;color:#5de36c;margin-left:4px;">closes ${fmt(closeInMins)}</span>`;
      else if(!open&&openInMins!=null)timer=`<span style="font-size:9px;color:var(--text2);margin-left:4px;opacity:0.8;">opens ${fmt(openInMins)}</span>`;
    }
    const cls=open?'session-pill session-open':'session-pill';
    return`<div class="${cls}" style="display:flex;align-items:center;gap:5px;">${dot}<span>${label}</span>${timer}</div>`;
  }
  // ASX countdown
  let asxOpenIn=null,asxCloseIn=null;
  if(!asxOpen){const hNow=hAEDT,mNow=now.getUTCMinutes();asxOpenIn=minsUntil(10,0,hNow,mNow);}
  else{const hNow=hAEDT,mNow=now.getUTCMinutes();asxCloseIn=minsUntil(16,10,hNow,mNow);}
  // NYSE countdown
  let nyseOpenIn=null,nyseCloseIn=null;
  if(!nyseOpen){nyseOpenIn=minsUntil(14,30,hUTC,mUTC);}
  else{nyseCloseIn=minsUntil(21,0,hUTC,mUTC);}
  // LSE countdown
  let lseOpenIn=null,lseCloseIn=null;
  if(!lseOpen){lseOpenIn=minsUntil(8,0,hUTC,mUTC);}
  else{lseCloseIn=minsUntil(16,30,hUTC,mUTC);}
  el.innerHTML=pill('ASX',asxOpen,asxOpenIn,asxCloseIn)+pill('NYSE',nyseOpen,nyseOpenIn,nyseCloseIn)+pill('LSE',lseOpen,lseOpenIn,lseCloseIn)+'<div class="session-pill session-open" style="display:flex;align-items:center;gap:5px;"><span style="width:5px;height:5px;border-radius:50%;background:var(--gain-pos);box-shadow:0 0 5px rgba(93,227,108,0.5);display:inline-block;flex-shrink:0;"></span><span>₿ Crypto 24/7</span></div>';
}
function applyRowTints(){document.querySelectorAll('tr.holding-row').forEach(tr=>{const changeCell=[...tr.querySelectorAll('td')].find(td=>td.classList.contains('pos')||td.classList.contains('neg'));if(!changeCell)return;tr.classList.remove('tint-up','tint-down');if(changeCell.classList.contains('pos'))tr.classList.add('tint-up');else if(changeCell.classList.contains('neg'))tr.classList.add('tint-down');});}

function openMobileSidebar(){document.getElementById('sidebar').classList.add('mobile-open');document.getElementById('sidebarOverlay').classList.add('visible');document.body.style.overflow='hidden';}
function closeMobileSidebar(){document.getElementById('sidebar').classList.remove('mobile-open');document.getElementById('sidebarOverlay').classList.remove('visible');document.body.style.overflow='';}
function toggleSidebar(){const sb=document.getElementById('sidebar');const collapsed=sb.classList.toggle('collapsed');localStorage.setItem('smsf_sb_collapsed',collapsed?'1':'0');if(pieChart)setTimeout(()=>pieChart.resize(),280);if(historyChart)setTimeout(()=>historyChart.resize(),280);}

function switchTab(name){
  document.querySelectorAll('.tab-btn').forEach((b,i)=>{const tabs=['portfolio','fees','watchlist','import'];b.classList.toggle('active',tabs[i]===name);});
  ['portfolio','fees','cgt','watchlist','import'].forEach(t=>{const sb=document.getElementById('sb-'+t);if(sb)sb.classList.toggle('active',t===name);const bn=document.getElementById('bn-'+t);if(bn)bn.classList.toggle('active',t===name);const nl=document.getElementById('nl-'+t);if(nl)nl.classList.toggle('active',t===name);});
  document.querySelectorAll('.tab-panel').forEach(p=>{p.classList.toggle('active',p.id==='tab-'+name);});
  const addBtn=document.getElementById('topbarAddBtn');if(addBtn)addBtn.style.display=(name==='watchlist'||name==='import')?'none':'';
  if(name==='fees')setTimeout(()=>{try{renderFees();}catch(e){}},30);
  if(name==='portfolio'){try{renderCash();}catch(e){}if(pieChart)setTimeout(()=>pieChart.resize(),50);if(historyChart)setTimeout(()=>historyChart.resize(),50);}
  closeMobileSidebar();
}


// ── Delegated events ──────────────────────────────────────────
document.addEventListener('click',function(e){
  const el=e.target.closest('[data-action]');if(!el)return;
  const action=el.getAttribute('data-action');
  switch(action){
    case 'toggleSidebar':      toggleSidebar();break;
    case 'openAddModal':       openAddModal();break;
    case 'closeAddModal':      closeAddModal();break;
    case 'closeModalOverlay':  if(e.target===el)closeAddModal();break;
    case 'closeAccessModal':   if(e.target===el||e.target.closest('[data-action="closeAccessModal"]'))closeAccessModal();break;
    case 'submitAddModal':     submitAddModal();break;
    case 'refreshAll':         refreshAll();break;
    case 'exportCSV':          exportCSV();break;
    case 'openMobileSidebar':  openMobileSidebar();break;
    case 'closeMobileSidebar': closeMobileSidebar();break;
    case 'showFeesAdd':        showFeesAdd();break;
    case 'hideFeesAdd':        hideFeesAdd();break;
    case 'addFee':             addFee();break;
    case 'showWlAdd':          showWlAdd();break;
    case 'hideWlAdd':          hideWlAdd();break;
    case 'addWl':              addWl();break;
    case 'switchTab':          switchTab(el.getAttribute('data-tab'));break;
    case 'setSmartMode':       setSmartMode(el.getAttribute('data-mode'));break;
    case 'setSmartCategory':   setSmartCategory(el.getAttribute('data-cat'));break;
    case 'openAccessModal':    openAccessModal();break;
  }
});
document.addEventListener('input',function(e){if(e.target.id==='modal-smart-ticker')onSmartTickerInput(e.target.value);});
document.addEventListener('change',function(e){if(e.target.id==='audToggle'){['us','asx','cry','met','cash','fees','wl'].forEach(t=>rows(t));renderAllHoldings();}if(e.target.id==='modal-txn-side'){const lbl=document.getElementById('modal-txn-acct-label');if(lbl)lbl.textContent=e.target.value==='buy'?'Deduct from cash account':'Credit to cash account';}});

// ── Login on Enter key ────────────────────────────────────────
document.getElementById('loginPassword').addEventListener('keydown', e => { if(e.key==='Enter') doLogin(); });
document.getElementById('loginEmail').addEventListener('keydown', e => { if(e.key==='Enter') document.getElementById('loginPassword').focus(); });

// ── Mobile swipe ──────────────────────────────────────────────
(function(){const TABS=['portfolio','fees','watchlist','import'];let touchStartX=0,touchStartY=0,touchStartTime=0;document.addEventListener('touchstart',e=>{if(e.target.closest('.tbl-wrap,.modal,.sidebar'))return;touchStartX=e.touches[0].clientX;touchStartY=e.touches[0].clientY;touchStartTime=Date.now();},{passive:true});document.addEventListener('touchend',e=>{if(!touchStartX)return;const dx=e.changedTouches[0].clientX-touchStartX;const dy=e.changedTouches[0].clientY-touchStartY;const dt=Date.now()-touchStartTime;touchStartX=0;if(Math.abs(dx)<60)return;if(Math.abs(dy)>80)return;if(dt>400)return;if(Math.abs(dy)>Math.abs(dx))return;const cur=TABS.find(t=>{const el=document.getElementById('tab-'+t);return el&&el.classList.contains('active');})||'portfolio';const idx=TABS.indexOf(cur);if(dx<0&&idx<TABS.length-1)switchTab(TABS[idx+1]);if(dx>0&&idx>0)switchTab(TABS[idx-1]);},{passive:true});})();


// ══════════════════════════════════════════════════════════════
// ── THEME SYSTEM ─────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════
function applyTheme(theme) {
  theme = theme || 'dark';
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('smsf_theme', theme);
  const isDark = theme !== 'light';
  const icon = document.getElementById('themeToggleIcon');
  const label = document.getElementById('themeToggleLabel');
  const pill = document.getElementById('themeTogglePill');
  const mobileIcon = document.getElementById('mobileThemeIcon');
  const mobilePill = document.getElementById('mobileThemeToggle');
  if (icon) icon.textContent = isDark ? '🌙' : '☀️';
  if (label) label.textContent = isDark ? 'Dark mode' : 'Light mode';
  if (pill) pill.style.justifyContent = isDark ? 'flex-end' : 'flex-start';
  if (mobileIcon) mobileIcon.textContent = isDark ? '🌙' : '☀️';
  if (mobilePill) mobilePill.style.justifyContent = isDark ? 'flex-end' : 'flex-start';
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) metaTheme.setAttribute('content', isDark ? '#080d17' : '#f0f5fc');
  if (typeof pieChart !== 'undefined' && pieChart) setTimeout(() => {
    try {
      const isL = theme === 'light';
      pieChart.data.datasets[0].borderColor = isL ? 'rgba(240,245,252,0.8)' : 'rgba(8,13,23,0.8)';
      pieChart.update();
    } catch(e) {}
  }, 50);
  // Theme switch: update chart colors in-place rather than destroy/rebuild
  if (typeof historyChart !== 'undefined' && historyChart) {
    setTimeout(() => {
      try {
        const isLight = theme === 'light';
        const gridColor = isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.06)';
        const textColor = isLight ? '#999' : '#444';
        const lineColor = isLight ? '#0099cc' : '#00d4ff';
        historyChart.data.datasets[0].borderColor = lineColor;
        historyChart.options.scales.x.grid.color = gridColor;
        historyChart.options.scales.x.ticks.color = textColor;
        historyChart.options.scales.y.grid.color = gridColor;
        historyChart.options.scales.y.ticks.color = textColor;
        historyChart.update('none'); // 'none' = no animation, preserves data
      } catch(e) {
        // Only fall back to full rebuild if update fails
        try { historyChart.destroy(); historyChart = null; renderHistoryChart(S.snapshots||null); } catch(e2) {}
      }
    }, 50);
  }
  setTimeout(() => { try { renderSparklines(); } catch(e) {} }, 100);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  applyTheme(current === 'light' ? 'dark' : 'light');
}

function initTheme() {
  const saved = localStorage.getItem('smsf_theme') || 'dark';
  applyTheme(saved);
}



async function reverseTxn(type, i, ti) {
  if(isReadOnly()) return;
  if(!confirm('Reverse this transaction? This will remove it from your history and recalculate your holding.')) return;
  const item = S[type][i];
  const tx = item.txns[ti];
  if(!tx) return;
  const xanoId = tx._id;
  // Remove from local state
  item.txns.splice(ti, 1);
  recalcFromTxns(type, i);
  try {
    // Update holding in Xano with new qty/cost
    await xanoUpdateHolding(type, i);
    // Delete the transaction from Xano
    if(xanoId) await xanoDeleteTransaction(xanoId);
    // Reverse cash account effect if applicable
    if(tx.cashAcct != null && S.cash[tx.cashAcct]) {
      const tradeTotal = tx.qty * tx.price;
      const withFee = tx.fee > 0 ? tradeTotal + tx.fee : tradeTotal;
      // Undo the original debit/credit
      S.cash[tx.cashAcct].balance = (S.cash[tx.cashAcct].balance || 0) + (tx.side === 'buy' ? withFee : -withFee);
      await xanoUpdateCash(tx.cashAcct);
      renderCash();
    }
    syncUI('synced', 'Transaction reversed');
  } catch(e) {
    // Rollback local state
    item.txns.splice(ti, 0, tx);
    recalcFromTxns(type, i);
    syncUI('err', 'Reverse failed: ' + e.message);
  }
  rows(type); renderAllHoldings(); renderFees();
}

function updateSwapTotal(){
  const fromAud=parseFloat(document.getElementById('modal-swap-from-aud')?.value)||0;
  const toAud=parseFloat(document.getElementById('modal-swap-to-aud')?.value)||0;
  const fee=parseFloat(document.getElementById('modal-swap-fee')?.value)||0;
  const totalEl=document.getElementById('modal-swap-total');
  const sellEl=document.getElementById('modal-swap-sell-val');
  const buyEl=document.getElementById('modal-swap-buy-val');
  if(!totalEl||!sellEl||!buyEl)return;
  if(fromAud>0||toAud>0){
    totalEl.style.display='block';
    const feeStr=fee>0?' (incl. $'+f(fee)+' fee)':'';
    sellEl.textContent=fromAud>0?'-$'+f(fromAud)+feeStr:'—';
    buyEl.textContent=toAud>0?'+$'+f(toAud):'—';
  } else {
    totalEl.style.display='none';
  }
}

function updateSaleTotal(){
  const qty=parseFloat(document.getElementById('modal-sale-qty')?.value)||0;
  const price=parseFloat(document.getElementById('modal-sale-price')?.value)||0;
  const fee=parseFloat(document.getElementById('modal-sale-fee')?.value)||0;
  const totalEl=document.getElementById('modal-sale-total');
  const totalValEl=document.getElementById('modal-sale-total-val');
  if(!totalEl||!totalValEl)return;
  if(qty>0&&price>0){
    const net=qty*price-fee;
    totalEl.style.display='flex';
    totalValEl.textContent='+$'+f(net)+(fee>0?' (after $'+f(fee)+' fee)':'');
  } else {
    totalEl.style.display='none';
  }
}

function updateNewHoldingTotal(){
  const qty=parseFloat(document.getElementById('modal-qty')?.value)||0;
  const cost=parseFloat(document.getElementById('modal-cost')?.value)||0;
  const fee=parseFloat(document.getElementById('modal-new-fee')?.value)||0;
  const totalEl=document.getElementById('modal-new-total');
  const totalValEl=document.getElementById('modal-new-total-val');
  if(!totalEl||!totalValEl)return;
  if(qty>0&&cost>0){
    const total=qty*cost+fee;
    totalEl.style.display='flex';
    totalValEl.textContent='-$'+f(total)+(fee>0?' (incl. $'+f(fee)+' fee)':'');
  } else {
    totalEl.style.display='none';
  }
}



// ── Universal File Import Handler ────────────────────────────
function initImportDropZone(){
  const zone=document.getElementById('importDropZone');
  if(!zone)return;
  zone.addEventListener('dragover',e=>{e.preventDefault();zone.classList.add('drag-over');});
  zone.addEventListener('dragleave',e=>{zone.classList.remove('drag-over');});
  zone.addEventListener('drop',e=>{
    e.preventDefault();
    zone.classList.remove('drag-over');
    const files=e.dataTransfer?.files;
    if(files&&files[0])routeImportFile(files[0]);
  });
}

function handleUniversalImport(input){
  if(input.files&&input.files[0])routeImportFile(input.files[0]);
  input.value='';
}

async function routeImportFile(file){
  const statusArea=document.getElementById('importStatusArea');
  statusArea.style.display='block';
  statusArea.style.background='var(--surface2)';
  statusArea.style.color='var(--text3)';
  statusArea.innerHTML='<span style="opacity:0.7;">🔍 Detecting file type...</span>';

  const name=file.name.toLowerCase();
  const isCSV=file.type==='text/csv'||name.endsWith('.csv');
  const isHTML=name.endsWith('.htm')||name.endsWith('.html')||file.type==='text/html';

  if(isCSV){
    const text=await file.text();
    const lines=text.split('\n').slice(0,5).map(l=>l.toLowerCase());
    const allText=lines.join(' ');
    const isSwyftx=allText.includes('uuid')||allText.includes('swyftx')||
                   allText.includes('crypto transactions')||allText.includes('transaction id')||
                   (allText.includes('asset')&&allText.includes('event'));
    if(isSwyftx){
      statusArea.innerHTML='<span>📊 Detected: <strong>Swyftx Transaction CSV</strong> — importing...</span>';
      await importSwyftxCSVText(text,statusArea);
    } else {
      statusArea.style.background='rgba(248,113,113,0.1)';
      statusArea.style.color='var(--gain-neg)';
      statusArea.innerHTML='⚠ Could not detect file format. Expected a Swyftx Transaction Report CSV.';
    }
    return;
  }

  if(isHTML){
    const text=await file.text();
    const lower=text.toLowerCase();
    const isCommsecHTML=lower.includes('trade confirmation report')||lower.includes('commonwealth securities')||
                        lower.includes('commsec')||(lower.includes('interactive brokers')&&lower.includes('stocks'));
    if(isCommsecHTML){
      statusArea.innerHTML='<span>📄 Detected: <strong>CommSec International Trade Confirmation</strong> — importing...</span>';
      await importCommsecIntlHTML(text,statusArea);
    } else {
      statusArea.style.background='rgba(248,113,113,0.1)';
      statusArea.style.color='var(--gain-neg)';
      statusArea.innerHTML='⚠ Could not detect file format. Expected a CommSec International Trade Confirmation HTML file.';
    }
    return;
  }

  statusArea.style.background='rgba(248,113,113,0.1)';
  statusArea.style.color='var(--gain-neg)';
  statusArea.innerHTML='⚠ Unsupported file type. Please upload a Swyftx CSV or CommSec International HTML file.';
}

function setImportStatus(el,type,msg){
  if(!el)return;
  el.style.display='block';
  if(type==='success'){el.style.background='rgba(93,227,108,0.1)';el.style.color='var(--gain-pos)';}
  else if(type==='error'){el.style.background='rgba(248,113,113,0.1)';el.style.color='var(--gain-neg)';}
  else{el.style.background='var(--surface2)';el.style.color='var(--text3)';}
  el.innerHTML=msg;
}




// ── Boot ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async function(){
  { const _td = document.getElementById('todayDate'); if (_td) _td.textContent = new Date().toLocaleDateString('en-AU',{weekday:'short',day:'numeric',month:'long',year:'numeric'}); }
  initTheme();
  initImportDropZone();
  function updateSidebarMode(){const sb=document.getElementById('sidebar');if(window.innerWidth>800){sb.classList.add('desktop-visible');sb.classList.remove('mobile-open');document.getElementById('sidebarOverlay').classList.remove('visible');document.body.style.overflow='';}else{sb.classList.remove('desktop-visible');}}
  updateSidebarMode();window.addEventListener('resize',updateSidebarMode);
  if(localStorage.getItem('smsf_sb_collapsed')==='1')document.getElementById('sidebar').classList.add('collapsed');
  renderHistoryChart();
  // Force chart line to cyan after charts.js creates it with its default colour
  setTimeout(function() {
    try {
      if (typeof historyChart !== 'undefined' && historyChart) {
        const isLight = (localStorage.getItem('smsf_theme') || 'dark') === 'light';
        historyChart.data.datasets[0].borderColor = isLight ? '#0099cc' : '#00d4ff';
        historyChart.data.datasets[0].backgroundColor = isLight ? 'rgba(0,153,204,0.08)' : 'rgba(0,212,255,0.07)';
        historyChart.update('none');
      }
    } catch(e) {}
  }, 200);
  updateSessions();
  setInterval(updateSessions,30000);

  // Auto-login if token exists
  const token = getToken();
  if (token) {
    try {
      await bootApp();
    } catch(e) {
      clearToken();
      // Show login screen (already visible by default)
    }
  }
  // If no token, login screen is shown by default (not hidden)
});
function _cashName(idx){
  if(idx==null||idx===''||idx===undefined)return'';
  const i=parseInt(idx);
  if(isNaN(i)||!S.cash[i])return'';
  return S.cash[i].name||'';
}

function exportCSV(){
  const fyVal=document.getElementById('fyFilter')?.value;
  const acctVal=document.getElementById('ledgerAccountFilter')?.value;
  function inFY(dateStr){
    if(!fyVal||!dateStr)return true;
    const y=parseInt(dateStr.slice(0,4));const m=parseInt(dateStr.slice(5,7));
    const fy=m>=7?y+1:y;return fy==parseInt(fyVal);
  }
  function matchAcct(e){
    if(!acctVal)return true;
    return String(e.cashAcct)===acctVal||String(e.from)===acctVal||String(e.to)===acctVal;
  }
  // Build flat entry list (same as renderFees) so nothing is missed
  const entries=[];
  ['us','asx','cry','met'].forEach(type=>{S[type].forEach(h=>{(h.txns||[]).forEach(tx=>{
    const acct=_cashName(tx.cashAcct);
    const acctIdx=tx.cashAcct!=null?tx.cashAcct:null;
    const total=tx.price*tx.qty;
    const audTotal=parseFloat(total.toFixed(2));
    entries.push({date:tx.date||'',type:'trade',cat:h.ticker,desc:h.name+' '+tx.side,amount:(tx.side==='buy'?-1:1)*audTotal,acct,acctIdx,txnId:tx.txnId||''});
    if(tx.fee>0)entries.push({date:tx.date||'',type:'fee',cat:'brokerage',desc:'Brokerage — '+h.ticker+' '+tx.side,amount:-tx.fee,acct,acctIdx,txnId:(tx.txnId||'')+'-FEE'});
  });});});
  S.fees.filter(e=>inFY(e.date)&&matchAcct(e)).forEach(e=>{const acct=_cashName(e.cashAcct);entries.push({date:e.date||'',type:'fee',cat:e.cat||'',desc:e.desc,amount:-e.amount,acct,acctIdx:e.cashAcct,txnId:e.txnId||''});});
  S.income.filter(e=>inFY(e.date)&&matchAcct(e)).forEach(e=>{const acct=_cashName(e.cashAcct);entries.push({date:e.date||'',type:'income',cat:e.type||'',desc:e.source||'',amount:e.amount,acct,acctIdx:e.cashAcct,txnId:e.txnId||''});});
  S.contributions.filter(e=>inFY(e.date)&&matchAcct(e)).forEach(e=>{const acct=_cashName(e.cashAcct);entries.push({date:e.date||'',type:'contribution',cat:e.type||'',desc:e.member||'',amount:e.amount,acct,acctIdx:e.cashAcct,txnId:e.txnId||''});});
  S.transfers.filter(e=>inFY(e.date)&&matchAcct(e)).forEach(e=>{
    const fromAcct=_cashName(e.from);
    const toAcct=_cashName(e.to);
    entries.push({date:e.date||'',type:'transfer',cat:'',desc:'Transfer to '+toAcct+(e.desc?' — '+e.desc:''),amount:-e.amount,acct:fromAcct,acctIdx:e.from,txnId:e.txnId||''});
    entries.push({date:e.date||'',type:'transfer',cat:'',desc:'Transfer from '+fromAcct+(e.desc?' — '+e.desc:''),amount:e.amount,acct:toAcct,acctIdx:e.to,txnId:e.txnId||''});
  });
  // Filter by FY then sort by date
  const filtered=entries.filter(e=>inFY(e.date)).sort((a,b)=>new Date(a.date)-new Date(b.date));
  // If exporting all accounts: group by account with running balance per account
  // If filtering by account: single sheet with running balance
  const allCsvParts=[];
  const accountGroups=acctVal
    ? [{name:S.cash[parseInt(acctVal)]?.name||'Account',idx:parseInt(acctVal),rows:filtered.filter(e=>String(e.acctIdx)===acctVal)}]
    : (() => {
        // Group: trades/fees with no cash account go into "All transactions" 
        const groups=[{name:'All Transactions',idx:null,rows:filtered}];
        S.cash.forEach((ca,i)=>{
          const acctRows=filtered.filter(e=>String(e.acctIdx)===String(i)||e.type==='trade');
          if(acctRows.length)groups.push({name:ca.name,idx:i,rows:filtered.filter(e=>String(e.acctIdx)===String(i))});
        });
        return groups;
      })();
  // Build CSV - one section per account group separated by blank rows
  const header=['Date','Type','Category','Description','Amount (AUD)','Cash Account','Running Balance','TxnID'];
  const csvRows=[header];
  accountGroups.forEach((grp,gi)=>{
    if(gi>0)csvRows.push([],[`=== ${grp.name} ===`]);
    else if(accountGroups.length>1)csvRows.push([`=== ${grp.name} ===`]);
    let balance=grp.idx!=null?S.cash[grp.idx]?.balance||0:null;
    // Walk backwards to get opening balance, then forward for running
    const withBal=grp.rows.map(e=>({...e}));
    if(balance!=null){
      // running balance: start from current balance, work backwards
      let run=balance;
      for(let i=withBal.length-1;i>=0;i--){run-=withBal[i].amount;withBal[i]._opening=parseFloat(run.toFixed(2));}
      let fwd=withBal[0]?._opening||0;
      withBal.forEach(e=>{fwd+=e.amount;e._balance=parseFloat(fwd.toFixed(2));});
    }
    withBal.forEach(e=>{
      csvRows.push([e.date,e.type,e.cat,e.desc,e.amount.toFixed(2),e.acct,balance!=null?e._balance?.toFixed(2)||'':'',e.txnId]);
    });
  });
  const csv=csvRows.map(r=>r.map(v=>'"'+String(v||'').replace(/"/g,'""')+'"').join(',')).join('\n');
  const a=document.createElement('a');a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv);
  const fyLbl=fyVal?'FY'+fyVal:'All';
  a.download='SMSF_'+fyLbl+(acctVal?'_'+(_cashName(acctVal)||'account').replace(/\s+/g,'_'):'')+'_export.csv';
  a.click();
}

function populateFYFilter(){
  const sel=document.getElementById('fyFilter');if(!sel)return;
  const allDates=[...S.fees,...S.income,...S.contributions,...S.transfers].map(e=>e.date).filter(Boolean);
  const fys=new Set();
  allDates.forEach(d=>{
    const y=parseInt(d.slice(0,4));const m=parseInt(d.slice(5,7));
    const fy=m>=7?y+1:y; // FY ends June 30
    fys.add(fy);
  });
  const sorted=[...fys].sort((a,b)=>b-a);
  const cur=sel.value;
  sel.innerHTML='<option value="">All years</option>'+sorted.map(y=>`<option value="${y}" ${cur==y?'selected':''}>FY${y}</option>`).join('');
}

function renderFees(){
  try{
    populateFYFilter();
    const body=document.getElementById('feesB');if(!body)return;
    // Account filter
    const filterEl=document.getElementById('ledgerAccountFilter');
    if(filterEl){const prev=filterEl.value;filterEl.innerHTML='<option value="">All accounts</option>'+S.cash.map((a,i)=>`<option value="${i}">${a.name}</option>`).join('');if(prev&&filterEl.querySelector(`option[value="${prev}"]`))filterEl.value=prev;}
    const selectedAcct=filterEl?filterEl.value:'';const showBalance=selectedAcct!=='';const acctIndex=showBalance?parseInt(selectedAcct):null;
    const balHeader=document.getElementById('balanceColHeader');const balDisplay=document.getElementById('ledgerBalanceDisplay');
    if(balHeader)balHeader.style.display='';if(balDisplay)balDisplay.style.display=showBalance?'flex':'none';
    if(showBalance){const balAmtEl=document.getElementById('ledgerBalanceAmt');if(balAmtEl)balAmtEl.textContent='$'+f(S.cash[acctIndex]?.balance||0)+' AUD';}
    // FY filter
    const fyVal=document.getElementById('fyFilter')?.value||'';
    function inFY(dateStr){
      if(!fyVal||!dateStr)return true;
      const y=parseInt(dateStr.slice(0,4));const m=parseInt(dateStr.slice(5,7));
      const fy=m>=7?y+1:y;return fy===parseInt(fyVal);
    }
    function matchAcct(e){if(!selectedAcct)return true;const s=selectedAcct;return String(e.cashAcct)===s||e.cashAcct===parseInt(s)||String(e.from)===s||String(e.to)===s;}
    // Build entries
    const entries=[];
    S.fees.forEach((item,orig)=>{if(!inFY(item.date)||!matchAcct(item))return;entries.push({date:item.date||'',desc:item.desc||'—',type:'fee',amount:item.amount||0,isDebit:true,orig,deletable:true,txnId:item.txnId||'—',cashAcct:item.cashAcct??null,_id:item._id});});
    (S.income||[]).forEach((item,orig)=>{if(!inFY(item.date)||!matchAcct(item))return;entries.push({date:item.date||'',desc:`${item.type} — ${item.source}${item.franking>0?' (Franking: $'+f(item.franking)+')':''}`,type:'income',amount:item.amount||0,isDebit:false,orig,deletable:true,txnId:item.txnId||'—',cashAcct:item.cashAcct??null,_id:item._id});});
    (S.contributions||[]).forEach((item,orig)=>{if(!inFY(item.date)||!matchAcct(item))return;entries.push({date:item.date||'',desc:`${item.type} contribution — ${item.member}`,type:'contribution',amount:item.amount||0,isDebit:false,orig,deletable:true,txnId:item.txnId||'—',cashAcct:item.cashAcct??null,_id:item._id});});
    (S.transfers||[]).forEach((item,orig)=>{if(!inFY(item.date)||!matchAcct(item))return;const fromName=(()=>{if(item.from==null)return'Unknown';const byIdx=S.cash[item.from];if(byIdx)return byIdx.name;const byId=S.cash.find(c=>c._id===item.from||c._id===parseInt(item.from));return byId?.name||'Unknown';})();
      const toName=(()=>{if(item.to==null)return'Unknown';const byIdx=S.cash[item.to];if(byIdx)return byIdx.name;const byId=S.cash.find(c=>c._id===item.to||c._id===parseInt(item.to));return byId?.name||'Unknown';})();entries.push({date:item.date||'',desc:`Transfer to ${toName}${item.desc?' — '+item.desc:''}`,type:'transfer',amount:item.amount||0,isDebit:true,orig,deletable:true,txnId:item.txnId||'—',cashAcct:item.from,_id:item._id});entries.push({date:item.date||'',desc:`Transfer from ${fromName}${item.desc?' — '+item.desc:''}`,type:'transfer',amount:item.amount||0,isDebit:false,orig,deletable:false,txnId:item.txnId||'—',cashAcct:item.to,_id:item._id});});
    ['us','asx','cry','met'].forEach(assetType=>{S[assetType].forEach((item,assetIdx)=>{(item.txns||[]).forEach((tx,txIdx)=>{if(!inFY(tx.date))return;const total=parseFloat((tx.price*tx.qty).toFixed(2));const audTotal=total;entries.push({date:tx.date||'',desc:`${tx.side==='buy'?'Buy':'Sell'} ${f(tx.qty,tx.qty%1===0?0:4)} ${item.ticker}`,type:'trade',amount:audTotal,isDebit:tx.side==='buy',deletable:false,reversible:true,assetType,assetIdx,txnIdx:txIdx,txnId:tx.txnId||tx.txn_id||'—',cashAcct:tx.cashAcct??null,_txId:tx._id});if(tx.fee>0)entries.push({date:tx.date||'',desc:`Brokerage — ${item.ticker} ${tx.side}`,type:'fee',amount:tx.fee,isDebit:true,deletable:false,txnId:(tx.txnId||'—')+'-FEE',cashAcct:tx.cashAcct??null});});});});
    // Totals
    const fyFees=entries.filter(e=>e.type==='fee'&&e.isDebit).reduce((s,e)=>s+e.amount,0);
    const contribTotal=entries.filter(e=>e.type==='contribution').reduce((s,e)=>s+e.amount,0);
    const totEl=document.getElementById('feesTotal');if(totEl)totEl.textContent='$'+f(fyFees);
    const ctEl=document.getElementById('contribTotal');if(ctEl)ctEl.textContent='$'+f(contribTotal);
    // Filter by account and sort
    entries.sort((a,b)=>new Date(b.date)-new Date(a.date));
    // Running balance
    let running=showBalance?S.cash[acctIndex]?.balance||0:null;
    const filtered=showBalance?entries.filter(e=>matchAcct(e)):entries;
    if(showBalance&&running!==null){let bal=running;filtered.forEach(e=>{e._runningBalance=bal;bal-=(e.isDebit?-1:1)*e.amount;});}
    const TYPE_LABELS={trade:'<span class="badge b-blue" style="font-size:9px;">Trade</span>',fee:'<span class="badge b-red" style="font-size:9px;">Fee</span>',income:'<span class="badge b-green" style="font-size:9px;">Income</span>',contribution:'<span class="badge b-teal" style="font-size:9px;">Contribution</span>',transfer:'<span class="badge b-gray" style="font-size:9px;">Transfer</span>',sale:'<span class="badge b-red" style="font-size:9px;">Sell</span>',swap:'<span class="badge" style="font-size:9px;background:rgba(206,163,80,0.15);color:#cea350;border:1px solid rgba(206,163,80,0.3);">Swap</span>'};
    const ro=isReadOnly();
    body.innerHTML=(filtered.length?filtered.map(e=>{
      const d=e.date?new Date(e.date).toLocaleDateString('en-AU',{day:'2-digit',month:'short',year:'numeric'}):'—';
      const credit=!e.isDebit||e.type==='income'||e.type==='contribution';
      const amtCol=`<span style="color:${credit?'var(--gain-pos)':'var(--gain-neg)'};">${credit?'+':'-'}$${f(e.amount)}</span>`;
      const idDisplay=e.txnId||'—';const idBadge=`<span style="font-size:9px;font-family:monospace;color:var(--text3);border-bottom:1px dashed var(--text4);white-space:nowrap;">${idDisplay.length>16?idDisplay.slice(0,16)+'…':idDisplay}</span>`;
      const balCell=e._runningBalance!=null?`<td class="r" style="font-weight:600;font-size:11px;color:${(e._runningBalance||0)>=0?'var(--gain-pos)':'var(--gain-neg)'};">$${f(Math.abs(e._runningBalance||0))}</td>`:'<td></td>';
      let actions='<span style="color:var(--text4);font-size:10px;">—</span>';
      if(!ro){if(e.reversible&&e.type==='trade')actions=`<button onclick="reverseTxn('${e.assetType}',${e.assetIdx},${e.txnIdx})" style="font-size:10px;font-weight:600;padding:2px 8px;border:1px solid rgba(248,113,113,0.4);border-radius:99px;background:rgba(248,113,113,0.12);color:#f87171;cursor:pointer;font-family:inherit;">↩ Reverse</button>`;else if(e.deletable&&e.type==='income')actions=`<button class="del" style="opacity:1;" onclick="delIncome(${e.orig},${e._id||'null'})">✕</button>`;else if(e.deletable&&e.type==='contribution')actions=`<button class="del" style="opacity:1;" onclick="delContribution(${e.orig},${e._id||'null'})">✕</button>`;else if(e.deletable&&e.type==='transfer')actions=`<button class="del" style="opacity:1;" onclick="delTransfer(${e.orig},${e._id||'null'})">✕</button>`;else if(e.deletable)actions=`<button class="del" style="opacity:1;" onclick="delFee(${e.orig},${e._id||'null'})">✕</button>`;}
      return`<tr><td>${idBadge}</td><td>${d}</td><td>${e.desc}</td><td>${TYPE_LABELS[e.type]||''}</td><td class="r valbold">${amtCol}</td>${balCell}<td style="text-align:right;min-width:90px;">${actions}</td></tr>`;
    }).join(''):`<tr><td colspan="6" style="text-align:center;color:var(--text4);padding:16px;">No transactions yet</td></tr>`);
  }catch(err){console.error('renderFees error:',err);}
}
