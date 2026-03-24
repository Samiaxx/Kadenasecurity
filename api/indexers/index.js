const { createEvmIndexer } = require('./evmV2');
const { createBitcoinIndexer } = require('./bitcoin');

const ETH_INDEXER = createEvmIndexer({
  chainId: process.env.ETH_CHAIN_ID || '1',
  name: 'Ethereum',
  symbol: 'ETH',
  apiUrl: process.env.ETHERSCAN_API_URL || 'https://api.etherscan.io/v2/api',
  apiKey: process.env.ETHERSCAN_API_KEY || '',
  txLimit: Number(process.env.ETHERSCAN_TX_LIMIT || 25),
  minIntervalMs: Number(process.env.ETHERSCAN_MIN_INTERVAL_MS || 350),
  mixers: process.env.ETH_MIXERS || '',
  bridges: process.env.ETH_BRIDGES || '',
  contracts: process.env.ETH_CONTRACTS || ''
});

const BSC_INDEXER = createEvmIndexer({
  chainId: process.env.BSC_CHAIN_ID || '56',
  name: 'BNB Smart Chain',
  symbol: 'BNB',
  apiUrl: process.env.BSCSCAN_API_URL || process.env.ETHERSCAN_API_URL || 'https://api.etherscan.io/v2/api',
  apiKey: process.env.BSCSCAN_API_KEY || process.env.ETHERSCAN_API_KEY || '',
  txLimit: Number(process.env.BSCSCAN_TX_LIMIT || 25),
  minIntervalMs: Number(process.env.BSCSCAN_MIN_INTERVAL_MS || 350),
  mixers: process.env.BSC_MIXERS || '',
  bridges: process.env.BSC_BRIDGES || '',
  contracts: process.env.BSC_CONTRACTS || ''
});

const BTC_INDEXER = createBitcoinIndexer({
  apiUrl: process.env.BTC_API_URL || 'https://blockstream.info/api',
  txLimit: Number(process.env.BTC_TX_LIMIT || 25),
  minIntervalMs: Number(process.env.BTC_MIN_INTERVAL_MS || 250),
  mixers: process.env.BTC_MIXERS || '',
  bridges: process.env.BTC_BRIDGES || ''
});

const CHAIN_INDEXERS = {
  ethereum: ETH_INDEXER,
  bsc: BSC_INDEXER,
  bitcoin: BTC_INDEXER
};

function listChains() {
  return Object.keys(CHAIN_INDEXERS);
}

async function findTxByHash(hash) {
  for (const indexer of Object.values(CHAIN_INDEXERS)) {
    const result = await indexer.getTransactionByHash(hash).catch(() => null);
    if (result) {
      return { chainId: indexer.chainId, txs: Array.isArray(result) ? result : [result] };
    }
  }
  return null;
}

async function getTransactionsByAddress(chainId, address) {
  const indexer = CHAIN_INDEXERS[chainId];
  if (!indexer) {
    return [];
  }
  return indexer.getTransactionsByAddress(address);
}

async function getTransactionsByAddresses(chainId, addresses) {
  const indexer = CHAIN_INDEXERS[chainId];
  if (!indexer) {
    return [];
  }
  const results = await Promise.all(addresses.map((addr) => indexer.getTransactionsByAddress(addr)));
  const flattened = results.flat();
  const seen = new Set();
  return flattened.filter((tx) => {
    const id = tx.edgeId || tx.hash;
    if (seen.has(id)) {
      return false;
    }
    seen.add(id);
    return true;
  });
}

function getKnownMixers(chainId) {
  const indexer = CHAIN_INDEXERS[chainId];
  return indexer ? indexer.mixers : [];
}

function getKnownBridges(chainId) {
  const indexer = CHAIN_INDEXERS[chainId];
  return indexer ? indexer.bridges.map((entry) => entry.address || entry) : [];
}

function getChainData(chainId) {
  const indexer = CHAIN_INDEXERS[chainId];
  if (!indexer) {
    return null;
  }
  return {
    name: indexer.name,
    symbol: indexer.symbol,
    mixers: indexer.mixers,
    bridges: indexer.bridges.map((entry) => entry.address || entry),
    contracts: indexer.contracts || []
  };
}

async function findBridgeTransactions(bridgeTag) {
  const matches = [];
  for (const indexer of Object.values(CHAIN_INDEXERS)) {
    const entry = indexer.getBridgeEntries().find((item) => item.tag === bridgeTag);
    if (!entry) {
      continue;
    }
    const txs = await indexer.getTransactionsByAddress(entry.address).catch(() => []);
    txs.forEach((tx) => {
      matches.push({ chainId: indexer.chainId, tx });
    });
  }
  return matches;
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
