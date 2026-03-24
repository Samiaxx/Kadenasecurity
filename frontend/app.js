const seedInput = document.getElementById('seedInput');
const depthInput = document.getElementById('depthInput');
const traceBtn = document.getElementById('traceBtn');
const registerBtn = document.getElementById('registerBtn');
const caseStatus = document.getElementById('caseStatus');
const caseList = document.getElementById('caseList');
const chainSummary = document.getElementById('chainSummary');
const caseTitle = document.getElementById('caseTitle');
const caseNotes = document.getElementById('caseNotes');
const attestationList = document.getElementById('attestationList');
const traceMeta = document.getElementById('traceMeta');
const minAmountInput = document.getElementById('minAmount');
const excludeContractsInput = document.getElementById('excludeContracts');
const onlySuspiciousInput = document.getElementById('onlySuspicious');
const filterSummary = document.getElementById('filterSummary');

let latestGraph = null;
let graphView = null;

async function fetchJson(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch (error) {
      data = { error: text };
    }
    if (!response.ok) {
      throw new Error(data.error || `Request failed (${response.status})`);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function riskColor(score) {
  if (score >= 75) return '#ff5c5c';
  if (score >= 50) return '#ffcd57';
  return '#2fd1a5';
}

function nodeRadius(node) {
  if (node.riskScore >= 75) return 16;
  if (node.riskScore >= 50) return 12;
  return 9;
}

async function trace() {
  const seed = seedInput.value.trim();
  if (!seed) {
    caseStatus.textContent = 'Enter a wallet address or tx hash.';
    return;
  }
  caseStatus.textContent = 'Tracing...';
  const depth = depthInput.value;
  try {
    const graph = await fetchJson(`/api/trace?seed=${encodeURIComponent(seed)}&depth=${depth}`);
    if (!graph.nodes || !graph.edges) {
      throw new Error('Trace returned no graph data.');
    }
    latestGraph = graph;
    const filteredGraph = applyFilters();
    const summary = buildChainSummary(filteredGraph.edges, graph.meta?.chains);
    renderGraph(filteredGraph);
    renderChainSummary(summary);
    renderAttestations(filteredGraph);
    caseStatus.textContent = `Trace complete. ${filteredGraph.nodes.length} nodes, ${filteredGraph.edges.length} edges.`;
    traceMeta.textContent = `Generated: ${new Date(graph.meta.generatedAt).toLocaleString()}`;
    updateFilterSummary();
  } catch (error) {
    caseStatus.textContent = `Trace failed: ${error.message}`;
  }
}

async function registerCase() {
  const seed = seedInput.value.trim();
  if (!seed) {
    caseStatus.textContent = 'Trace a wallet or tx hash before registering.';
    return;
  }
  caseStatus.textContent = 'Registering case...';
  const payload = {
    seed,
    title: caseTitle.value.trim() || 'Untitled Fraud Case',
    notes: caseNotes.value.trim() || '',
    depth: Number(depthInput.value) || 3
  };
  try {
    const result = await fetchJson('/api/case', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    caseStatus.textContent = `Case registered. Shareable URL: ${result.shareUrl}`;
    loadCases();
  } catch (error) {
    caseStatus.textContent = `Case registration failed: ${error.message}`;
  }
}

function renderChainSummary(summary) {
  chainSummary.innerHTML = '';
  Object.values(summary).forEach((chain) => {
    const el = document.createElement('span');
    el.className = 'tag';
    el.textContent = `${chain.name}: ${chain.suspiciousEdges}/${chain.edges} suspicious`;
    chainSummary.appendChild(el);
  });
}

function renderAttestations(graph) {
  attestationList.innerHTML = '';
  const riskyNodes = graph.nodes
    .filter((node) => node.riskScore >= 50)
    .sort((a, b) => b.riskScore - a.riskScore)
    .slice(0, 6);

  if (riskyNodes.length === 0) {
    attestationList.innerHTML = '<div class=\"audit-item\">No high-risk wallets detected yet.</div>';
    return;
  }

  riskyNodes.forEach((node) => {
    const item = document.createElement('div');
    item.className = 'audit-item';
    item.innerHTML = `
      <strong>${node.label}</strong><br />
      Chain: ${node.chain}<br />
      Risk Score: ${node.riskScore}<br />
      Level: ${node.riskLevel}
    `;
    attestationList.appendChild(item);
  });
}

function applyFilters() {
  if (!latestGraph) {
    return { nodes: [], edges: [], meta: { chains: {} } };
  }
  const minAmount = Number(minAmountInput?.value || 0);
  const excludeContracts = Boolean(excludeContractsInput?.checked);
  const onlySuspicious = Boolean(onlySuspiciousInput?.checked);

  const edges = latestGraph.edges.filter((edge) => {
    if (Number(edge.amount || 0) < minAmount) {
      return false;
    }
    if (excludeContracts && edge.type === 'contract') {
      return false;
    }
    if (onlySuspicious && !edge.suspicious) {
      return false;
    }
    return true;
  });

  const nodeIds = new Set();
  edges.forEach((edge) => {
    const sourceId = typeof edge.source === 'object' ? edge.source.id : edge.source;
    const targetId = typeof edge.target === 'object' ? edge.target.id : edge.target;
    nodeIds.add(sourceId);
    nodeIds.add(targetId);
  });

  const nodes = latestGraph.nodes.filter((node) => nodeIds.has(node.id));

  return {
    nodes,
    edges,
    meta: latestGraph.meta
  };
}

function buildChainSummary(edges, metaChains) {
  const summary = {};
  edges.forEach((edge) => {
    const meta = metaChains ? metaChains[edge.chain] : null;
    const name = meta ? meta.name : edge.chain;
    if (!summary[edge.chain]) {
      summary[edge.chain] = {
        name,
        edges: 0,
        suspiciousEdges: 0
      };
    }
    summary[edge.chain].edges += 1;
    if (edge.suspicious) {
      summary[edge.chain].suspiciousEdges += 1;
    }
  });
  return summary;
}

function updateFilterSummary() {
  if (!filterSummary) {
    return;
  }
  if (!latestGraph) {
    filterSummary.textContent = 'Filtered: 0 / 0 edges';
    return;
  }
  const filtered = applyFilters();
  const total = latestGraph.edges.length;
  const shown = filtered.edges.length;
  const removed = total - shown;
  filterSummary.textContent = `Filtered: ${removed} / ${total} edges`;
}

function renderGraph(graph) {
  const container = document.getElementById('graph');
  container.innerHTML = '';

  const width = container.clientWidth;
  const height = container.clientHeight;

  const svg = d3
    .select(container)
    .append('svg')
    .attr('width', width)
    .attr('height', height);

  svg
    .append('defs')
    .append('marker')
    .attr('id', 'arrow')
    .attr('viewBox', '0 -5 10 10')
    .attr('refX', 14)
    .attr('refY', 0)
    .attr('markerWidth', 6)
    .attr('markerHeight', 6)
    .attr('orient', 'auto')
    .append('path')
    .attr('d', 'M0,-5L10,0L0,5')
    .attr('fill', '#4f5b9a');

  const simulation = d3
    .forceSimulation(graph.nodes)
    .force('link', d3.forceLink(graph.edges).id((d) => d.id).distance(120))
    .force('charge', d3.forceManyBody().strength(-280))
    .force('center', d3.forceCenter(width / 2, height / 2))
    .force('collision', d3.forceCollide().radius((d) => nodeRadius(d) + 10))
    .force('x', d3.forceX(width / 2).strength(0.08))
    .force('y', d3.forceY(height / 2).strength(0.08));

  const link = svg
    .append('g')
    .selectAll('line')
    .data(graph.edges)
    .enter()
    .append('line')
    .attr('stroke', (d) => riskColor(d.riskScore))
    .attr('stroke-width', (d) => (d.suspicious ? 2.5 : 1.2))
    .attr('marker-end', 'url(#arrow)')
    .attr('opacity', 0.8);

  const node = svg
    .append('g')
    .selectAll('circle')
    .data(graph.nodes)
    .enter()
    .append('circle')
    .attr('r', (d) => nodeRadius(d))
    .attr('fill', (d) => riskColor(d.riskScore))
    .attr('stroke', '#0c1024')
    .attr('stroke-width', 1.2)
    .call(
      d3
        .drag()
        .on('start', (event, d) => {
          if (!event.active) simulation.alphaTarget(0.3).restart();
          d.fx = d.x;
          d.fy = d.y;
        })
        .on('drag', (event, d) => {
          d.fx = event.x;
          d.fy = event.y;
        })
        .on('end', (event, d) => {
          if (!event.active) simulation.alphaTarget(0);
          d.fx = null;
          d.fy = null;
        })
    );

  const label = svg
    .append('g')
    .selectAll('text')
    .data(graph.nodes)
    .enter()
    .append('text')
    .text((d) => `${d.chain}:${d.label.substring(0, 6)}...`)
    .attr('font-size', '10px')
    .attr('fill', '#c7cffd')
    .attr('opacity', 0.7);

  const tooltip = d3
    .select(container)
    .append('div')
    .style('position', 'absolute')
    .style('padding', '8px 10px')
    .style('background', 'rgba(6, 8, 18, 0.9)')
    .style('border', '1px solid rgba(255,255,255,0.08)')
    .style('border-radius', '10px')
    .style('pointer-events', 'none')
    .style('font-size', '12px')
    .style('color', '#e6e9ff')
    .style('opacity', 0);

  node.on('mousemove', (event, d) => {
    tooltip
      .style('opacity', 1)
      .style('left', `${event.offsetX + 12}px`)
      .style('top', `${event.offsetY + 12}px`)
      .html(`Address: ${d.label}<br/>Risk: ${d.riskLevel}`);
  });

  node.on('mouseleave', () => {
    tooltip.style('opacity', 0);
  });

  link.on('mousemove', (event, d) => {
    tooltip
      .style('opacity', 1)
      .style('left', `${event.offsetX + 12}px`)
      .style('top', `${event.offsetY + 12}px`)
      .html(`Tx: ${d.hash}<br/>${d.amount} ${d.asset}<br/>Time: ${new Date(d.timestamp).toLocaleString()}<br/>Flags: ${d.riskFlags.join(', ') || 'none'}`);
  });

  link.on('mouseleave', () => {
    tooltip.style('opacity', 0);
  });

  simulation.on('tick', () => {
    const pad = 26;
    graph.nodes.forEach((node) => {
      node.x = Math.max(pad, Math.min(width - pad, node.x));
      node.y = Math.max(pad, Math.min(height - pad, node.y));
    });

    link
      .attr('x1', (d) => d.source.x)
      .attr('y1', (d) => d.source.y)
      .attr('x2', (d) => d.target.x)
      .attr('y2', (d) => d.target.y);

    node.attr('cx', (d) => d.x).attr('cy', (d) => d.y);

    label.attr('x', (d) => d.x + 12).attr('y', (d) => d.y + 4);
  });

  graphView = {
    graph,
    link,
    node,
    label
  };
}

async function loadCases() {
  const response = await fetch('/api/cases');
  const cases = await response.json();
  caseList.innerHTML = '';
  cases.forEach((record) => {
    const item = document.createElement('div');
    item.className = 'audit-item';
    item.innerHTML = `
      <strong>${record.title}</strong><br />
      Seed: ${record.seed}<br />
      Created: ${new Date(record.createdAt).toLocaleString()}<br />
      <a class="case-link" href="/case.html?id=${record.id}">Open case</a>
    `;
    caseList.appendChild(item);
  });
}

traceBtn.addEventListener('click', trace);
registerBtn.addEventListener('click', registerCase);

loadCases();
renderAttestations({ nodes: [] });

if (minAmountInput) {
  minAmountInput.addEventListener('input', () => {
    if (!latestGraph) return;
    const filteredGraph = applyFilters();
    renderGraph(filteredGraph);
    renderChainSummary(buildChainSummary(filteredGraph.edges, latestGraph.meta?.chains));
    renderAttestations(filteredGraph);
    caseStatus.textContent = `Trace complete. ${filteredGraph.nodes.length} nodes, ${filteredGraph.edges.length} edges.`;
    updateFilterSummary();
  });
}

if (excludeContractsInput) {
  excludeContractsInput.addEventListener('change', () => {
    if (!latestGraph) return;
    const filteredGraph = applyFilters();
    renderGraph(filteredGraph);
    renderChainSummary(buildChainSummary(filteredGraph.edges, latestGraph.meta?.chains));
    renderAttestations(filteredGraph);
    caseStatus.textContent = `Trace complete. ${filteredGraph.nodes.length} nodes, ${filteredGraph.edges.length} edges.`;
    updateFilterSummary();
  });
}

if (onlySuspiciousInput) {
  onlySuspiciousInput.addEventListener('change', () => {
    if (!latestGraph) return;
    const filteredGraph = applyFilters();
    renderGraph(filteredGraph);
    renderChainSummary(buildChainSummary(filteredGraph.edges, latestGraph.meta?.chains));
    renderAttestations(filteredGraph);
    caseStatus.textContent = `Trace complete. ${filteredGraph.nodes.length} nodes, ${filteredGraph.edges.length} edges.`;
    updateFilterSummary();
  });
}
