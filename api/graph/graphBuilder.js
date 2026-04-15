const {
  listChains,
  findTxByHash,
  findBridgeTransactions,
  getTransactionsByAddresses,
  getKnownMixers,
  getKnownBridges,
  getChainData
} = require('../indexers');
const { scoreGraphRisk } = require('./riskEngine');

function looksLikeTxHash(seed) {
  const isHex64 = /^[0-9a-fA-F]{64}$/.test(seed);
  const isHexPrefixed = /^0x[0-9a-fA-F]{64}$/.test(seed);
  return isHex64 || isHexPrefixed;
}

async function buildGraph({ seed, depth = 2, maxNodes = 120 }) {
  const chains = listChains();
  const nodes = new Map();
  const edges = [];
  const edgeSet = new Set();
  const queue = [];
  const visited = new Set();

  const seedInfo = looksLikeTxHash(seed) ? await findTxByHash(seed) : null;
  if (seedInfo) {
    const { chainId, txs } = seedInfo; // chainId here is the chain key used in CHAIN_INDEXERS
    txs.forEach((tx) => {
      if (tx.from) {
        queue.push({ chainId, address: tx.from, depth: 0 });
      }
      if (tx.to) {
        queue.push({ chainId, address: tx.to, depth: 0 });
      }
      addEdge(edges, edgeSet, normalizeEdge(chainId, tx));
    });
  } else {
    for (const chainId of chains) {
      queue.push({ chainId, address: seed, depth: 0 });
    }
  }

  while (queue.length > 0 && nodes.size < maxNodes) {
    const current = queue.shift();
    const key = `${current.chainId}:${current.address}`;
    if (visited.has(key)) {
      continue;
    }
    visited.add(key);

    const chainData = getChainData(current.chainId);
    if (!chainData) {
      continue;
    }

    addNode(nodes, {
      id: key,
      label: current.address,
      chain: current.chainId,
      type: classifyAddress(current.chainId, current.address)
    });

    if (current.depth >= depth) {
      continue;
    }

    const txs = await getTransactionsByAddresses(current.chainId, [current.address]);
    for (const tx of txs) {
      addEdge(edges, edgeSet, normalizeEdge(current.chainId, tx));
      addNode(nodes, {
        id: `${current.chainId}:${tx.from}`,
        label: tx.from,
        chain: current.chainId,
        type: classifyAddress(current.chainId, tx.from)
      });
      addNode(nodes, {
        id: `${current.chainId}:${tx.to}`,
        label: tx.to,
        chain: current.chainId,
        type: classifyAddress(current.chainId, tx.to)
      });
      const nextAddresses = [tx.from, tx.to];
      for (const addr of nextAddresses) {
        const nextKey = `${current.chainId}:${addr}`;
        if (!visited.has(nextKey)) {
          queue.push({ chainId: current.chainId, address: addr, depth: current.depth + 1 });
        }
      }

      if (tx.type === 'bridge') {
        if (tx.bridgeTag) {
          const matches = await findBridgeTransactions(tx.bridgeTag);
          for (const match of matches) {
            if (match.chainId === current.chainId) {
              continue;
            }
            addEdge(edges, edgeSet, normalizeEdge(match.chainId, match.tx));
            addNode(nodes, {
              id: `${match.chainId}:${match.tx.from}`,
              label: match.tx.from,
              chain: match.chainId,
              type: classifyAddress(match.chainId, match.tx.from)
            });
            addNode(nodes, {
              id: `${match.chainId}:${match.tx.to}`,
              label: match.tx.to,
              chain: match.chainId,
              type: classifyAddress(match.chainId, match.tx.to)
            });
            queue.push({ chainId: match.chainId, address: match.tx.from, depth: current.depth + 1 });
            queue.push({ chainId: match.chainId, address: match.tx.to, depth: current.depth + 1 });
          }
        } else {
          const bridgeChain = tx.bridgeTo || tx.bridgeFrom;
          if (bridgeChain && chains.includes(bridgeChain)) {
            const bridgeAddress = tx.bridgeTo ? tx.to : tx.from;
            queue.push({ chainId: bridgeChain, address: bridgeAddress, depth: current.depth + 1 });
          }
        }
      }
    }
  }

  const graph = {
    nodes: Array.from(nodes.values()),
    edges
  };

  return scoreGraphRisk(graph);
}

function classifyAddress(chainId, address) {
  const mixers = new Set(getKnownMixers(chainId));
  const bridges = new Set(getKnownBridges(chainId));
  const chainData = getChainData(chainId) || {};
  const contracts = new Set(chainData.contracts || []);
  if (mixers.has(address)) {
    return 'mixer';
  }
  if (bridges.has(address)) {
    return 'bridge';
  }
  if (contracts.has(address)) {
    return 'contract';
  }
  return 'wallet';
}

function normalizeEdge(chainId, tx) {
  const edgeKey = tx.edgeId || tx.hash;
  return {
    id: `${chainId}:${edgeKey}`,
    hash: tx.hash,
    from: `${chainId}:${tx.from}`,
    to: `${chainId}:${tx.to}`,
    source: `${chainId}:${tx.from}`,
    target: `${chainId}:${tx.to}`,
    rawFrom: tx.from,
    rawTo: tx.to,
    amount: tx.amount,
    asset: tx.asset,
    timestamp: tx.timestamp,
    chain: chainId,
    type: tx.type,
    bridgeTag: tx.bridgeTag || null
  };
}

function addNode(nodes, node) {
  if (!nodes.has(node.id)) {
    nodes.set(node.id, node);
  }
}

function addEdge(edges, edgeSet, edge) {
  if (!edgeSet.has(edge.id)) {
    edges.push(edge);
    edgeSet.add(edge.id);
  }
}

module.exports = {
  buildGraph
};
