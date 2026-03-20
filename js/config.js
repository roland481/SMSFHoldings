// ══════════════════════════════════════════════════════════════
// ── XANO CONFIG ──────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════
const XANO_BASE = 'https://x8ki-letl-twmt.n7.xano.io/api:wk8lL_Py';


const FINHUB_KEY = 'd6pl1a9r01qo88ajl29gd6pl1a9r01qo88ajl2a0';
const DEF = {
  us:[],asx:[],cry:[],met:[],cash:[],fees:[],income:[],contributions:[],transfers:[],wl:[]
};
const CID={BTC:'bitcoin',ETH:'ethereum',SOL:'solana',ADA:'cardano',XRP:'ripple',BNB:'binancecoin',DOGE:'dogecoin',DOT:'polkadot',AVAX:'avalanche-2',MATIC:'matic-network',LINK:'chainlink',UNI:'uniswap',LTC:'litecoin',ATOM:'cosmos',NEAR:'near',SHIB:'shiba-inu',TRX:'tron',BCH:'bitcoin-cash',XLM:'stellar',ALGO:'algorand',XMR:'monero',ETC:'ethereum-classic'};
const PIE_COLORS=['#5754fd','#5757e8','#494f91','#5de36c','#5de36c','#42ac5c','#cea350','#b8903f','#9a7a2e','#c46061','#a84f50','#5de36c','#8080f5','#9b9fc8','#7070d0','#212851','#2a3260'];
const S = { audUsd:0.695, prices:{}, us:[], asx:[], cry:[], met:[], cash:[], fees:[], income:[], contributions:[], transfers:[], wl:[] };
let pieChart = null;
