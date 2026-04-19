// ── Auth token storage helpers ────────────────────────────────
function getToken()     { return localStorage.getItem('smsf_token') || sessionStorage.getItem('smsf_token'); }
function setToken(t, remember) {
  if (remember) localStorage.setItem('smsf_token', t);
  else          sessionStorage.setItem('smsf_token', t);
}
function clearToken()   { localStorage.removeItem('smsf_token'); sessionStorage.removeItem('smsf_token'); }
function authHeaders()  { return { 'Content-Type':'application/json', 'Authorization': `Bearer ${getToken()}` }; }

// ── Xano API wrapper ──────────────────────────────────────────
async function xano(method, path, body) {
  const opts = { method, headers: authHeaders() };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(XANO_BASE + path, opts);
  if (r.status === 401) { doLogout(); throw new Error('Unauthorized'); }
  if (!r.ok) { const e = await r.json().catch(()=>({})); throw new Error(e.message || 'HTTP ' + r.status); }
  return r.json();
}

// ══════════════════════════════════════════════════════════════
// ── AUTH STATE ────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════

function isReadOnly() {
  if (!AUTH.user) return true;
  if (AUTH.user.role === 'readonly') return true;
  // Check portfolio-level permission
  const p = AUTH.portfolios.find(p => p.id === AUTH.currentPortfolioId);
  return p && p._permission === 'readonly';
}

function applyRoleUI() {
  const ro = isReadOnly();
  document.getElementById('readonlyNotice').classList.toggle('show', ro);
  document.querySelectorAll('.write-only').forEach(el => {
    el.disabled = ro;
    el.style.opacity = ro ? '0.35' : '';
    el.style.pointerEvents = ro ? 'none' : '';
  });
  document.querySelectorAll('.ni').forEach(el => el.disabled = ro);
  document.querySelectorAll('.del').forEach(el => el.disabled = ro);
  // Admin UI
  const isAdmin = AUTH.user?.role === 'admin';
  document.querySelectorAll('.admin-only').forEach(el => el.style.display = isAdmin ? '' : 'none');
}

// ── Login / Logout ────────────────────────────────────────────
async function doLogin() {
  const email    = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const remember = document.getElementById('loginRemember').checked;
  const err      = document.getElementById('loginErr');
  const btn      = document.getElementById('loginBtn');

  if (!email || !password) { showLoginErr('Please enter your email and password.'); return; }
  btn.disabled = true; btn.textContent = 'Signing in...'; err.classList.remove('show');

  try {
    const data = await fetch(XANO_BASE + '/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    }).then(r => { if (!r.ok) throw new Error('Invalid email or password.'); return r.json(); });

    setToken(data.authToken, remember);
    await bootApp();
  } catch(e) {
    showLoginErr(e.message || 'Sign in failed — check your credentials.');
    btn.disabled = false; btn.textContent = 'Sign in';
  }
}

function showLoginErr(msg) {
  const el = document.getElementById('loginErr');
  el.textContent = msg; el.classList.add('show');
}

function doLogout() {
  clearToken();
  clearInactivityTimer();
  AUTH = { user: null, portfolios: [], currentPortfolioId: null };
  S.us=[]; S.asx=[]; S.cry=[]; S.met=[]; S.cash=[]; S.fees=[];
  S.income=[]; S.contributions=[]; S.transfers=[]; S.wl=[];
  document.getElementById('loginScreen').classList.remove('hidden');
  document.getElementById('userBadge').style.display = 'none';
  document.getElementById('loginPassword').value = '';
  document.getElementById('loginBtn').disabled = false;
  document.getElementById('loginBtn').textContent = 'Sign in';
  document.getElementById('loginErr').classList.remove('show');
  closeUserDropdown();
}

async function bootApp() {
  // Load current user
  AUTH.user = await xano('GET', '/auth/me');

  // Update user badge — just show initials in the amber circle
  const badge   = document.getElementById('userBadge');
  const avatar  = document.getElementById('userAvatar');
  const initials = (AUTH.user.name || AUTH.user.email || '?').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
  if(avatar) avatar.textContent = initials;
  if(badge)  badge.style.display = 'flex';

  // Mobile subtitle
  const mobileSub = document.getElementById('mobileSubtitle');

  // Load portfolios this user can access
  AUTH.portfolios = await xano('GET', '/portfolio');

  // Populate portfolio selector
  const sel = document.getElementById('portfolioSelect');
  if(sel) sel.innerHTML = AUTH.portfolios.map(p => `<option value="${p.id}">${p.name}${p.is_private?' 🔒':''}</option>`).join('');
  if (AUTH.portfolios.length > 1) {
    const pWrap = document.getElementById('portfolioSelectorWrap');
    if(pWrap) pWrap.style.display = 'flex';
  }

  // Default to first portfolio
  AUTH.currentPortfolioId = AUTH.portfolios[0]?.id || null;
  if (!AUTH.currentPortfolioId) {
    syncUI('err', 'No portfolio found — contact your admin');
    return;
  }

  // Set mobile subtitle: portfolio name + date
  if(mobileSub) {
    const portfolio = AUTH.portfolios.find(p=>p.id===AUTH.currentPortfolioId);
    const name = portfolio ? portfolio.name : '';
    const date = new Date().toLocaleDateString('en-AU',{weekday:'short',day:'numeric',month:'short'});
    mobileSub.textContent = (name ? name + ' · ' : '') + date;
  }

  // Hide login screen, start app
  document.getElementById('loginScreen').classList.add('hidden');
  applyRoleUI();
  startInactivityTimer();
  await loadPortfolio(AUTH.currentPortfolioId);
}

async function switchPortfolio(id) {
  AUTH.currentPortfolioId = parseInt(id);
  applyRoleUI();
  await loadPortfolio(AUTH.currentPortfolioId);
}

// ══════════════════════════════════════════════════════════════
// ── XANO DATA LOADING ─────────────────────────────────────────
// ══════════════════════════════════════════════════════════════
async function loadPortfolio(portfolioId) {
  syncUI('syncing', 'Loading portfolio...');
  try {
    const data = await xano('GET', `/portfolio/${portfolioId}`);

    // Load cash accounts first so transactions can reference them by index
    S.cash = (data.cash_accounts || []).map(a => ({
      _id: a.id, name: a.name, balance: a.balance || 0
    }));

    // Xano returns transactions as a flat array — group them by holding id
    const txnsByHolding = {};
    (data.transactions || []).forEach(tx => {
      // Xano uses 'holding' (integer foreign key) not 'holding_id'
      const hid = tx.holding || tx.holding_id;
      if (!txnsByHolding[hid]) txnsByHolding[hid] = [];
      // Xano uses 'cash_account' not 'cash_acct_id'
      const cashXanoId = tx.cash_account || tx.cash_acct_id;
      const cashIdx = cashXanoId != null ? S.cash.findIndex(c => c._id === cashXanoId) : null;
      txnsByHolding[hid].push({
        _id:        tx.id,
        date:       tx.date ? tx.date.slice(0,10) : '',
        side:       tx.side,
        qty:        tx.qty,
        price:      tx.price,
        fee:        tx.fee || 0,
        txnId:      tx.txn_id,
        source_id:  tx.source_id,
        // Restore swyftxId so recalcFromTxns can detect Swyftx trades.
        // Swyftx source_ids always start with 'ord_' or 'dep_'.
        swyftxId:   tx.source_id && (String(tx.source_id).startsWith('ord_') || String(tx.source_id).startsWith('dep_')) ? tx.source_id : undefined,
        cashAcct:   cashIdx >= 0 ? cashIdx : null,
        priceExFee: tx.price_ex_fee || false,
      });
    });

    // Map holdings grouped by asset_type, each with their nested transactions
    S.us  = []; S.asx = []; S.cry = []; S.met = [];
    (data.holdings || []).forEach(h => {
      const item = {
        _id:    h.id,
        ticker: h.ticker,
        name:   h.name,
        qty:    h.qty,
        cost:   h.cost,
        txns:   txnsByHolding[h.id] || []
      };
      if      (h.asset_type === 'us')  S.us.push(item);
      else if (h.asset_type === 'asx') S.asx.push(item);
      else if (h.asset_type === 'cry') S.cry.push(item);
      else if (h.asset_type === 'met') S.met.push(item);
    });
    S.fees = (data.ledger || []).filter(l => l.type === 'fee').map(l => ({
      _id: l.id, date: l.date ? l.date.slice(0,10) : '', desc: l.description, cat: l.category,
      amount: l.amount, txnId: l.txn_id, cashAcct: (l.cash_account||l.cash_acct_id) != null ? S.cash.findIndex(c=>c._id===(l.cash_account||l.cash_acct_id)) : null
    }));
    S.income = (data.ledger || []).filter(l => l.type === 'income').map(l => ({
      _id: l.id, date: l.date ? l.date.slice(0,10) : '', source: l.meta?.source || '', type: l.category,
      amount: l.amount, franking: l.meta?.franking || 0, txnId: l.txn_id,
      cashAcct: (l.cash_account||l.cash_acct_id) != null ? S.cash.findIndex(c=>c._id===(l.cash_account||l.cash_acct_id)) : null
    }));
    S.contributions = (data.ledger || []).filter(l => l.type === 'contribution').map(l => ({
      _id: l.id, date: l.date ? l.date.slice(0,10) : '', member: l.meta?.member || '', type: l.category,
      amount: l.amount, txnId: l.txn_id,
      cashAcct: (l.cash_account||l.cash_acct_id) != null ? S.cash.findIndex(c=>c._id===(l.cash_account||l.cash_acct_id)) : null
    }));
    S.transfers = (data.ledger || []).filter(l => l.type === 'transfer').map(l => ({
      _id: l.id, date: l.date ? l.date.slice(0,10) : '', desc: l.description,
      from: (l.cash_account||l.cash_acct_id) != null ? S.cash.findIndex(c=>c._id===(l.cash_account||l.cash_acct_id)) : null,
      to:   (l.to_cash_account||l.to_cash_acct_id) != null ? S.cash.findIndex(c=>c._id===(l.to_cash_account||l.to_cash_acct_id)) : null,
      amount: l.amount, txnId: l.txn_id
    }));
    S.wl = (data.watchlist || []).map(w => ({
      _id: w.id, ticker: w.ticker, name: w.name, type: w.asset_type, target: w.target || 0
    }));

    // Recalculate avg cost and qty from transaction history
    ['us','asx','cry','met'].forEach(type => {
      (S[type] || []).forEach((_, idx) => {
        if (typeof recalcFromTxns === 'function') recalcFromTxns(type, idx);
      });
    });


    syncUI('synced', 'Loaded · ' + new Date().toLocaleTimeString('en-AU',{hour:'2-digit',minute:'2-digit'}));
    ['us','asx','cry','met','cash','fees','wl'].forEach(t => rows(t));
    renderAllHoldings(); renderFees(); renderCash(); summary(); renderAllocTable();
    // Load snapshots from Xano for history chart
    xanoLoadSnapshots(portfolioId).then(snapshots => {
      if(snapshots && snapshots.length) {
        // Convert Xano format to local format {d, v, invested, cash}
        const history = snapshots
          .sort((a,b) => a.date > b.date ? 1 : -1)
          .map(s => ({d: s.date, v: parseFloat(s.value)||0, invested: parseFloat(s.invested)||0, cash: parseFloat(s.cash)||0}));
        // Store in localStorage as cache
        try { localStorage.setItem(HISTORY_KEY + '_' + portfolioId, JSON.stringify(history)); } catch(e) {}
        S.snapshots = history;
        renderHistoryChart(history);
      } else {
        // Fall back to localStorage cache
        try {
          const cached = JSON.parse(localStorage.getItem(HISTORY_KEY + '_' + portfolioId) || localStorage.getItem(HISTORY_KEY) || '[]');
          S.snapshots = cached;
          renderHistoryChart(cached);
        } catch(e) { S.snapshots = []; }
      }
    });
    setTimeout(() => { renderCash(); renderAllHoldings(); renderFees(); summary(); renderAllocTable(); }, 150);
    // Auto-refresh prices on login (after a short delay so UI renders first)
    setTimeout(() => {
      if(typeof refreshAll === 'function') refreshAll();
    }, 800);
  } catch(e) {
    syncUI('err', 'Failed to load portfolio — ' + e.message);
    console.error('loadPortfolio error:', e);
  } finally {
    document.getElementById('rfBtn').disabled = false;
  }
}

// ── Xano: save (all mutations go to Xano immediately) ─────────
// Instead of one bulk save, each action calls the relevant Xano endpoint.
// `save()` is kept as a compatibility shim that triggers a full reload.
let saveTimer = null;
function save() {
  syncUI('syncing', 'Saving...');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await loadPortfolio(AUTH.currentPortfolioId);
      syncUI('synced', 'Saved · ' + new Date().toLocaleTimeString('en-AU',{hour:'2-digit',minute:'2-digit'}));
    } catch(e) {
      syncUI('err', 'Save failed — check connection');
    }
  }, 1200);
}

// Granular Xano mutations
async function xanoAddHolding(assetType) {
  const item = S[assetType][S[assetType].length - 1];
  const rec = await xano('POST', '/holding', {
    portfolio: AUTH.currentPortfolioId,
    ticker: item.ticker, name: item.name,
    asset_type: assetType, qty: item.qty, cost: item.cost
  });
  item._id = rec.id;
}
async function xanoUpdateHolding(type, i) {
  const item = S[type][i];
  if (!item._id) return;
  await xano('PATCH', `/holding/${item._id}`, { qty: item.qty, cost: item.cost });
}
async function xanoDeleteHolding(type, i) {
  const item = S[type][i];
  if (item._id) await xano('DELETE', `/holding/${item._id}`);
}
async function xanoAddTransaction(type, i) {
  const item = S[type][i];
  const tx = item.txns[item.txns.length - 1];
  if(!item._id) throw new Error('Holding has no Xano ID (_id is ' + item._id + '). Try deleting and re-adding this holding.');
  const cashId = tx.cashAcct != null && S.cash[tx.cashAcct] ? S.cash[tx.cashAcct]._id : null;
  const rec = await xano('POST', '/transaction', {
    holding: item._id,
    portfolio: AUTH.currentPortfolioId,
    date: tx.date, side: tx.side, qty: tx.qty, price: tx.price,
    fee: tx.fee || 0, txn_id: tx.txnId,
    source_id: tx.swyftxId || tx.commsecIntlId || null,
    cash_account: cashId, price_ex_fee: tx.priceExFee || false
  });
  tx._id = rec.id;
}
async function xanoDeleteTransaction(txId) {
  if (txId) await xano('DELETE', `/transaction/${txId}`);
}
async function xanoAddCash(i) {
  const a = S.cash[i];
  const rec = await xano('POST', '/cash_account', { portfolio: AUTH.currentPortfolioId, name: a.name, balance: a.balance });
  a._id = rec.id;
}
async function xanoUpdateCash(i) {
  const a = S.cash[i];
  if (a._id) await xano('PATCH', `/cash_account/${a._id}`, { balance: a.balance });
}
async function xanoDeleteCash(i) {
  const a = S.cash[i];
  if (a._id) await xano('DELETE', `/cash_account/${a._id}`);
}
async function xanoAddLedger(entry) {
  const rec = await xano('POST', '/ledger', entry);
  return rec.id;
}
async function xanoDeleteLedger(id) {
  if (id) await xano('DELETE', `/ledger/${id}`);
}
async function xanoAddWatchlist(i) {
  const w = S.wl[i];
  const rec = await xano('POST', '/watchlist', { portfolio: AUTH.currentPortfolioId, ticker: w.ticker, name: w.name, asset_type: w.type, target: w.target });
  w._id = rec.id;
}
async function xanoUpdateWatchlist(i) {
  const w = S.wl[i];
  if (w._id) await xano('PATCH', `/watchlist/${w._id}`, { target: w.target });
}
async function xanoDeleteWatchlist(i) {
  const w = S.wl[i];
  if (w._id) await xano('DELETE', `/watchlist/${w._id}`);
}

// ══════════════════════════════════════════════════════════════
// ── INACTIVITY TIMER (1 hour) ─────────────────────────────────
// ══════════════════════════════════════════════════════════════
const INACTIVITY_MS   = 60 * 60 * 1000; // 1 hour
const WARN_BEFORE_MS  = 60 * 1000;       // warn 60 seconds before
let inactivityTimeout = null;
let warnTimeout       = null;
let countdownInterval = null;

function startInactivityTimer() {
  resetInactivity();
  ['mousemove','keydown','click','touchstart','scroll'].forEach(ev =>
    document.addEventListener(ev, resetInactivity, { passive: true })
  );
}

function resetInactivity() {
  clearTimeout(inactivityTimeout);
  clearTimeout(warnTimeout);
  clearInterval(countdownInterval);
  document.getElementById('inactivityWarn').classList.remove('show');

  warnTimeout = setTimeout(() => {
    let secs = 60;
    document.getElementById('inactivityCountdown').textContent = secs;
    document.getElementById('inactivityWarn').classList.add('show');
    countdownInterval = setInterval(() => {
      secs--;
      document.getElementById('inactivityCountdown').textContent = secs;
      if (secs <= 0) { clearInterval(countdownInterval); }
    }, 1000);
  }, INACTIVITY_MS - WARN_BEFORE_MS);

  inactivityTimeout = setTimeout(() => {
    doLogout();
  }, INACTIVITY_MS);
}

function clearInactivityTimer() {
  clearTimeout(inactivityTimeout);
  clearTimeout(warnTimeout);
  clearInterval(countdownInterval);
  document.getElementById('inactivityWarn').classList.remove('show');
}

// ── User dropdown ─────────────────────────────────────────────
function toggleUserDropdown() {
  document.getElementById('userDropdown').classList.toggle('open');
}
function closeUserDropdown() {
  document.getElementById('userDropdown').classList.remove('open');
}
document.addEventListener('click', e => {
  if (!e.target.closest('#userBadge')) closeUserDropdown();
});

// ── Change password ───────────────────────────────────────────
function openChangePassword() {
  closeUserDropdown();
  const m = document.getElementById('changePwModal');
  m.style.display = 'flex'; m.style.visibility = 'visible'; m.classList.add('open');
}
function closeChangePw() {
  const m = document.getElementById('changePwModal');
  m.classList.remove('open'); m.style.display = 'none'; m.style.visibility = 'hidden';
}
async function doChangePassword() {
  const current = document.getElementById('changePwCurrent').value;
  const newPw   = document.getElementById('changePwNew').value;
  const confirm = document.getElementById('changePwConfirm').value;
  const err     = document.getElementById('changePwErr');
  if (newPw !== confirm) { err.textContent = 'New passwords do not match.'; err.classList.add('show'); return; }
  if (newPw.length < 8)  { err.textContent = 'Password must be at least 8 characters.'; err.classList.add('show'); return; }
  try {
    await xano('POST', '/auth/change_password', { current_password: current, new_password: newPw });
    closeChangePw();
    alert('Password updated successfully.');
  } catch(e) {
    err.textContent = e.message || 'Failed to update password.'; err.classList.add('show');
  }
}

// ── Manage Access modal (admin only) ──────────────────────────
async function openAccessModal() {
  const m = document.getElementById('accessModal');
  m.style.display = 'flex'; m.style.visibility = 'visible'; m.classList.add('open');
  const p = AUTH.portfolios.find(p => p.id === AUTH.currentPortfolioId);
  document.getElementById('accessModalPortfolioName').textContent = p ? p.name : '';
  try {
    const access = await xano('GET', `/portfolio_access?portfolio_id=${AUTH.currentPortfolioId}`);
    document.getElementById('accessUserList').innerHTML = access.length
      ? access.map(a => `
        <div class="access-row">
          <div class="access-user">
            <div class="access-avatar">${(a.user?.name||a.user?.email||'?').slice(0,2).toUpperCase()}</div>
            <div><div class="access-name">${a.user?.name||'—'}</div><div class="access-email">${a.user?.email||'—'}</div></div>
          </div>
          <div style="display:flex;align-items:center;gap:8px;">
            <span class="user-role-badge role-${a.permission}">${a.permission}</span>
            <button class="del" style="opacity:1;" onclick="revokeAccess(${a.id})">✕</button>
          </div>
        </div>`).join('')
      : '<div style="color:var(--text3);font-size:13px;padding:8px 0;">No additional users have access.</div>';
  } catch(e) {
    document.getElementById('accessUserList').innerHTML = '<div style="color:var(--gain-neg);font-size:13px;">Failed to load access list.</div>';
  }
}
function closeAccessModal() {
  const m = document.getElementById('accessModal');
  m.classList.remove('open'); m.style.display = 'none'; m.style.visibility = 'hidden';
}
async function inviteUser() {
  const email = document.getElementById('inviteEmail').value.trim();
  const role  = document.getElementById('inviteRole').value;
  if (!email) return;
  try {
    await xano('POST', '/portfolio_access', { portfolio_id: AUTH.currentPortfolioId, email, permission: role });
    document.getElementById('inviteEmail').value = '';
    openAccessModal(); // refresh list
  } catch(e) { alert('Failed to invite user: ' + e.message); }
}
async function revokeAccess(accessId) {
  if (!confirm('Remove this user\'s access?')) return;
  try { await xano('DELETE', `/portfolio_access/${accessId}`); openAccessModal(); }
  catch(e) { alert('Failed to revoke access: ' + e.message); }
}

