const fs = require('fs');
const path = require('path');

const dataPath = path.join(__dirname, '..', '..', 'shared', 'mock-data.json');

function loadData() {
  const raw = fs.readFileSync(dataPath, 'utf-8');
  return JSON.parse(raw);
}

function getChainData(chainId) {
  const data = loadData();
  const chain = data.chains[chainId];
  if (!chain) {
    return null;
  }
  return chain;
}

function listChains() {
  const data = loadData();
  return Object.keys(data.chains);
}

function findTxByHash(hash) {
  const data = loadData();
  for (const [chainId, chain] of Object.entries(data.chains)) {
    const match = chain.transactions.find((tx) => tx.hash === hash);
    if (match) {
      return { chainId, tx: match };
    }
  }
  return null;
}

function findBridgeTransactions(bridgeTag) {
  const data = loadData();
  const matches = [];
  for (const [chainId, chain] of Object.entries(data.chains)) {
    const hits = chain.transactions.filter((tx) => tx.bridgeTag === bridgeTag);
    for (const tx of hits) {
      matches.push({ chainId, tx });
    }
  }
  return matches;
}

function getTransactionsByAddress(chainId, address) {
  const chain = getChainData(chainId);
  if (!chain) {
    return [];
  }
  return chain.transactions.filter(
    (tx) => tx.from === address || tx.to === address
  );
}

function getTransactionsByAddresses(chainId, addresses) {
  const chain = getChainData(chainId);
  if (!chain) {
    return [];
  }
  const addressSet = new Set(addresses);
  return chain.transactions.filter(
    (tx) => addressSet.has(tx.from) || addressSet.has(tx.to)
  );
}

function getKnownMixers(chainId) {
  const chain = getChainData(chainId);
  if (!chain) {
    return [];
  }
  return chain.mixers || [];
}

function getKnownBridges(chainId) {
  const chain = getChainData(chainId);
  if (!chain) {
    return [];
  }
  return chain.bridges || [];
}

module.exports = {
  listChains,
  findTxByHash,
  findBridgeTransactions,
  getTransactionsByAddress,
  getTransactionsByAddresses,
  getKnownMixers,
  getKnownBridges,
  getChainData
};
