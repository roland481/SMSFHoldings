// ══════════════════════════════════════════════════════════════
// ── XANO CONFIG ──────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════
const XANO_BASE = 'https://x8ki-letl-twmt.n7.xano.io/api:wk8lL_Py';


const FINHUB_KEY = 'd6pl1a9r01qo88ajl29gd6pl1a9r01qo88ajl2a0';
const DEF = {
  us:[],asx:[],cry:[],met:[],cash:[],fees:[],income:[],contributions:[],transfers:[],wl:[]
};
const CID={BTC:'bitcoin',ETH:'ethereum',SOL:'solana',ADA:'cardano',XRP:'ripple',BNB:'binancecoin',DOGE:'dogecoin',DOT:'polkadot',AVAX:'avalanche-2',MATIC:'matic-network',LINK:'chainlink',UNI:'uniswap',LTC:'litecoin',ATOM:'cosmos',NEAR:'near',SHIB:'shiba-inu',TRX:'tron',BCH:'bitcoin-cash',XLM:'stellar',ALGO:'algorand',XMR:'monero',ETC:'ethereum-classic'};
const PIE_COLORS=['#00d4ff','#38e8ff','#7ef0ff','#818cf8','#a5b4fc','#6366f1','#f59e0b','#fbbf24','#f97316','#10b981','#34d399','#94a3b8','#64748b','#f43f5e','#fb7185','#a78bfa','#c4b5fd'];
const S = { audUsd:0.695, prices:{}, us:[], asx:[], cry:[], met:[], cash:[], fees:[], income:[], contributions:[], transfers:[], wl:[] };
let pieChart = null;
