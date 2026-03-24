const {
  getConfigList,
  getTransactionByHash,
  getTransactionsByAddress: fetchTransactionsByAddress
} = require('./etherscan');

const CHAIN_ID = 'ethereum';

function listChains() {
  return [CHAIN_ID];
}

async function findTxByHash(hash) {
  const tx = await getTransactionByHash(hash);
  if (!tx) {
    return null;
  }
  return { chainId: CHAIN_ID, tx };
}

async function getTransactionsByAddress(chainId, address) {
  if (chainId !== CHAIN_ID) {
    return [];
  }
  return fetchTransactionsByAddress(address);
}

async function getTransactionsByAddresses(chainId, addresses) {
  if (chainId !== CHAIN_ID) {
    return [];
  }
  const results = await Promise.all(
    addresses.map((address) => fetchTransactionsByAddress(address))
  );
  const flattened = results.flat();
  const seen = new Set();
  return flattened.filter((tx) => {
    if (seen.has(tx.hash)) {
      return false;
    }
    seen.add(tx.hash);
    return true;
  });
}

function getKnownMixers(chainId) {
  if (chainId !== CHAIN_ID) {
    return [];
  }
  return getConfigList('ETH_MIXERS');
}

function getKnownBridges(chainId) {
  if (chainId !== CHAIN_ID) {
    return [];
  }
  return getConfigList('ETH_BRIDGES');
}

function findBridgeTransactions() {
  return [];
}

function getChainData(chainId) {
  if (chainId !== CHAIN_ID) {
    return null;
  }
  return {
    name: 'Ethereum',
    symbol: 'ETH',
    mixers: getKnownMixers(chainId),
    bridges: getKnownBridges(chainId),
    contracts: getConfigList('ETH_CONTRACTS')
  };
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
