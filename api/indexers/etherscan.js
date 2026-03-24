const ETHERSCAN_API_URL = process.env.ETHERSCAN_API_URL || 'https://api.etherscan.io/api';
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY || '';
const ETHERSCAN_TX_LIMIT = Number(process.env.ETHERSCAN_TX_LIMIT || 50);

function parseList(value) {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function getConfigList(envKey) {
  return parseList(process.env[envKey] || '');
}

function buildUrl(params) {
  const url = new URL(ETHERSCAN_API_URL);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  });
  if (ETHERSCAN_API_KEY) {
    url.searchParams.set('apikey', ETHERSCAN_API_KEY);
  }
  return url.toString();
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Etherscan request failed: ${response.status}`);
  }
  return response.json();
}

function weiToEth(value) {
  try {
    const wei = BigInt(value);
    return Number(wei) / 1e18;
  } catch (error) {
    return Number(value) / 1e18;
  }
}

async function getBlockTimestamp(blockNumberHex) {
  if (!blockNumberHex) {
    return null;
  }
  const url = buildUrl({
    module: 'proxy',
    action: 'eth_getBlockByNumber',
    tag: blockNumberHex,
    boolean: 'true'
  });
  const payload = await fetchJson(url);
  const block = payload.result;
  if (!block || !block.timestamp) {
    return null;
  }
  const seconds = Number(BigInt(block.timestamp));
  return new Date(seconds * 1000).toISOString();
}

async function getTransactionByHash(txHash) {
  const url = buildUrl({
    module: 'proxy',
    action: 'eth_getTransactionByHash',
    txhash: txHash
  });
  const payload = await fetchJson(url);
  const tx = payload.result;
  if (!tx) {
    return null;
  }
  const timestamp = await getBlockTimestamp(tx.blockNumber);
  return {
    hash: tx.hash,
    from: tx.from,
    to: tx.to || 'CONTRACT_CREATION',
    amount: weiToEth(tx.value || '0'),
    asset: 'ETH',
    timestamp: timestamp || new Date().toISOString(),
    type: tx.input && tx.input !== '0x' ? 'contract' : 'transfer'
  };
}

async function getTransactionsByAddress(address) {
  const url = buildUrl({
    module: 'account',
    action: 'txlist',
    address,
    startblock: 0,
    endblock: 99999999,
    page: 1,
    offset: ETHERSCAN_TX_LIMIT,
    sort: 'desc'
  });
  const payload = await fetchJson(url);
  if (payload.status !== '1' && payload.message !== 'No transactions found') {
    throw new Error(payload.result || 'Etherscan txlist error');
  }
  const list = Array.isArray(payload.result) ? payload.result : [];
  return list.map((tx) => ({
    hash: tx.hash,
    from: tx.from,
    to: tx.to || 'CONTRACT_CREATION',
    amount: weiToEth(tx.value || '0'),
    asset: 'ETH',
    timestamp: new Date(Number(tx.timeStamp) * 1000).toISOString(),
    type: tx.input && tx.input !== '0x' ? 'contract' : 'transfer'
  }));
}

module.exports = {
  getConfigList,
  getTransactionByHash,
  getTransactionsByAddress,
  ETHERSCAN_TX_LIMIT
};
