// ══════════════════════════════════════════════════════════════
// ── APP STATE & HELPERS ──────────────────────────────────────
// ══════════════════════════════════════════════════════════════
let AUTH = { user: null, portfolios: [], currentPortfolioId: null };

function _txnDateStr(date){const d=date?new Date(date):new Date();const y=d.getFullYear();const m=String(d.getMonth()+1).padStart(2,'0');const day=String(d.getDate()).padStart(2,'0');return`${y}${m}${day}`;}
function _nextSeqForDate(dateStr){let max=0;['us','asx','cry','met'].forEach(t=>{(S[t]||[]).forEach(item=>{(item.txns||[]).forEach(tx=>{if(tx.txnId&&tx.txnId.startsWith('TXN-'+dateStr+'-')){const n=parseInt(tx.txnId.split('-')[2])||0;if(n>max)max=n;}});});});(S.fees||[]).forEach(fe=>{if(fe.txnId&&fe.txnId.startsWith('TXN-'+dateStr+'-')){const n=parseInt(fe.txnId.split('-')[2])||0;if(n>max)max=n;}});return String(max+1).padStart(3,'0');}
function generateTxnId(date){const ds=_txnDateStr(date);const seq=_nextSeqForDate(ds);return`TXN-${ds}-${seq}`;}

/* syncUI — routes to the fixed bottom-right toast, never the topbar */
let _syncToastTimer=null;
function syncUI(state,msg){
  const toast=document.getElementById('syncToast');
  const dot=toast&&toast.querySelector('.st-dot');
  const txt=document.getElementById('syncToastMsg');
  if(!toast)return;
  toast.className='';
  void toast.offsetWidth; /* reflow to restart transition */
  toast.classList.add('show',state);
  if(txt)txt.textContent=msg||'';
  clearTimeout(_syncToastTimer);
  if(state==='synced'||state==='err'){
    _syncToastTimer=setTimeout(()=>{toast.classList.remove('show');},3000);
  }
}
function f(n,d=2){if(n===null||n===undefined||isNaN(n))return'—';return n.toLocaleString('en-AU',{minimumFractionDigits:d,maximumFractionDigits:d});}
function glChip(gl,pct){if(gl===null||isNaN(gl))return'<span class="gl-chip gl-neu">No cost set</span>';const cls=gl>0?'gl-pos':gl<0?'gl-neg':'gl-neu';const sign=gl>=0?'+':'';return`<span class="gl-chip ${cls}">${sign}$${f(Math.abs(gl))} (${sign}${f(pct,1)}%)</span>`;}

let openDrawer=null;
