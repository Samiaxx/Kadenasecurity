const { parseList, parseTaggedList } = require('./evmV2');

function createRequestQueue(minIntervalMs) {
  let requestQueue = Promise.resolve();
  let lastRequestTime = 0;

  function enqueue(fn) {
    requestQueue = requestQueue.then(async () => {
      const now = Date.now();
      const wait = Math.max(0, minIntervalMs - (now - lastRequestTime));
      if (wait > 0) {
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
      const result = await fn();
      lastRequestTime = Date.now();
      return result;
    });
    return requestQueue;
  }

  return enqueue;
}

function createBitcoinIndexer(config) {
  const apiUrl = config.apiUrl;
  const txLimit = config.txLimit;
  const minIntervalMs = config.minIntervalMs;
  const mixers = parseList(config.mixers || '');
  const bridges = parseTaggedList(config.bridges || '');
  const symbol = 'BTC';
  const name = 'Bitcoin';
  const enqueue = createRequestQueue(minIntervalMs);

  async function fetchJson(path) {
    return enqueue(async () => {
      const response = await fetch(`${apiUrl}${path}`);
      if (!response.ok) {
        throw new Error(`Blockstream request failed: ${response.status}`);
      }
      return response.json();
    });
  }

  function satsToBtc(value) {
    return Number(value) / 1e8;
  }

  function resolveBridgeTag(address) {
    const hit = bridges.find((entry) => entry.address.toLowerCase() === address.toLowerCase());
    return hit ? hit.tag : null;
  }

  function getTxTimestamp(tx) {
    if (tx.status && tx.status.block_time) {
      return new Date(Number(tx.status.block_time) * 1000).toISOString();
    }
    return new Date().toISOString();
  }

  function expandTxToEdges(tx) {
    const edges = [];
    const timestamp = getTxTimestamp(tx);
    const inputs = tx.vin || [];
    const outputs = tx.vout || [];
    const inputAddresses = inputs
      .map((vin) => vin.prevout && vin.prevout.scriptpubkey_address)
      .filter(Boolean);

    outputs.forEach((vout, index) => {
      const toAddress = vout.scriptpubkey_address;
      if (!toAddress) {
        return;
      }
      const voutIndex = vout.n !== undefined ? vout.n : index;
      const amount = satsToBtc(vout.value || 0);
      const bridgeTag = resolveBridgeTag(toAddress) || inputAddresses.map(resolveBridgeTag).find(Boolean);
      const isBridgeTx = Boolean(bridgeTag);
      edges.push({
        edgeId: `${tx.txid}:${voutIndex}`,
        hash: tx.txid,
        from: inputAddresses[0] || 'UNKNOWN',
        to: toAddress,
        amount,
        asset: symbol,
        timestamp,
        type: isBridgeTx ? 'bridge' : 'transfer',
        bridgeTag: bridgeTag || null
      });
    });
    return edges;
  }

  async function getTransactionByHash(txid) {
    const tx = await fetchJson(`/tx/${txid}`);
    if (!tx) {
      return null;
    }
    const edges = expandTxToEdges(tx);
    return edges.length > 0 ? edges : null;
  }

  async function getTransactionsByAddress(address) {
    const txs = await fetchJson(`/address/${address}/txs`);
    const limited = Array.isArray(txs) ? txs.slice(0, txLimit) : [];
    const edges = [];
    limited.forEach((tx) => {
      edges.push(...expandTxToEdges(tx));
    });
    return edges;
  }

  function getBridgeEntries() {
    return bridges;
  }

  return {
    chainId: 'bitcoin',
    name,
    symbol,
    getTransactionByHash,
    getTransactionsByAddress,
    getBridgeEntries,
    mixers,
    bridges,
    contracts: []
  };
}

module.exports = {
  createBitcoinIndexer
};
