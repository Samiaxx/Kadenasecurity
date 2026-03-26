function parseList(value) {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseTaggedList(value) {
  return parseList(value).map((entry) => {
    const parts = entry.split('|').map((item) => item.trim()).filter(Boolean);
    if (parts.length === 0) {
      return null;
    }
    const address = parts[0];
    const tag = parts[1] || address;
    return { address, tag };
  }).filter(Boolean);
}

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

function createEvmIndexer(config) {
  const apiUrl = config.apiUrl;
  const apiKey = config.apiKey;
  const chainId = config.chainId;
  const txLimit = config.txLimit;
  const minIntervalMs = config.minIntervalMs;
  const symbol = config.symbol;
  const name = config.name;
  const isV2 = config.useV2 ?? apiUrl.includes('/v2/');
  const mixers = parseList(config.mixers || '');
  const bridges = parseTaggedList(config.bridges || '');
  const contracts = parseList(config.contracts || '');
  const enqueue = createRequestQueue(minIntervalMs);

  function buildUrl(params) {
    const url = new URL(apiUrl);
    if (isV2 && chainId) {
      url.searchParams.set('chainid', chainId);
    }
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    });
    if (apiKey) {
      url.searchParams.set('apikey', apiKey);
    }
    return url.toString();
  }

  async function fetchJson(url) {
    if (process.env.DEBUG_API_URL_LOG !== 'done') {
      console.log(`[evm-${name}] using URL: ${url}`);
      console.log(`[evm-${name}] apiKey set: ${apiKey ? 'yes' : 'no'}`);
      process.env.DEBUG_API_URL_LOG = 'done';
    }
    return enqueue(async () => {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Etherscan request failed: ${response.status}`);
      }
      const text = await response.text();
      try {
        return JSON.parse(text);
      } catch (err) {
        console.error(`[evm-${name}] non-JSON response: ${text}`);
        throw err;
      }
    });
  }

  function weiToEth(value) {
    try {
      const wei = BigInt(value);
      return Number(wei) / 1e18;
    } catch (error) {
      return Number(value) / 1e18;
    }
  }

  function resolveBridgeTag(address) {
    const hit = bridges.find((entry) => entry.address.toLowerCase() === address.toLowerCase());
    return hit ? hit.tag : null;
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

  function decorateTx(tx, input) {
    const from = tx.from || '';
    const to = tx.to || '';
    const bridgeTag = resolveBridgeTag(from) || resolveBridgeTag(to);
    const isBridge = Boolean(bridgeTag);
    const isContract = input && input !== '0x';
    return {
      ...tx,
      type: isBridge ? 'bridge' : isContract ? 'contract' : 'transfer',
      bridgeTag
    };
  }

  async function getTransactionByHash(hash) {
    const url = buildUrl({
      module: 'proxy',
      action: 'eth_getTransactionByHash',
      txhash: hash
    });
    const payload = await fetchJson(url);
    const tx = payload.result;
    if (!tx) {
      return null;
    }
    const timestamp = await getBlockTimestamp(tx.blockNumber);
    return decorateTx(
      {
        hash: tx.hash,
        from: tx.from,
        to: tx.to || 'CONTRACT_CREATION',
        amount: weiToEth(tx.value || '0'),
        asset: symbol,
        timestamp: timestamp || new Date().toISOString()
      },
      tx.input
    );
  }

  async function getTransactionsByAddress(address) {
    const url = buildUrl({
      module: 'account',
      action: 'txlist',
      address,
      startblock: 0,
      endblock: 99999999,
      page: 1,
      offset: txLimit,
      sort: 'desc'
    });
    const payload = await fetchJson(url);
    if (payload.status !== '1' && payload.message !== 'No transactions found') {
      try {
        require('fs').appendFileSync(
          require('path').join(__dirname, '..', 'evm-debug.log'),
          `[${new Date().toISOString()}][${name}] txlist error URL=${url}\n${JSON.stringify(payload)}\n\n`
        );
      } catch (err) {
        /* ignore */
      }
      console.error(`[evm-${name}] txlist error`, payload);
      throw new Error(payload.result || payload.message || 'Etherscan txlist error');
    }
    const list = Array.isArray(payload.result) ? payload.result : [];
    return list.map((tx) =>
      decorateTx(
        {
          hash: tx.hash,
          from: tx.from,
          to: tx.to || 'CONTRACT_CREATION',
          amount: weiToEth(tx.value || '0'),
          asset: symbol,
          timestamp: new Date(Number(tx.timeStamp) * 1000).toISOString()
        },
        tx.input
      )
    );
  }

  function getBridgeEntries() {
    return bridges;
  }

  return {
    chainId,
    name,
    symbol,
    getTransactionByHash,
    getTransactionsByAddress,
    getBridgeEntries,
    mixers,
    bridges,
    contracts
  };
}

module.exports = {
  createEvmIndexer,
  parseList,
  parseTaggedList
};
