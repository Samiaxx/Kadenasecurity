const fs = require('fs');
const path = require('path');

const INDICATOR_PATH = path.join(__dirname, 'data', 'indicators.json');

const EMPTY = {
  mixers: {},
  bridges: {},
  cexEndpoints: {},
  drainerBytecodes: [], // lowercase keccak hashes
  fuelWallets: [], // lowercase
  taggedExploits: [], // lowercase
  domains: [] // { domain, contract, firstSeen }
};

let cache = loadIndicators();

function loadIndicators() {
  try {
    if (!fs.existsSync(INDICATOR_PATH)) {
      return JSON.parse(JSON.stringify(EMPTY));
    }
    const raw = fs.readFileSync(INDICATOR_PATH, 'utf-8');
    const data = JSON.parse(raw || '{}');
    return normalize(data);
  } catch (err) {
    console.error('[indicators] failed to load indicators:', err.message);
    return JSON.parse(JSON.stringify(EMPTY));
  }
}

function normalize(data) {
  const lower = (v) => (typeof v === 'string' ? v.toLowerCase() : v);
  return {
    mixers: data.mixers || {},
    bridges: data.bridges || {},
    cexEndpoints: data.cexEndpoints || {},
    drainerBytecodes: (data.drainerBytecodes || []).map(lower),
    fuelWallets: (data.fuelWallets || []).map(lower),
    taggedExploits: (data.taggedExploits || []).map(lower),
    domains: (data.domains || []).map((d) => ({
      domain: d.domain,
      contract: d.contract ? d.contract.toLowerCase() : '',
      firstSeen: d.firstSeen || null
    }))
  };
}

function getIndicators() {
  return cache;
}

function reloadIndicators() {
  cache = loadIndicators();
  return cache;
}

module.exports = {
  getIndicators,
  reloadIndicators,
  INDICATOR_PATH
};
