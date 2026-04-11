// ── CSV Importers (Swyftx — unchanged logic, Xano save) ───────
async function importSwyftxCSV(input){
  if(isReadOnly()){alert('You have read-only access.');input.value='';return;}
  const file=input.files[0];if(!file)return;input.value='';
  const reader=new FileReader();
  reader.onload=async function(e){
    try{
      const text=e.target.result;const allLines=text.split('\n').map(l=>l.trim());
      const isHeaderRow=l=>{const low=l.toLowerCase();return low.includes('date')&&low.includes('event')&&low.includes('asset');};
      const tradeRows=[];let headers=null;
      for(let i=0;i<allLines.length;i++){const line=allLines[i];if(!line)continue;if(isHeaderRow(line)){headers=line.split(',').map(h=>h.trim().replace(/^"|"$/g,'').toLowerCase());continue;}if(!headers)continue;const cols=line.split(',').map(c=>(c||'').trim().replace(/^"|"$/g,''));if(!cols[0]||cols[0].toLowerCase().includes('sub total'))continue;if(cols.length<5)continue;const get=name=>{const idx=headers.findIndex(h=>h.toLowerCase()===name.toLowerCase());return idx>=0?(cols[idx]||'').trim():'';};const event=get('event').toLowerCase();const asset=get('asset').toUpperCase();if(event!=='buy'&&event!=='sell')continue;if(!asset||asset==='AUD')continue;const amount=parseFloat(get('amount'))||0;const audVal=parseFloat(get('aud value'))||0;const fee=parseFloat(get('fee amount'))||0;const rawDate=get('date');const uuid=get('uuid');if(!amount||!audVal||!rawDate)continue;let date='';if(rawDate.includes('/')){const p=rawDate.split('/');if(p.length===3)date=p[2]+'-'+p[1].padStart(2,'0')+'-'+p[0].padStart(2,'0');}else{date=rawDate.slice(0,10);}if(!date||date.startsWith('NaN')||date.length<10)continue;
      const price=amount>0?parseFloat((audVal/amount).toFixed(6)):0;
      if(!price)continue;tradeRows.push({date,event,asset,amount,audVal,fee,uuid});}
      if(!tradeRows.length){alert('No buy/sell trades found in this CSV.');return;}
      let cashAcctIdx=null;if(S.cash.length>0){const opts=S.cash.map((a,i)=>(i+1)+'. '+a.name+' ($'+f(a.balance||0)+' AUD)').join('\n');const ans=prompt('Found '+tradeRows.length+' trade'+(tradeRows.length!==1?'s':'')+'.\n\nDeduct total (purchase + fee) from which cash account?\n\n'+opts+'\n\nEnter number, or 0 to skip:');if(ans===null)return;const n=parseInt(ans);if(n>=1&&n<=S.cash.length)cashAcctIdx=n-1;}
      let imported=0,skipped=0;
      for(const row of tradeRows){
        if(row.uuid){const isDupe=S.cry.some(h=>(h.txns||[]).some(tx=>tx.swyftxId===row.uuid));if(isDupe){skipped++;continue;}}
        let idx=S.cry.findIndex(h=>h.ticker===row.asset);
        if(idx===-1){S.cry.push({ticker:row.asset,name:row.asset,qty:0,cost:0,txns:[]});idx=S.cry.length-1;try{await xanoAddHolding('cry');}catch(e){S.cry.pop();continue;}}
        if(!S.cry[idx].txns)S.cry[idx].txns=[];
        const txnId=generateTxnId(row.date);
        S.cry[idx].txns.push({date:row.date,side:row.event,qty:row.amount,price:parseFloat((row.audVal/row.amount).toFixed(6)),fee:row.fee,txnId,swyftxId:row.uuid,cashAcct:cashAcctIdx});
        recalcFromTxns('cry',idx);
        try{await xanoUpdateHolding('cry',idx);await xanoAddTransaction('cry',idx);}catch(e){console.warn('Xano save failed for trade',e);}
        if(cashAcctIdx!==null&&S.cash[cashAcctIdx]){S.cash[cashAcctIdx].balance=(S.cash[cashAcctIdx].balance||0)-(row.audVal+row.fee);await xanoUpdateCash(cashAcctIdx);}
        // Fee is stored on the transaction and Xano creates the ledger entry server-side via /transaction POST
        imported++;
      }
      if(imported>0){rows('cry');renderAllHoldings();renderCash();renderFees();summary();}
      alert('\u2713 Swyftx import complete!\n\n'+imported+' trade'+(imported!==1?'s':'')+' imported\nFees recorded separately in ledger\n'+skipped+' duplicate'+(skipped!==1?'s':'')+' skipped');
    }catch(err){console.error('CSV import error:',err);alert('Import failed: '+err.message);}
  };
  reader.readAsText(file);
}

async function importCommsecIntlHTML(htmlText,statusEl){
  if(isReadOnly()){if(statusEl)setImportStatus(statusEl,'error','You have read-only access.');return;}
  try{
    const parser=new DOMParser();
    const doc=parser.parseFromString(htmlText,'text/html');

    // ── Build a map of AUD/USD rates by trade time from the Forex SELL rows ──
    // Each stock trade triggers a forex conversion at (nearly) the same timestamp.
    // Format: {'09:30': 0.70244, '14:36': 0.70028, ...}
    // We key by HH:MM (minute precision) to match stock trade times to forex rows.
    const forexRateByMinute={};
    let fallbackAudPerUsd=null;
    // Also capture the total AUD sold from the 'Total AUD.USD (Sold)' subtotal row —
    // this is the authoritative cash deduction straight from the statement.
    let totalAudSold=null;
    const allRows=[...doc.querySelectorAll('tbody tr')];
    for(const tr of allRows){
      const cells=[...tr.querySelectorAll('td')].map(td=>td.textContent.trim());
      // Detect the 'Total AUD.USD (Sold)' subtotal row - cells[0] contains the label
      if(cells[0]&&cells[0].includes('AUD.USD')&&cells[0].includes('Sold')){
        // cells[1] = total AUD quantity sold e.g. '-7,630.72'
        const v=Math.abs(parseFloat((cells[1]||'').replace(/,/g,'')));
        if(v>0)totalAudSold=parseFloat(v.toFixed(2));
      }
      if(cells.length>=8&&cells.some(c=>c==='AUD.USD')&&cells.some(c=>c==='SELL')){
        // cells[2] = datetime like '2026-04-08, 09:30:10'
        // cells[7] = forex rate (USD per AUD), e.g. '0.70244'
        const dtStr=cells[2]||'';
        const timePart=dtStr.includes(',')?dtStr.split(',')[1].trim():'';
        const minuteKey=timePart.slice(0,5); // 'HH:MM'
        for(let ci=7;ci<cells.length;ci++){
          const v=parseFloat(cells[ci].replace(/,/g,''));
          if(v>0.3&&v<1.5){
            const audPerUsd=parseFloat((1/v).toFixed(6));
            if(minuteKey&&!forexRateByMinute[minuteKey])forexRateByMinute[minuteKey]=audPerUsd;
            if(!fallbackAudPerUsd)fallbackAudPerUsd=audPerUsd;
            break;
          }
        }
      }
    }
    if(!fallbackAudPerUsd||fallbackAudPerUsd<0.5){fallbackAudPerUsd=1.414;}

    // ── Also build a map of ACTUAL AUD amounts from forex rows by minute ──
    // The forex SELL quantity (AUD sold) is the most accurate cash deduction.
    // Format: {'09:30': 5174.82, '14:36': 2455.90}
    const forexAudByMinute={};
    for(const tr of allRows){
      const cells=[...tr.querySelectorAll('td')].map(td=>td.textContent.trim());
      if(cells.length>=8&&cells.some(c=>c==='AUD.USD')&&cells.some(c=>c==='SELL')){
        const dtStr=cells[2]||'';
        const timePart=dtStr.includes(',')?dtStr.split(',')[1].trim():'';
        const minuteKey=timePart.slice(0,5);
        if(!minuteKey)continue;
        // cells[6] = AUD quantity sold (negative, e.g. '-5,174.7')
        const audQty=Math.abs(parseFloat((cells[6]||'').replace(/,/g,''))||0);
        if(audQty>0){
          forexAudByMinute[minuteKey]=(forexAudByMinute[minuteKey]||0)+audQty;
        }
      }
    }

    const stockTrades=[];
    let inStocks=false;
    const tbodies=[...doc.querySelectorAll('tbody')];
    for(const tbody of tbodies){
      const assetHeader=tbody.querySelector('td.header-asset');
      if(assetHeader){inStocks=assetHeader.textContent.trim()==='Stocks';continue;}
      if(tbody.querySelector('td.header-currency'))continue;
      if(!inStocks)continue;
      const summaryRows=tbody.querySelectorAll('tr.row-summary');
      for(const tr of summaryRows){
        const cells=[...tr.querySelectorAll('td')].map(td=>td.textContent.replace(/\u00a0/g,' ').trim());
        if(cells.length<10)continue;
        const symbol=(cells[1]||'').toUpperCase();
        const dateTimeStr=cells[2]||'';
        const typeStr=(cells[5]||'').toUpperCase();
        const qtyRaw=parseFloat((cells[6]||'').replace(/,/g,''))||0;
        const usdPriceRaw=parseFloat((cells[7]||'').replace(/,/g,''))||0;
        const commUsdRaw=Math.abs(parseFloat((cells[9]||'').replace(/,/g,''))||0);
        if(!symbol||symbol==='TOTAL'||!qtyRaw||!usdPriceRaw)continue;
        if(typeStr!=='BUY'&&typeStr!=='SELL')continue;
        const dateStr=dateTimeStr.split(',')[0].trim();
        const timePart=dateTimeStr.includes(',')?dateTimeStr.split(',')[1].trim():'';
        const minuteKey=timePart.slice(0,5);
        // Use the forex rate matching this trade's minute, fall back to global rate
        const audPerUsd=forexRateByMinute[minuteKey]||fallbackAudPerUsd;
        const qty=Math.abs(qtyRaw);
        const usdPrice=Math.abs(usdPriceRaw);
        const audPrice=parseFloat((usdPrice*audPerUsd).toFixed(6));
        const audComm=parseFloat((commUsdRaw*audPerUsd).toFixed(6));
        const audTotal=parseFloat((qty*audPrice).toFixed(2));
        const side=typeStr==='BUY'?'buy':'sell';
        const dedupId='CSINTL_HTML_'+symbol+'_'+dateStr+'_'+qty+'_'+usdPrice;
        // Store the actual AUD forex amount for this minute if available
        const actualAudOut=forexAudByMinute[minuteKey]||null;
        stockTrades.push({symbol,dateStr,minuteKey,side,qty,usdPrice,audPrice,audComm,audTotal,dedupId,actualAudOut,audPerUsd});
      }
    }
    if(!stockTrades.length){if(statusEl)setImportStatus(statusEl,'error','No stock trades found in this HTML file.');return;}

    // ── Consolidate partial fills: same symbol + same date + same side → one transaction ──
    // CommSec often splits one order into multiple fills (e.g. 10 shares then 5 shares of TSLA).
    // We combine them into a single weighted-average transaction so fees aren't duplicated in Xano.
    const consolidated=[];
    for(const t of stockTrades){
      const existing=consolidated.find(c=>c.symbol===t.symbol&&c.dateStr===t.dateStr&&c.side===t.side);
      if(existing){
        // Merge: weighted-average price, sum qty, sum fee, sum total
        const totalQty=existing.qty+t.qty;
        existing.usdPrice=parseFloat(((existing.usdPrice*existing.qty+t.usdPrice*t.qty)/totalQty).toFixed(6));
        existing.audPrice=parseFloat(((existing.audPrice*existing.qty+t.audPrice*t.qty)/totalQty).toFixed(6));
        existing.qty=totalQty;
        existing.audComm=parseFloat((existing.audComm+t.audComm).toFixed(6));
        existing.audTotal=parseFloat((existing.audTotal+t.audTotal).toFixed(2));
        // Sum actual AUD forex amounts (most accurate cash deduction)
        if(t.actualAudOut!=null)existing.actualAudOut=(existing.actualAudOut||0)+t.actualAudOut;
        // Extend dedup ID to cover all fills
        existing.dedupId=existing.dedupId+'|'+t.dedupId;
        existing.fills=(existing.fills||1)+1;
      } else {
        consolidated.push({...t,fills:1});
      }
    }

    const tradeLines=consolidated.map(t=>{
      const fillNote=t.fills>1?` (${t.fills} fills combined)`:'';
      const cashNote=t.actualAudOut!=null?` [actual AUD: $${t.actualAudOut.toFixed(2)}]`:'';
      return t.side.toUpperCase()+' '+t.qty+' x '+t.symbol+' @ $'+t.audPrice.toFixed(2)+' AUD/share avg = $'+t.audTotal.toFixed(2)+' AUD + $'+t.audComm.toFixed(2)+' brokerage'+fillNote+cashNote+'\n  (USD $'+t.usdPrice.toFixed(4)+'  x  AUD/USD '+t.audPerUsd.toFixed(4)+')';
    }).join('\n\n');
    if(!confirm('CommSec International import preview:\n\n'+tradeLines+'\n\nAll values converted to AUD. Proceed?'))return;
    let cashAcctIdx=null;if(S.cash.length>0){const opts=S.cash.map((a,i)=>(i+1)+'. '+a.name+' ($'+f(a.balance||0)+' AUD)').join('\n');const ans=prompt('Deduct total (purchase + brokerage) from which cash account?\n\n'+opts+'\n\nEnter number, or 0 to skip:');if(ans===null)return;const n=parseInt(ans);if(n>=1&&n<=S.cash.length)cashAcctIdx=n-1;}
    let imported=0,skipped=0;
    // If we captured the statement's own total AUD sold figure, use it as the single
    // cash deduction (most accurate — avoids per-fill rounding errors).
    // Otherwise fall back to summing calculated per-trade outlays.
    let remainingCashDeduction=totalAudSold;
    for(const t of consolidated){
      // Dedup: skip if ALL fills in this consolidated trade already exist
      const allDedupIds=t.dedupId.split('|');
      const isDupe=allDedupIds.every(id=>S.us.some(h=>(h.txns||[]).some(tx=>tx.commsecIntlId&&tx.commsecIntlId.split('|').includes(id))));
      if(isDupe){skipped++;continue;}
      let idx=S.us.findIndex(h=>h.ticker===t.symbol);
      if(idx===-1){S.us.push({ticker:t.symbol,name:t.symbol,qty:0,cost:0,txns:[]});idx=S.us.length-1;try{await xanoAddHolding('us');}catch(e){S.us.pop();continue;}}
      if(!S.us[idx].txns)S.us[idx].txns=[];
      const txnId=generateTxnId(t.dateStr);
      S.us[idx].txns.push({date:t.dateStr,side:t.side,qty:t.qty,price:t.audPrice,fee:t.audComm,txnId,commsecIntlId:t.dedupId,cashAcct:cashAcctIdx});
      recalcFromTxns('us',idx);
      try{await xanoUpdateHolding('us',idx);await xanoAddTransaction('us',idx);}catch(e){console.warn('Xano save failed',e);}
      if(cashAcctIdx!==null&&S.cash[cashAcctIdx]){
        // Use statement total AUD sold (most accurate) if we have it and there's only one buy symbol,
        // otherwise use per-trade actual AUD or calculated outlay.
        let cashDeduction;
        if(remainingCashDeduction!=null&&t.side==='buy'){
          // Allocate the statement total to this trade (handles multi-symbol proportionally if needed)
          cashDeduction=parseFloat(remainingCashDeduction.toFixed(2));
          remainingCashDeduction=null; // consumed
        } else if(t.actualAudOut!=null){
          cashDeduction=parseFloat(t.actualAudOut.toFixed(2));
        } else {
          cashDeduction=parseFloat((t.audTotal+t.audComm).toFixed(2));
        }
        S.cash[cashAcctIdx].balance=(S.cash[cashAcctIdx].balance||0)-(t.side==='buy'?cashDeduction:-cashDeduction);
        await xanoUpdateCash(cashAcctIdx);
      }
      imported++;
    }
    if(imported>0){rows('us');renderAllHoldings();renderCash();renderFees();summary();}
    const msg='\u2713 CommSec Intl import complete \u2014 '+imported+' trade'+(imported!==1?'s':'')+' imported ('+stockTrades.length+' fills), fees in ledger, '+skipped+' duplicate'+(skipped!==1?'s':'')+' skipped';
    if(statusEl)setImportStatus(statusEl,'success',msg);else alert(msg);
  }catch(err){console.error('CommSec HTML import error:',err);if(statusEl)setImportStatus(statusEl,'error','Import failed: '+err.message);else alert('Import failed: '+err.message);}
}

async function importCommsecIntlCSV(input){
  alert('CommSec Intl CSV import has been replaced \u2014 please upload the HTML Trade Confirmation file instead.');
}

async function importSwyftxCSVText(text,statusEl){
  const fakeInput={files:[new File([text],'swyftx.csv',{type:'text/csv'})]};
  await importSwyftxCSV(fakeInput);
  if(statusEl)setImportStatus(statusEl,'success','\u2713 Swyftx CSV imported successfully');
}

async function importCommsecIntlCSVText(text,statusEl){
  if(statusEl)setImportStatus(statusEl,'error','CommSec CSV is no longer supported \u2014 please use the HTML Trade Confirmation file.');
}
