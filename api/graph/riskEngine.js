const { getKnownMixers, getKnownBridges, getChainData } = require('../indexers');
const { getIndicators } = require('../indicators');

const FAN_OUT_THRESHOLD = 3;
const SMALL_TRANSFER_FANOUT_THRESHOLD = 4;
const SMALL_TRANSFER_MAX = 0.5; // ETH/BNB/BTC equivalent threshold for peel chains
const RAPID_HOP_MINUTES = 2;
const RAPID_CASHOUT_MINUTES = 30; // drain -> bridge/mixer window seen in public cases
const STABLE_SYMBOLS = new Set(['usdt', 'usdc', 'dai', 'busd']);

function scoreGraphRisk(graph) {
  const indicators = getIndicators();
  const drainerHashes = new Set(indicators.drainerBytecodes || []);
  const fuelWallets = new Set((indicators.fuelWallets || []).map((a) => a.toLowerCase()));
  const exploitSet = new Set((indicators.taggedExploits || []).map((a) => a.toLowerCase()));
  const phishingContracts = new Map();
  (indicators.domains || []).forEach((entry) => {
    if (entry.contract) {
      const key = entry.contract.toLowerCase();
      if (!phishingContracts.has(key)) phishingContracts.set(key, []);
      phishingContracts.get(key).push(entry.domain || 'phishing');
    }
  });

  const edgeByFrom = new Map();
  for (const edge of graph.edges) {
    if (!edgeByFrom.has(edge.from)) {
      edgeByFrom.set(edge.from, []);
    }
    edgeByFrom.get(edge.from).push(edge);
  }

  const fanOutAddresses = new Set();
  const smallFanOutAddresses = new Set();
  for (const [from, edges] of edgeByFrom.entries()) {
    const uniqueRecipients = new Set(edges.map((edge) => edge.to));
    if (uniqueRecipients.size >= FAN_OUT_THRESHOLD) {
      fanOutAddresses.add(from);
    }

    const smallValueEdges = edges.filter((edge) => Number(edge.amount) > 0 && Number(edge.amount) <= SMALL_TRANSFER_MAX);
    const uniqueSmallRecipients = new Set(smallValueEdges.map((edge) => edge.to));
    if (uniqueSmallRecipients.size >= SMALL_TRANSFER_FANOUT_THRESHOLD) {
      smallFanOutAddresses.add(from);
    }
  }

  const rapidHopEdges = new Set();
  const rapidCashoutEdges = new Set();
  const edgeByTo = new Map();
  for (const edge of graph.edges) {
    if (!edgeByTo.has(edge.to)) {
      edgeByTo.set(edge.to, []);
    }
    edgeByTo.get(edge.to).push(edge);
  }

  for (const [address, incomingEdges] of edgeByTo.entries()) {
    const outgoingEdges = edgeByFrom.get(address) || [];
    for (const incoming of incomingEdges) {
      for (const outgoing of outgoingEdges) {
        const timeDiff = Math.abs(new Date(outgoing.timestamp) - new Date(incoming.timestamp));
        const minutes = timeDiff / 60000;
        if (minutes <= RAPID_HOP_MINUTES) {
          rapidHopEdges.add(outgoing.id);
        }
      }
    }
  }

  // Rapid cash-out: incoming -> outgoing to mixer/bridge/cex within 30 minutes
  const chainEndpointCache = new Map();
  function getChainEndpoints(chain) {
    if (!chainEndpointCache.has(chain)) {
      const data = getChainData(chain) || {};
      chainEndpointCache.set(chain, {
        mixers: new Set(data.mixers || []),
        bridges: new Set(data.bridges || []),
        cex: new Set(data.cexEndpoints || [])
      });
    }
    return chainEndpointCache.get(chain);
  }

  for (const [address, incomingEdges] of edgeByTo.entries()) {
    const outgoingEdges = edgeByFrom.get(address) || [];
    for (const incoming of incomingEdges) {
      for (const outgoing of outgoingEdges) {
        const minutes = Math.abs(new Date(outgoing.timestamp) - new Date(incoming.timestamp)) / 60000;
        if (minutes > RAPID_CASHOUT_MINUTES) {
          continue;
        }
        const endpoints = getChainEndpoints(outgoing.chain);
        if (
          endpoints.mixers.has(outgoing.rawTo) ||
          endpoints.bridges.has(outgoing.rawTo) ||
          endpoints.cex.has(outgoing.rawTo) ||
          outgoing.type === 'bridge' ||
          outgoing.type === 'mixer'
        ) {
          rapidCashoutEdges.add(outgoing.id);
        }
      }
    }
  }

  const mixersByChain = new Map();
  const bridgesByChain = new Map();
  const cexByChain = new Map();
  const sinksByChain = new Map();
  for (const edge of graph.edges) {
    if (!mixersByChain.has(edge.chain)) {
      mixersByChain.set(edge.chain, new Set(getKnownMixers(edge.chain)));
      bridgesByChain.set(edge.chain, new Set(getKnownBridges(edge.chain)));
      const chainData = getChainData(edge.chain) || {};
      const indicatorMixers = new Set((indicators.mixers?.[edge.chain] || []).map((v) => v.toLowerCase()));
      const indicatorBridges = new Set((indicators.bridges?.[edge.chain] || []).map((v) => v.toLowerCase()));
      const indicatorCex = new Set((indicators.cexEndpoints?.[edge.chain] || []).map((v) => v.toLowerCase()));
      // merge env + indicators
      const combinedMixers = new Set([...mixersByChain.get(edge.chain), ...indicatorMixers]);
      const combinedBridges = new Set([...bridgesByChain.get(edge.chain), ...indicatorBridges]);
      const combinedCex = new Set([...(chainData.cexEndpoints || []), ...indicatorCex]);

      mixersByChain.set(edge.chain, combinedMixers);
      bridgesByChain.set(edge.chain, combinedBridges);
      cexByChain.set(edge.chain, combinedCex);
      sinksByChain.set(edge.chain, new Set([...combinedMixers, ...combinedBridges, ...combinedCex]));
    }
  }

  // Precompute cex reuse
  const cexCounts = new Map();
  for (const edge of graph.edges) {
    const cex = cexByChain.get(edge.chain) || new Set();
    if (cex.has((edge.rawTo || '').toLowerCase())) {
      const key = `${edge.chain}:${edge.rawTo.toLowerCase()}`;
      cexCounts.set(key, (cexCounts.get(key) || 0) + 1);
    }
  }

  for (const edge of graph.edges) {
    const flags = [];
    const mixers = mixersByChain.get(edge.chain) || new Set();
    const bridges = bridgesByChain.get(edge.chain) || new Set();
    const cex = cexByChain.get(edge.chain) || new Set();
    const sinks = sinksByChain.get(edge.chain) || new Set();

    if (mixers.has(edge.rawFrom) || mixers.has(edge.rawTo) || edge.type === 'mixer') {
      flags.push('mixer');
    }
    if (bridges.has(edge.rawFrom) || bridges.has(edge.rawTo) || edge.type === 'bridge') {
      flags.push('bridge');
    }
    if (fanOutAddresses.has(edge.from)) {
      flags.push('fan-out');
    }
    if (smallFanOutAddresses.has(edge.from)) {
      flags.push('peel-chain');
    }
    if (rapidHopEdges.has(edge.id)) {
      flags.push('rapid-hop');
    }
    if (rapidCashoutEdges.has(edge.id)) {
      flags.push('rapid-cashout');
    }
    if (cex.has(edge.rawTo) || cex.has(edge.rawFrom)) {
      flags.push('cex-endpoint');
    }
    const cexKey = `${edge.chain}:${(edge.rawTo || '').toLowerCase()}`;
    if (cexCounts.get(cexKey) > 1) {
      flags.push('cex-reuse');
    }
    if (sinks.has((edge.rawTo || '').toLowerCase())) {
      flags.push('funnel-sink');
    }
    if (fuelWallets.has((edge.rawFrom || '').toLowerCase())) {
      flags.push('fuel-wallet');
    }
    if (exploitSet.has((edge.rawFrom || '').toLowerCase()) || exploitSet.has((edge.rawTo || '').toLowerCase())) {
      flags.push('known-exploit');
    }
    if (phishingContracts.has((edge.rawTo || '').toLowerCase())) {
      flags.push('phishing-contract');
    }
    if (flags.includes('mixer') && cex.has((edge.rawTo || '').toLowerCase())) {
      flags.push('mixer-funnel');
    }
    if (flags.includes('bridge')) {
      flags.push('bridge-pivot');
    }
    if (flags.includes('peel-chain') && flags.includes('rapid-cashout')) {
      flags.push('fast-peel');
    }
    const assetSym = (edge.asset || '').toString().toLowerCase();
    if (flags.includes('peel-chain') && STABLE_SYMBOLS.has(assetSym)) {
      flags.push('stable-peel');
    }
    if (Array.isArray(edge.flags)) {
      edge.flags.forEach((f) => flags.push(f));
    }

    let score = flags.length * 20;
    if (flags.includes('rapid-cashout') || flags.includes('cex-endpoint')) {
      score += 10;
    }
    if (flags.includes('peel-chain')) {
      score += 10;
    }
    if (edge.type === 'theft') {
      score += 20;
    }
    score = Math.min(100, score);
    edge.riskFlags = flags;
    edge.riskScore = score;
    edge.suspicious = score >= 50;
  }

  const nodeRisk = new Map();
  for (const edge of graph.edges) {
    const toScore = nodeRisk.get(edge.to) || 0;
    const fromScore = nodeRisk.get(edge.from) || 0;
    nodeRisk.set(edge.to, Math.max(toScore, edge.riskScore));
    nodeRisk.set(edge.from, Math.max(fromScore, edge.riskScore));
  }

  graph.nodes = graph.nodes.map((node) => {
    const risk = nodeRisk.get(node.id) || 0;
    const isExploit = exploitSet.has((node.label || '').toLowerCase());
    return {
      ...node,
      riskScore: Math.max(risk, isExploit ? 90 : 0),
      riskLevel: (Math.max(risk, isExploit ? 90 : 0)) >= 75 ? 'high' : (Math.max(risk, isExploit ? 90 : 0)) >= 50 ? 'medium' : 'low'
    };
  });

  graph.meta = {
    generatedAt: new Date().toISOString(),
    chains: summarizeChains(graph)
  };

  return graph;
}

function summarizeChains(graph) {
  const summary = {};
  for (const edge of graph.edges) {
    if (!summary[edge.chain]) {
      const chainData = getChainData(edge.chain) || { name: edge.chain };
      summary[edge.chain] = {
        name: chainData.name || edge.chain,
        edges: 0,
        suspiciousEdges: 0
      };
    }
    summary[edge.chain].edges += 1;
    if (edge.suspicious) {
      summary[edge.chain].suspiciousEdges += 1;
    }
  }
  return summary;
}

module.exports = {
  scoreGraphRisk
};
