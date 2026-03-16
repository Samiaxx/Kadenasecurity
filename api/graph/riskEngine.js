const { getKnownMixers, getKnownBridges, getChainData } = require('../indexers');

const FAN_OUT_THRESHOLD = 3;
const RAPID_HOP_MINUTES = 2;

function scoreGraphRisk(graph) {
  const edgeByFrom = new Map();
  for (const edge of graph.edges) {
    if (!edgeByFrom.has(edge.from)) {
      edgeByFrom.set(edge.from, []);
    }
    edgeByFrom.get(edge.from).push(edge);
  }

  const fanOutAddresses = new Set();
  for (const [from, edges] of edgeByFrom.entries()) {
    const uniqueRecipients = new Set(edges.map((edge) => edge.to));
    if (uniqueRecipients.size >= FAN_OUT_THRESHOLD) {
      fanOutAddresses.add(from);
    }
  }

  const rapidHopEdges = new Set();
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

  const mixersByChain = new Map();
  const bridgesByChain = new Map();
  for (const edge of graph.edges) {
    if (!mixersByChain.has(edge.chain)) {
      mixersByChain.set(edge.chain, new Set(getKnownMixers(edge.chain)));
      bridgesByChain.set(edge.chain, new Set(getKnownBridges(edge.chain)));
    }
  }

  for (const edge of graph.edges) {
    const flags = [];
    const mixers = mixersByChain.get(edge.chain) || new Set();
    const bridges = bridgesByChain.get(edge.chain) || new Set();

    if (mixers.has(edge.rawFrom) || mixers.has(edge.rawTo) || edge.type === 'mixer') {
      flags.push('mixer');
    }
    if (bridges.has(edge.rawFrom) || bridges.has(edge.rawTo) || edge.type === 'bridge') {
      flags.push('bridge');
    }
    if (fanOutAddresses.has(edge.from)) {
      flags.push('fan-out');
    }
    if (rapidHopEdges.has(edge.id)) {
      flags.push('rapid-hop');
    }

    const score = Math.min(100, flags.length * 25 + (edge.type === 'theft' ? 20 : 0));
    edge.riskFlags = flags;
    edge.riskScore = score;
    edge.suspicious = score >= 50;
  }

  const nodeRisk = new Map();
  for (const edge of graph.edges) {
    const nodeScore = nodeRisk.get(edge.to) || 0;
    nodeRisk.set(edge.to, Math.max(nodeScore, edge.riskScore));
  }

  graph.nodes = graph.nodes.map((node) => {
    const risk = nodeRisk.get(node.id) || 0;
    return {
      ...node,
      riskScore: risk,
      riskLevel: risk >= 75 ? 'high' : risk >= 50 ? 'medium' : 'low'
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
