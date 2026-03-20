// ── Smart Add Modal ───────────────────────────────────────────
let smartMode='new',smartCategory='us',smartFoundType=null,smartFoundIdx=null;
const MODAL_QTY_LABELS={us:'Qty (shares)',asx:'Qty (shares)',cry:'Qty (coins)',met:'Qty (oz)'};
const MODAL_COST_LABELS={us:'Avg cost (AUD)',asx:'Avg cost (AUD)',cry:'Avg cost (AUD)',met:'Avg cost (AUD/oz)'};
const MODAL_HINTS={us:'Price fetched from Finnhub automatically.',asx:'Enter ASX ticker without .AX suffix, e.g. CBA, BHP, ANZ. Make sure ASX Stock category is selected.',cry:'Use CoinGecko symbol (e.g. BTC, ETH).',met:'Use XAU, XAG, XPT or XPD.'};

function openAddModal(){
  if(isReadOnly()) return;
  smartMode='new';smartCategory='us';smartFoundType=null;smartFoundIdx=null;
  setTimeout(()=>{const nd=document.getElementById('modal-new-date');if(nd&&!nd.value)nd.value=new Date().toISOString().slice(0,10);},50);
  const _ntt=document.getElementById('modal-new-total');if(_ntt)_ntt.style.display='none';
  const _st=document.getElementById('modal-sale-total');if(_st)_st.style.display='none';
  const _swt=document.getElementById('modal-swap-total');if(_swt)_swt.style.display='none';
  ['modal-smart-ticker','modal-name','modal-new-date','modal-qty','modal-cost','modal-new-fee','modal-sale-qty','modal-sale-price','modal-sale-fee','modal-swap-from-qty','modal-swap-from-aud','modal-swap-to-qty','modal-swap-to-aud','modal-swap-fee','modal-cash-name','modal-cash-bal','modal-fees-desc','modal-fees-amt','modal-txn-qty','modal-txn-price','modal-txn-fee','modal-income-amt','modal-income-source','modal-income-franking','modal-contrib-amt','modal-contrib-member'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  const today=new Date().toISOString().slice(0,10);
  ['modal-fees-date','modal-txn-date','modal-income-date','modal-contrib-date'].forEach(id=>{const el=document.getElementById(id);if(el)el.value=today;});
  document.getElementById('modal-ticker-status').textContent='';
  _populateAccountSelects();_renderSmartModal();
  const _modal=document.getElementById('addModal');_modal.style.display='flex';_modal.style.visibility='visible';_modal.classList.add('open');
  setTimeout(()=>document.getElementById('modal-smart-ticker').focus(),80);
}
function _populateAccountSelects(){const opts='<option value="">— Don\'t adjust cash —</option>'+S.cash.map((a,i)=>`<option value="${i}">${a.name} ($${f(a.balance||0)} AUD)</option>`).join('');['modal-txn-account','modal-new-account'].forEach(id=>{const el=document.getElementById(id);if(el)el.innerHTML=opts;});}
function closeAddModal(){const _modal=document.getElementById('addModal');_modal.classList.remove('open');_modal.style.display='none';_modal.style.visibility='hidden';}
function onSmartTickerInput(raw){const tk=raw.trim().toUpperCase();if(smartMode==='cash'||smartMode==='fees')setSmartMode('new');smartFoundType=null;smartFoundIdx=null;for(const type of['us','asx','cry','met']){const idx=S[type].findIndex(h=>h.ticker===tk);if(idx>=0){smartFoundType=type;smartFoundIdx=idx;break;}}const status=document.getElementById('modal-ticker-status');if(!tk){status.textContent='';smartMode='new';}else if(smartFoundType){status.textContent='✓ Found: '+S[smartFoundType][smartFoundIdx].name+' — adding transaction';status.style.color='#42ac5c';smartMode='txn';}else{// Auto-suggest category based on ticker pattern
  const isCrypto=Object.keys(CID).includes(tk)||['BTC','ETH','SOL','XRP','ADA','BNB','DOGE','AVAX','MATIC','LINK'].includes(tk);
  const isASX=/^[A-Z]{2,4}[0-9]?$/.test(tk)&&!isCrypto&&tk.length<=4&&!['AAPL','MSFT','TSLA','AMZN','GOOGL','META','NVDA','AMD','INTC','NFLX'].includes(tk);
  if(isASX&&smartCategory==='us')setSmartCategory('asx');
  status.textContent='New holding — select category below';status.style.color='var(--text3)';smartMode='new';}
_renderSmartModal();}
function setSmartMode(mode){
  smartMode=mode;const noTicker=['cash','fees','income','contribution','transfer'];
  if(noTicker.includes(mode)){document.getElementById('modal-smart-ticker').value='';document.getElementById('modal-ticker-status').textContent='';}
  const today=new Date().toISOString().slice(0,10);
  if(mode==='fees'){const d=document.getElementById('modal-fees-date');if(d&&!d.value)d.value=today;const sel=document.getElementById('modal-fees-account');if(sel){sel.innerHTML='<option value="">— Don\'t adjust cash —</option>'+S.cash.map((a,i)=>`<option value="${i}">${a.name} ($${f(a.balance||0)} AUD)</option>`).join('');}}
  if(mode==='income'){const d=document.getElementById('modal-income-date');if(d&&!d.value)d.value=today;}
  if(mode==='contribution'){const d=document.getElementById('modal-contrib-date');if(d&&!d.value)d.value=today;}
  if(mode==='transfer'){const d=document.getElementById('modal-transfer-date');if(d&&!d.value)d.value=today;}
  _renderSmartModal();
}
function setSmartCategory(cat){smartCategory=cat;['us','asx','cry','met'].forEach(c=>{const b=document.getElementById('scat-'+c);if(b)b.classList.toggle('active',c===cat);});['qty-label','cost-label'].forEach(s=>{});document.getElementById('modal-qty-label')&&(document.getElementById('modal-qty-label').textContent=MODAL_QTY_LABELS[cat]);document.getElementById('modal-cost-label')&&(document.getElementById('modal-cost-label').textContent=MODAL_COST_LABELS[cat]);document.getElementById('modal-hint')&&(document.getElementById('modal-hint').textContent=MODAL_HINTS[cat]);}
function _renderSmartModal(){const isTxn=smartMode==='txn',isCash=smartMode==='cash',isFees=smartMode==='fees',isIncome=smartMode==='income',isContrib=smartMode==='contribution',isTransfer=smartMode==='transfer',isSale=smartMode==='sale',isSwap=smartMode==='swap',isNew=smartMode==='new';const noTicker=isCash||isFees||isIncome||isContrib||isTransfer||isSale||isSwap;const titles={txn:'Add transaction',cash:'Add cash account',fees:'Add fee',income:'Record income',contribution:'Record contribution',transfer:'Transfer between accounts',sale:'Record a sale',swap:'Record a crypto swap'};const subs={txn:'Adding trade for '+(S[smartFoundType]?.[smartFoundIdx]?.name||''),cash:'Enter account name and balance',fees:'Log a fee to your FY ledger',income:'Record dividend, interest or other income',contribution:'Record a member contribution',transfer:'Move funds between two cash accounts',sale:'Sell a holding and credit proceeds to a cash account',swap:'Swap one crypto for another — creates a sell and a buy transaction'};document.getElementById('modal-title').textContent=titles[smartMode]||'Add to portfolio';document.getElementById('modal-sub').textContent=subs[smartMode]||'Type a ticker — or choose a type below';document.getElementById('modal-ticker-row').style.display=noTicker?'none':'block';document.getElementById('modal-quick-btns').style.display=noTicker?'none':'flex';document.getElementById('modal-cat-row').style.display=isNew?'block':'none';if(isNew)setSmartCategory(smartCategory);document.getElementById('modal-divider').style.display='block';document.getElementById('modal-new-holding').style.display=isNew?'block':'none';document.getElementById('modal-txn-fields').style.display=isTxn?'block':'none';document.getElementById('modal-cash-fields').style.display=isCash?'block':'none';document.getElementById('modal-fees-fields').style.display=isFees?'block':'none';document.getElementById('modal-income-fields').style.display=isIncome?'block':'none';document.getElementById('modal-contribution-fields').style.display=isContrib?'block':'none';document.getElementById('modal-transfer-fields').style.display=isTransfer?'block':'none';
  document.getElementById('modal-sale-fields').style.display=isSale?'block':'none';
  document.getElementById('modal-swap-fields').style.display=isSwap?'block':'none';if(isSwap){
    const cryptoHoldings=S.cry.map((h,i)=>({type:'cry',idx:i,label:`${h.ticker} — ${h.name} (${f(h.qty,4)} units)`}));
    const fromEl=document.getElementById('modal-swap-from-holding');
    const toEl=document.getElementById('modal-swap-to-holding');
    if(fromEl)fromEl.innerHTML='<option value="">— Select —</option>'+cryptoHoldings.map((h,i)=>`<option value="${i}">${h.label}</option>`).join('');
    if(toEl)toEl.innerHTML='<option value="">— Select —</option>'+cryptoHoldings.map((h,i)=>`<option value="${i}">${h.label}</option>`).join('');
    window._swapHoldings=cryptoHoldings;
    const swapDateEl=document.getElementById('modal-swap-date');
    if(swapDateEl&&!swapDateEl.value)swapDateEl.value=new Date().toISOString().slice(0,10);
  }
  if(isSale){
    // Populate holding selector with all current holdings
    const allHoldings=[];
    ['us','asx','cry','met'].forEach(t=>{S[t].forEach((h,i)=>{if(h.qty>0)allHoldings.push({type:t,idx:i,label:`${h.ticker} — ${h.name} (${h.qty} @ $${f(h.cost)})`});});});
    const saleHoldingEl=document.getElementById('modal-sale-holding');
    if(saleHoldingEl)saleHoldingEl.innerHTML='<option value="">— Select holding —</option>'+allHoldings.map((h,i)=>`<option value="${i}">${h.label}</option>`).join('');
    // Store allHoldings for submitAddModal to reference
    window._saleHoldings=allHoldings;
    // Populate cash account
    const saleAcctEl=document.getElementById('modal-sale-account');
    if(saleAcctEl)saleAcctEl.innerHTML='<option value="">— Don\'t adjust cash —</option>'+S.cash.map((a,i)=>`<option value="${i}">${a.name} ($${f(a.balance||0)} AUD)</option>`).join('');
    // Set today's date
    const saleDateEl=document.getElementById('modal-sale-date');
    if(saleDateEl&&!saleDateEl.value)saleDateEl.value=new Date().toISOString().slice(0,10);
  }
  if(isTransfer){const opts=S.cash.map((a,i)=>`<option value="${i}">${a.name} ($${f(a.balance||0)} AUD)</option>`).join('');const fromEl=document.getElementById('modal-transfer-from');const toEl=document.getElementById('modal-transfer-to');if(fromEl)fromEl.innerHTML='<option value="">— Select account —</option>'+opts;if(toEl)toEl.innerHTML='<option value="">— Select account —</option>'+opts;}if(isIncome||isContrib){const opts='<option value="">— Don\'t adjust cash —</option>'+S.cash.map((a,i)=>`<option value="${i}">${a.name} ($${f(a.balance||0)} AUD)</option>`).join('');['modal-income-account','modal-contrib-account'].forEach(id=>{const el=document.getElementById(id);if(el)el.innerHTML=opts;});}['cash','fees','income','contribution','transfer','sale','swap'].forEach(m=>{const b=document.getElementById('qbtn-'+m);if(b){b.style.background=smartMode===m?'#42ac5c':'';b.style.color=smartMode===m?'#fff':'';b.style.borderColor=smartMode===m?'#42ac5c':'';}});}

async function submitAddModal(){
  if(isReadOnly()){closeAddModal();return;}
  if(smartMode==='txn'){
    const date=document.getElementById('modal-txn-date').value;const side=document.getElementById('modal-txn-side').value;const qty=parseFloat(document.getElementById('modal-txn-qty').value)||0;const price=parseFloat(document.getElementById('modal-txn-price').value)||0;const fee=parseFloat(document.getElementById('modal-txn-fee').value)||0;const acctIdx=document.getElementById('modal-txn-account').value;
    if(!qty||!price)return;
    if(!S[smartFoundType][smartFoundIdx].txns)S[smartFoundType][smartFoundIdx].txns=[];
    const txnId=generateTxnId(date);const cashAcct=acctIdx!==''?parseInt(acctIdx):null;
    S[smartFoundType][smartFoundIdx].txns.push({date,side,qty,price,fee,cashAcct,txnId});
    recalcFromTxns(smartFoundType,smartFoundIdx);
    if(cashAcct!==null){const tradeTotal=qty*price;const withFee=side==='buy'?tradeTotal+fee:tradeTotal-fee;S.cash[cashAcct].balance=(S.cash[cashAcct].balance||0)+(side==='buy'?-withFee:withFee);await xanoUpdateCash(cashAcct);renderCash();}
    try{await xanoUpdateHolding(smartFoundType,smartFoundIdx);await xanoAddTransaction(smartFoundType,smartFoundIdx);syncUI('synced','Saved');}catch(e){syncUI('err','Save failed');}
    rows(smartFoundType);renderAllHoldings();renderFees();
  }else if(smartMode==='fees'){
    const date=document.getElementById('modal-fees-date').value;const desc=document.getElementById('modal-fees-desc').value.trim();const cat=document.getElementById('modal-fees-cat').value;const amount=parseFloat(document.getElementById('modal-fees-amt').value)||0;const feeAcctVal=document.getElementById('modal-fees-account')?.value;const feeCashAcct=feeAcctVal!==''&&feeAcctVal!=null?parseInt(feeAcctVal):null;
    if(!desc||!amount)return;const txnId=generateTxnId(date);const cashId=feeCashAcct!=null&&S.cash[feeCashAcct]?S.cash[feeCashAcct]._id:null;
    try{const recId=await xanoAddLedger({portfolio:AUTH.currentPortfolioId,date,type:'fee',category:cat,description:desc,amount,txn_id:txnId,cash_acct_id:cashId});S.fees.push({_id:recId,date,desc,cat,amount,txnId,cashAcct:feeCashAcct});if(feeCashAcct!==null&&S.cash[feeCashAcct]){S.cash[feeCashAcct].balance=(S.cash[feeCashAcct].balance||0)-amount;await xanoUpdateCash(feeCashAcct);renderCash();}renderFees();syncUI('synced','Saved');}catch(e){syncUI('err','Save failed');}
  }else if(smartMode==='cash'){
    const nm=document.getElementById('modal-cash-name').value.trim();const bal=parseFloat(document.getElementById('modal-cash-bal').value)||0;if(!nm)return;
    S.cash.push({name:nm,balance:bal});try{await xanoAddCash(S.cash.length-1);renderCash();syncUI('synced','Saved');}catch(e){syncUI('err','Save failed');S.cash.pop();}
  }else if(smartMode==='income'){
    const date=document.getElementById('modal-income-date').value;const amt=parseFloat(document.getElementById('modal-income-amt').value)||0;const source=document.getElementById('modal-income-source').value.trim();const type=document.getElementById('modal-income-type').value;const franking=parseFloat(document.getElementById('modal-income-franking').value)||0;const acctIdx=document.getElementById('modal-income-account').value;
    if(!amt||!source)return;const txnId=generateTxnId(date);const cashId=acctIdx!==''&&S.cash[parseInt(acctIdx)]?S.cash[parseInt(acctIdx)]._id:null;
    try{const recId=await xanoAddLedger({portfolio:AUTH.currentPortfolioId,date,type:'income',category:type,description:`${type} — ${source}`,amount:amt,txn_id:txnId,cash_acct_id:cashId,meta:{source,franking}});S.income.push({_id:recId,date,source,type,amount:amt,franking,txnId,cashAcct:acctIdx!==''?parseInt(acctIdx):null});if(acctIdx!==''){const idx=parseInt(acctIdx);S.cash[idx].balance=(S.cash[idx].balance||0)+amt;await xanoUpdateCash(idx);renderCash();}renderFees();syncUI('synced','Saved');}catch(e){syncUI('err','Save failed');}
  }else if(smartMode==='contribution'){
    const date=document.getElementById('modal-contrib-date').value;const amt=parseFloat(document.getElementById('modal-contrib-amt').value)||0;const member=document.getElementById('modal-contrib-member').value.trim();const type=document.getElementById('modal-contrib-type').value;const acctIdx=document.getElementById('modal-contrib-account').value;
    if(!amt||!member)return;const txnId=generateTxnId(date);const cashId=acctIdx!==''&&S.cash[parseInt(acctIdx)]?S.cash[parseInt(acctIdx)]._id:null;
    try{const recId=await xanoAddLedger({portfolio:AUTH.currentPortfolioId,date,type:'contribution',category:type,description:`${type} contribution — ${member}`,amount:amt,txn_id:txnId,cash_acct_id:cashId,cash_account:cashId,meta:{member,destination_account:acctIdx!==''?S.cash[parseInt(acctIdx)]?.name:null}});S.contributions.push({_id:recId,date,member,type,amount:amt,txnId,cashAcct:acctIdx!==''?parseInt(acctIdx):null});if(acctIdx!==''){const idx=parseInt(acctIdx);S.cash[idx].balance=(S.cash[idx].balance||0)+amt;await xanoUpdateCash(idx);renderCash();}renderFees();syncUI('synced','Saved');}catch(e){syncUI('err','Save failed');}
  }else if(smartMode==='transfer'){
    const date=document.getElementById('modal-transfer-date').value;const from=document.getElementById('modal-transfer-from').value;const to=document.getElementById('modal-transfer-to').value;const amt=parseFloat(document.getElementById('modal-transfer-amt').value)||0;const desc=document.getElementById('modal-transfer-desc').value.trim();
    if(!amt||from===''||to===''||from===to)return;const fromIdx=parseInt(from),toIdx=parseInt(to);const txnId=generateTxnId(date);const fromId=S.cash[fromIdx]?._id,toId=S.cash[toIdx]?._id;
    try{const recId=await xanoAddLedger({portfolio:AUTH.currentPortfolioId,date,type:'transfer',category:'Internal Transfer',description:`Transfer${desc?' — '+desc:''}`,amount:amt,txn_id:txnId,cash_acct_id:fromId,to_cash_acct_id:toId,meta:{desc}});S.transfers.push({_id:recId,date,from:fromIdx,to:toIdx,amount:amt,desc,txnId});S.cash[fromIdx].balance=(S.cash[fromIdx].balance||0)-amt;S.cash[toIdx].balance=(S.cash[toIdx].balance||0)+amt;await Promise.all([xanoUpdateCash(fromIdx),xanoUpdateCash(toIdx)]);renderCash();renderFees();syncUI('synced','Saved');}catch(e){syncUI('err','Save failed');}
  }else if(smartMode==='swap'){
    const swapDate=document.getElementById('modal-swap-date')?.value;
    const fromIdx=parseInt(document.getElementById('modal-swap-from-holding')?.value);
    const toIdx=parseInt(document.getElementById('modal-swap-to-holding')?.value);
    const fromQty=parseFloat(document.getElementById('modal-swap-from-qty')?.value)||0;
    const fromAud=parseFloat(document.getElementById('modal-swap-from-aud')?.value)||0;
    const toQty=parseFloat(document.getElementById('modal-swap-to-qty')?.value)||0;
    const toAud=parseFloat(document.getElementById('modal-swap-to-aud')?.value)||0;
    const swapFee=parseFloat(document.getElementById('modal-swap-fee')?.value)||0;
    if(!window._swapHoldings||isNaN(fromIdx)||isNaN(toIdx)||!fromQty||!fromAud||!toQty)return;
    if(fromIdx===toIdx){alert('From and To holdings must be different.');return;}
    const fromH=window._swapHoldings[fromIdx];
    const toH=window._swapHoldings[toIdx];
    if(!fromH||!toH)return;
    const txnId=generateTxnId(swapDate);
    const fromItem=S.cry[fromH.idx];
    const toItem=S.cry[toH.idx];
    // Sell side — price per unit = fromAud / fromQty
    const sellPricePerUnit=fromAud/fromQty;
    fromItem.txns.push({date:swapDate,side:'sell',qty:fromQty,price:sellPricePerUnit,fee:swapFee,txnId:txnId+'-S',cashAcct:null});
    recalcFromTxns('cry',fromH.idx);
    // Buy side — price per unit = toAud / toQty
    const buyPricePerUnit=toAud>0?toAud/toQty:sellPricePerUnit*(fromQty/toQty);
    toItem.txns.push({date:swapDate,side:'buy',qty:toQty,price:buyPricePerUnit,fee:0,txnId:txnId+'-B',cashAcct:null});
    recalcFromTxns('cry',toH.idx);
    try{
      await xanoUpdateHolding('cry',fromH.idx);
      await xanoAddTransaction('cry',fromH.idx);
      await xanoUpdateHolding('cry',toH.idx);
      await xanoAddTransaction('cry',toH.idx);
      syncUI('synced','Swap recorded');
    }catch(e){
      syncUI('err','Save failed: '+e.message);
    }
    rows('cry');renderAllHoldings();renderFees();
  }else if(smartMode==='sale'){
    const holdingIdx=parseInt(document.getElementById('modal-sale-holding')?.value);
    const saleDate=document.getElementById('modal-sale-date')?.value;
    const saleQty=parseFloat(document.getElementById('modal-sale-qty')?.value)||0;
    const salePrice=parseFloat(document.getElementById('modal-sale-price')?.value)||0;
    const saleFee=parseFloat(document.getElementById('modal-sale-fee')?.value)||0;
    const saleAcctIdx=document.getElementById('modal-sale-account')?.value;
    if(!window._saleHoldings||isNaN(holdingIdx)||!saleQty||!salePrice)return;
    const h=window._saleHoldings[holdingIdx];
    if(!h)return;
    const {type,idx}=h;
    const item=S[type][idx];
    if(!item)return;
    // Add a sell transaction
    const txnId=generateTxnId(saleDate);
    const cashAcct=saleAcctIdx!==''&&saleAcctIdx!=null?parseInt(saleAcctIdx):null;
    item.txns.push({date:saleDate,side:'sell',qty:saleQty,price:salePrice,fee:saleFee,txnId,cashAcct});
    recalcFromTxns(type,idx);
    // Credit proceeds to cash account
    if(cashAcct!==null&&S.cash[cashAcct]){
      const netProceeds=saleQty*salePrice-saleFee;
      S.cash[cashAcct].balance=(S.cash[cashAcct].balance||0)+netProceeds;
      await xanoUpdateCash(cashAcct);
      renderCash();
    }
    try{
      await xanoUpdateHolding(type,idx);
      await xanoAddTransaction(type,idx);
      syncUI('synced','Sale recorded');
    }catch(e){
      syncUI('err','Save failed: '+e.message);
    }
    rows(type);renderAllHoldings();renderFees();
  }else{
    const tk=document.getElementById('modal-smart-ticker').value.trim().toUpperCase();const nm=document.getElementById('modal-name').value.trim()||tk;const qt=parseFloat(document.getElementById('modal-qty').value)||0;const cost=parseFloat(document.getElementById('modal-cost').value)||0;const newFee=parseFloat(document.getElementById('modal-new-fee')?.value)||0;const acctIdx=document.getElementById('modal-new-account').value;
    if(!tk)return;S[smartCategory].push({ticker:tk,name:nm,qty:qt,cost,txns:[]});
    try{
      await xanoAddHolding(smartCategory);
      // If qty and cost provided, also create an opening buy transaction
      if(qt>0&&cost>0){
        const lastIdx=S[smartCategory].length-1;
        const newHoldingDate=document.getElementById('modal-new-date')?.value||new Date().toISOString().slice(0,10);
        const txnId=generateTxnId(newHoldingDate);
        const openingCashAcct=acctIdx!==''&&acctIdx!=null?parseInt(acctIdx):null;
        S[smartCategory][lastIdx].txns=[{date:newHoldingDate,side:'buy',qty:qt,price:cost,fee:newFee,txnId,cashAcct:openingCashAcct}];
        await xanoAddTransaction(smartCategory,lastIdx);
      }
      if(acctIdx!==''&&qt>0&&cost>0){const idx=parseInt(acctIdx);S.cash[idx].balance=(S.cash[idx].balance||0)-((qt*cost)+newFee);await xanoUpdateCash(idx);renderCash();}
      rows(smartCategory);syncUI('synced','Saved');
    }catch(e){syncUI('err','Save failed: '+e.message);S[smartCategory].pop();}
  }
  closeAddModal();
}

document.addEventListener('keydown',e=>{if(e.key==='Escape')closeAddModal();});

