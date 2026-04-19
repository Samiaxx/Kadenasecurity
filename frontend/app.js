const seedInput = document.getElementById('seedInput');
const depthInput = document.getElementById('depthInput');
const traceBtn = document.getElementById('traceBtn');
const registerBtn = document.getElementById('registerBtn');
const copyBriefBtn = document.getElementById('copyBriefBtn');
const caseStatus = document.getElementById('caseStatus');
const caseList = document.getElementById('caseList');
const chainSummary = document.getElementById('chainSummary');
const caseTitle = document.getElementById('caseTitle');
const caseNotes = document.getElementById('caseNotes');
const attestationList = document.getElementById('attestationList');
const attestationStatus = document.getElementById('attestationStatus');
const traceMeta = document.getElementById('traceMeta');
const minAmountInput = document.getElementById('minAmount');
const excludeContractsInput = document.getElementById('excludeContracts');
const onlySuspiciousInput = document.getElementById('onlySuspicious');
const onlyPeelInput = document.getElementById('onlyPeel');
const showLabelsInput = document.getElementById('showLabels');
const filterSummary = document.getElementById('filterSummary');
const investigationBrief = document.getElementById('investigationBrief');
const workingList = document.getElementById('workingList');
const needsAttentionList = document.getElementById('needsAttentionList');
const readinessMeta = document.getElementById('readinessMeta');
const heroSeeds = document.getElementById('heroSeeds');
const heroSuspicious = document.getElementById('heroSuspicious');
const heroChains = document.getElementById('heroChains');
const heroReadiness = document.getElementById('heroReadiness');

let latestGraph = null;
let latestFilteredGraph = null;
let latestHealth = null;
let latestBriefText = '';
let graphView = null;
const attestationReceipts = new Map();
const filterInputs = [
  minAmountInput,
  excludeContractsInput,
  onlySuspiciousInput,
  onlyPeelInput,
  showLabelsInput
].filter(Boolean);

async function fetchJson(url, options = {}, timeoutMs = 60000) {
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
  if (score >= 75) return '#ff6f7d';
  if (score >= 50) return '#ffd166';
  return '#56f0c1';
}

function nodeRadius(node) {
  if (node.riskScore >= 75) return 16;
  if (node.riskScore >= 50) return 12;
  return 9;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function shortenLabel(label, leading = 8, trailing = 5) {
  const safe = String(label || '');
  if (safe.length <= leading + trailing + 3) {
    return safe || 'unknown';
  }
  return `${safe.slice(0, leading)}...${safe.slice(-trailing)}`;
}

function titleCase(value) {
  return String(value || '')
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function getEdgeEndpointId(edge, key) {
  const endpoint = edge?.[key];
  return typeof endpoint === 'object' ? endpoint?.id : endpoint;
}

function getEdgeFlags(edge) {
  if (Array.isArray(edge?.riskFlags)) {
    return edge.riskFlags;
  }
  if (Array.isArray(edge?.flags)) {
    return edge.flags;
  }
  return [];
}

function setStatus(element, message, state = 'info') {
  if (!element) {
    return;
  }
  element.textContent = message;
  element.dataset.state = state;
}

function describePactResult(pactResult) {
  if (!pactResult) {
    return 'Kadena anchoring was not attempted.';
  }
  if (pactResult.status === 'submitted' && pactResult.requestKey) {
    return `Kadena submitted with request key ${pactResult.requestKey}.`;
  }
  if (pactResult.message) {
    return `Kadena ${pactResult.status || 'status'}: ${pactResult.message}`;
  }
  return `Kadena status: ${pactResult.status || 'unknown'}.`;
}

function getSeeds() {
  return seedInput.value
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean);
}

function getChainName(chainId) {
  return latestHealth?.chains?.[chainId]?.name || titleCase(chainId);
}

function getActiveChainMeta(metaChains) {
  if (metaChains && Object.keys(metaChains).length) {
    return metaChains;
  }
  return latestHealth?.chains || {};
}

function renderHeroMetrics(graph = latestFilteredGraph, health = latestHealth) {
  const seeds = getSeeds().length;
  const suspiciousEdges = graph?.edges?.filter((edge) => edge.suspicious).length || 0;
  const chainCount = graph?.edges?.length
    ? new Set(graph.edges.map((edge) => edge.chain)).size
    : health?.availableChains?.length || 0;

  let readinessLabel = 'Offline';
  if (health?.readiness) {
    readinessLabel = `${health.readiness.working}/${health.readiness.total} ready`;
  } else if (health) {
    readinessLabel = 'Live';
  }

  heroSeeds.textContent = String(seeds);
  heroSuspicious.textContent = String(suspiciousEdges);
  heroChains.textContent = String(chainCount);
  heroReadiness.textContent = readinessLabel;
}

async function trace() {
  const seeds = getSeeds();
  if (!seeds.length) {
    setStatus(caseStatus, 'Enter a wallet or tx hash.', 'error');
    return;
  }

  const depth = depthInput.value;
  traceBtn.disabled = true;
  registerBtn.disabled = true;
  setStatus(caseStatus, seeds.length > 1 ? `Tracing ${seeds.length} seeds...` : 'Tracing...', 'info');
  traceMeta.textContent = 'Pulling live chain data and building the graph...';

  try {
    const merged = {
      nodes: [],
      edges: [],
      meta: {
        generatedAt: new Date().toISOString(),
        chains: {}
      }
    };
    const seenNode = new Set();
    const seenEdge = new Set();

    for (const seed of seeds) {
      const graph = await fetchJson(`/api/trace?seed=${encodeURIComponent(seed)}&depth=${depth}`);
      if (!graph.nodes || !graph.edges) {
        throw new Error('Trace returned no graph data.');
      }
      graph.nodes.forEach((n) => {
        if (!seenNode.has(n.id)) {
          merged.nodes.push(n);
          seenNode.add(n.id);
        }
      });
      graph.edges.forEach((e) => {
        if (!seenEdge.has(e.id)) {
          merged.edges.push(e);
          seenEdge.add(e.id);
        }
      });
    }

    merged.meta.generatedAt = new Date().toISOString();
    merged.meta.chains = latestHealth?.chains || {};
    latestGraph = merged;
    refreshTraceView();
    setStatus(
      caseStatus,
      `Trace complete. ${latestFilteredGraph.nodes.length} nodes, ${latestFilteredGraph.edges.length} edges.`,
      'success'
    );
    traceMeta.textContent = `Generated: ${new Date(merged.meta.generatedAt).toLocaleString()} | Seeds: ${seeds.length} | Depth: ${depth}`;
  } catch (error) {
    latestGraph = null;
    latestFilteredGraph = null;
    renderGraph({ nodes: [], edges: [] });
    renderChainSummary({});
    renderAttestations({ nodes: [], edges: [] });
    renderInvestigationBrief(null);
    renderHeroMetrics(null, latestHealth);
    updateFilterSummary();
    setStatus(caseStatus, `Trace failed: ${error.message}`, 'error');
    traceMeta.textContent = 'The trace did not complete. Check API connectivity and chain credentials.';
  } finally {
    traceBtn.disabled = false;
    registerBtn.disabled = false;
  }
}

async function registerCase() {
  const seed = seedInput.value.trim();
  if (!seed) {
    setStatus(caseStatus, 'Trace a wallet or tx hash before registering.', 'error');
    return;
  }

  registerBtn.disabled = true;
  setStatus(caseStatus, 'Registering case...', 'info');
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
    setStatus(
      caseStatus,
      `Case registered. ${describePactResult(result.pactAnchor?.pactResult)} Shareable URL: ${result.shareUrl}`,
      'success'
    );
    loadCases();
  } catch (error) {
    setStatus(caseStatus, `Case registration failed: ${error.message}`, 'error');
  } finally {
    registerBtn.disabled = false;
  }
}

async function loadHealth() {
  try {
    const health = await fetchJson('/api/health', {}, 15000);
    latestHealth = health;
    renderSystemReadiness(health);
    renderHeroMetrics(latestFilteredGraph, health);
  } catch (error) {
    latestHealth = null;
    renderSystemReadiness(null, error.message);
    renderHeroMetrics(latestFilteredGraph, null);
  }
}

function renderSystemReadiness(health, errorMessage = '') {
  workingList.innerHTML = '';
  needsAttentionList.innerHTML = '';

  if (!health) {
    workingList.innerHTML =
      '<div class="status-item good"><span class="status-dot"></span><div><strong class="status-title">Frontend shell</strong><div class="status-detail">The dashboard UI loaded, but the API health check did not return.</div></div></div>';
    needsAttentionList.innerHTML = `<div class="status-item issue"><span class="status-dot"></span><div><strong class="status-title">Health endpoint</strong><div class="status-detail">${escapeHtml(
      errorMessage || 'Unable to reach /api/health.'
    )}</div></div></div>`;
    readinessMeta.textContent = 'Readiness details are limited until the API responds.';
    return;
  }

  const working = [
    {
      title: 'Frontend shell',
      detail: 'The dashboard loaded and can reach the API health route.'
    }
  ];
  const attention = [];

  if (health.features?.tracing) {
    working.push({
      title: 'Trace engine',
      detail: 'Graph generation, heuristics, and filters are available.'
    });
  }

  if (health.features?.caseRegistration) {
    working.push({
      title: 'Case registration',
      detail: 'Fraud cases can be generated and shared from the dashboard.'
    });
  }

  if (health.features?.attestations) {
    working.push({
      title: 'Attestation receipts',
      detail: 'Wallet attestation payloads can be created from risky nodes.'
    });
  }

  if (health.indicators?.hasAnyIndicators) {
    working.push({
      title: 'Intel indicators',
      detail: `${health.indicators.totalCount} indicators loaded from ${health.indicators.path}.`
    });
  } else {
    attention.push({
      title: 'Intel indicators',
      detail: 'Indicator data is empty, so mixer, bridge, and exploit matching will be weaker.'
    });
  }

  Object.entries(health.chains || {}).forEach(([chainId, chain]) => {
    if (chain.configured) {
      working.push({
        title: `${chain.name} tracing`,
        detail: `Configured against ${chain.apiUrl || 'the chain API'}.`
      });
    } else {
      attention.push({
        title: `${chain.name} tracing`,
        detail: chain.setupHint || `Missing configuration for ${chainId}.`
      });
    }
  });

  if (health.caseStorage?.mode === 'file') {
    working.push({
      title: 'Case persistence',
      detail: 'Saved cases are written to a local JSON file.'
    });
  } else {
    attention.push({
      title: 'Case persistence',
      detail: 'Serverless memory mode resets saved cases after cold starts.'
    });
  }

  if ((health.availableChains || []).length > 1) {
    working.push({
      title: 'Multi-chain tracing',
      detail: `${health.availableChains.length} chains are active for investigations.`
    });
  } else {
    attention.push({
      title: 'Multi-chain tracing',
      detail: 'Only one chain is currently active, so bridge pivots may be underrepresented.'
    });
  }

  if (health.kadena?.signerConfigured) {
    working.push({
      title: 'Kadena anchoring',
      detail: `Ready on ${health.kadena.networkId} chain ${health.kadena.chainId} using ${health.kadena.senderAccount || 'the configured gas payer'}.`
    });
  } else {
    attention.push({
      title: 'Kadena anchoring',
      detail: health.kadena?.reason || 'Kadena signing keys are not configured, so case anchors stay off-chain.'
    });
  }

  renderStatusCollection(workingList, working, 'good');
  renderStatusCollection(needsAttentionList, attention, 'issue');

  const workingCount = working.length;
  const total = working.length + attention.length;
  health.readiness = { working: workingCount, total };
  readinessMeta.textContent = `Last checked ${new Date(health.time || Date.now()).toLocaleString()} | ${workingCount}/${total} checks ready`;
}

function renderStatusCollection(container, items, tone) {
  if (!items.length) {
    container.innerHTML = `<div class="status-item ${tone}"><span class="status-dot"></span><div><strong class="status-title">Nothing here</strong><div class="status-detail">No items to show.</div></div></div>`;
    return;
  }

  items.forEach((item) => {
    const entry = document.createElement('div');
    entry.className = `status-item ${tone}`;
    entry.innerHTML = `
      <span class="status-dot"></span>
      <div>
        <strong class="status-title">${escapeHtml(item.title)}</strong>
        <div class="status-detail">${escapeHtml(item.detail)}</div>
      </div>
    `;
    container.appendChild(entry);
  });
}

function renderChainSummary(summary) {
  chainSummary.innerHTML = '';
  const values = Object.values(summary);
  if (!values.length) {
    chainSummary.innerHTML = '<span class="tag">No chain activity yet</span>';
    return;
  }

  values.forEach((chain) => {
    const ratio = chain.edges ? chain.suspiciousEdges / chain.edges : 0;
    const toneClass = ratio >= 0.65 ? ' danger' : ratio >= 0.3 ? ' warning' : '';
    const el = document.createElement('span');
    el.className = `tag${toneClass}`;
    el.textContent = `${chain.name}: ${chain.suspiciousEdges}/${chain.edges} suspicious`;
    chainSummary.appendChild(el);
  });
}

function collectNodeFlags(graph, nodeId) {
  const flags = new Set();
  (graph?.edges || []).forEach((edge) => {
    const sourceId = getEdgeEndpointId(edge, 'source');
    const targetId = getEdgeEndpointId(edge, 'target');
    if (sourceId === nodeId || targetId === nodeId) {
      getEdgeFlags(edge).forEach((flag) => flags.add(flag));
    }
  });
  return Array.from(flags);
}

function renderAttestations(graph) {
  attestationList.innerHTML = '';
  if (!graph?.nodes?.length) {
    attestationList.innerHTML = '<div class="audit-item">No high-risk wallets detected yet.</div>';
    return;
  }

  const riskyNodes = graph.nodes
    .filter((node) => node.riskScore >= 50)
    .sort((a, b) => b.riskScore - a.riskScore)
    .slice(0, 6);

  if (riskyNodes.length === 0) {
    attestationList.innerHTML = '<div class=\"audit-item\">No high-risk wallets detected yet.</div>';
    return;
  }

  riskyNodes.forEach((node) => {
    const item = document.createElement('article');
    item.className = 'audit-item rich';
    const flags = collectNodeFlags(graph, node.id).slice(0, 5);
    const receipt = attestationReceipts.get(node.id);

    const header = document.createElement('div');
    header.className = 'audit-item-header';
    header.innerHTML = `
      <div>
        <strong>${escapeHtml(shortenLabel(node.label, 12, 8))}</strong>
        <div class="status-detail">${escapeHtml(getChainName(node.chain))} | Risk ${node.riskScore} | ${escapeHtml(titleCase(node.riskLevel || 'low'))}</div>
      </div>
    `;

    const actions = document.createElement('div');
    actions.className = 'audit-item-actions';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary compact';
    button.textContent = receipt ? 'Refresh receipt' : 'Create receipt';
    button.addEventListener('click', () => createAttestation(node, flags));
    actions.appendChild(button);
    header.appendChild(actions);
    item.appendChild(header);

    const flagsRow = document.createElement('div');
    flagsRow.className = 'tag-row';
    if (flags.length) {
      flags.forEach((flag) => {
        const pill = document.createElement('span');
        pill.className = 'tag warning';
        pill.textContent = titleCase(flag);
        flagsRow.appendChild(pill);
      });
    } else {
      const pill = document.createElement('span');
      pill.className = 'tag';
      pill.textContent = 'General risk';
      flagsRow.appendChild(pill);
    }
    item.appendChild(flagsRow);

    if (receipt) {
      const statusClass = receipt.pactAnchor.pactResult && receipt.pactAnchor.pactResult.status === 'submitted' ? 'success' : 'error';
      const statusText = receipt.pactAnchor.pactResult ? receipt.pactAnchor.pactResult.status : 'unknown';
      const requestKey = receipt.pactAnchor.pactResult?.requestKey;
      const message = receipt.pactAnchor.pactResult?.message;
      const receiptBlock = document.createElement('div');
      receiptBlock.className = 'status-detail';
      receiptBlock.innerHTML = `Receipt ${escapeHtml(receipt.id)} | ${escapeHtml(receipt.pactAnchor.module)}.${escapeHtml(
        receipt.pactAnchor.function
      )} | ${escapeHtml(receipt.pactAnchor.networkId)} / chain ${escapeHtml(receipt.pactAnchor.chainId)} | <span class="tag ${statusClass}">${statusText}</span>${
        requestKey ? `<br />Request key: ${escapeHtml(requestKey)}` : ''
      }${message ? `<br />${escapeHtml(message)}` : ''}`;
      item.appendChild(receiptBlock);
    }

    attestationList.appendChild(item);
  });
}

async function createAttestation(node, flags) {
  setStatus(attestationStatus, `Creating receipt for ${shortenLabel(node.label)}...`, 'info');
  try {
    const receipt = await fetchJson('/api/attest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        wallet: node.label,
        chain: node.chain,
        riskScore: node.riskScore,
        flags
      })
    });
    attestationReceipts.set(node.id, receipt);
    renderAttestations(latestFilteredGraph || { nodes: [], edges: [] });
    setStatus(
      attestationStatus,
      `Receipt ready: ${receipt.id} on ${receipt.pactAnchor.networkId} chain ${receipt.pactAnchor.chainId}. ${describePactResult(
        receipt.pactAnchor.pactResult
      )}`,
      'success'
    );
  } catch (error) {
    setStatus(attestationStatus, `Attestation failed: ${error.message}`, 'error');
  }
}

function applyFilters() {
  if (!latestGraph) {
    return { nodes: [], edges: [], meta: { chains: {} } };
  }
  const minAmount = Number(minAmountInput?.value || 0);
  const excludeContracts = Boolean(excludeContractsInput?.checked);
  const onlySuspicious = Boolean(onlySuspiciousInput?.checked);
  const onlyPeel = Boolean(onlyPeelInput?.checked);

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
    if (onlyPeel) {
      const flags = getEdgeFlags(edge);
      const hit = flags.some((flag) =>
        ['peel-chain', 'rapid-cashout', 'mixer', 'bridge', 'cex-endpoint', 'cex-reuse'].includes(flag)
      );
      if (!hit) return false;
    }
    return true;
  });

  const nodeIds = new Set();
  edges.forEach((edge) => {
    nodeIds.add(getEdgeEndpointId(edge, 'source'));
    nodeIds.add(getEdgeEndpointId(edge, 'target'));
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
    const name = meta ? meta.name : getChainName(edge.chain);
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

function updateFilterSummary(graph = latestFilteredGraph) {
  if (!filterSummary) {
    return;
  }
  if (!latestGraph) {
    filterSummary.textContent = 'Filtered: 0 / 0 edges';
    return;
  }
  const total = latestGraph.edges.length;
  const shown = graph?.edges?.length || 0;
  const removed = total - shown;
  filterSummary.textContent = `Filtered: ${removed} / ${total} edges`;
}

function buildSuggestedAction(flags) {
  if (flags.includes('cex-endpoint') || flags.includes('cex-reuse')) {
    return 'Preserve timestamps and request an exchange hold or law-enforcement contact package while the trail is still hot.';
  }
  if (flags.includes('bridge') || flags.includes('bridge-pivot')) {
    return 'Capture the bridge hop quickly and map the destination chain before the flow fragments further.';
  }
  if (flags.includes('mixer') || flags.includes('mixer-funnel')) {
    return 'Freeze upstream evidence now, because visibility drops sharply once funds settle inside the mixer boundary.';
  }
  if (flags.includes('phishing-contract')) {
    return 'Document the phishing contract and matching domain evidence for a takedown-ready case file.';
  }
  if (flags.includes('peel-chain') || flags.includes('fast-peel')) {
    return 'Prioritize the peel origin wallet and capture a full outgoing sequence before the pattern widens.';
  }
  return 'Start with the highest-risk wallet and preserve explorer links, timestamps, and case notes while the context is fresh.';
}

function buildInvestigationInsights(graph) {
  if (!graph?.nodes?.length) {
    return null;
  }

  const suspiciousEdges = graph.edges.filter((edge) => edge.suspicious);
  const highRiskNodes = graph.nodes
    .filter((node) => node.riskScore >= 75)
    .sort((a, b) => b.riskScore - a.riskScore);
  const flagCounts = new Map();

  graph.edges.forEach((edge) => {
    getEdgeFlags(edge).forEach((flag) => {
      flagCounts.set(flag, (flagCounts.get(flag) || 0) + 1);
    });
  });

  const topFlags = Array.from(flagCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([flag, count]) => ({ flag, count }));
  const chainValues = Object.values(buildChainSummary(graph.edges, getActiveChainMeta(graph.meta?.chains))).sort(
    (a, b) => b.edges - a.edges
  );
  const dominantChain = chainValues[0];
  const leadNodes = graph.nodes
    .slice()
    .sort((a, b) => b.riskScore - a.riskScore)
    .slice(0, 3);
  const signatureParts = [];

  if (dominantChain) {
    signatureParts.push(`${dominantChain.name} dominant`);
  }
  topFlags.forEach(({ flag }) => signatureParts.push(titleCase(flag)));
  if (leadNodes[0]) {
    signatureParts.push(shortenLabel(leadNodes[0].label, 10, 6));
  }

  const seeds = getSeeds().length;
  const chainCount = new Set(graph.edges.map((edge) => edge.chain)).size;
  const leadFlags = topFlags.map((entry) => titleCase(entry.flag));
  const recommendedAction = buildSuggestedAction(topFlags.map((entry) => entry.flag));
  const leadWalletLabel = leadNodes[0]
    ? `${shortenLabel(leadNodes[0].label, 12, 8)} on ${getChainName(leadNodes[0].chain)}`
    : 'No standout wallet yet';
  const copyText = [
    'TraceLoom Investigation Brief',
    `Generated: ${new Date().toLocaleString()}`,
    `Seeds: ${seeds}`,
    `Coverage: ${graph.nodes.length} nodes, ${graph.edges.length} edges, ${chainCount} chains`,
    `Suspicious paths: ${suspiciousEdges.length}`,
    `High-risk wallets: ${highRiskNodes.length}`,
    `Dominant chain: ${dominantChain ? dominantChain.name : 'None'}`,
    `Lead wallet: ${leadWalletLabel}`,
    `Top signals: ${leadFlags.length ? leadFlags.join(', ') : 'No standout risk flags'}`,
    `Recommended next step: ${recommendedAction}`,
    `Signature: ${signatureParts.join(' / ') || 'No signature yet'}`
  ].join('\n');

  return {
    metrics: [
      { label: 'Suspicious paths', value: suspiciousEdges.length },
      { label: 'High-risk wallets', value: highRiskNodes.length },
      { label: 'Chains in view', value: chainCount }
    ],
    signature: signatureParts.join(' / ') || 'No signature yet',
    highlights: [
      {
        title: 'Coverage',
        detail: `${seeds || 1} seed${seeds === 1 ? '' : 's'} expanded into ${graph.nodes.length} visible entities and ${graph.edges.length} traced transfers.`
      },
      {
        title: 'Dominant pattern',
        detail: leadFlags.length
          ? `${leadFlags.join(', ')} appear most often in the visible path set.`
          : 'The current view has low-risk activity with no dominant alert pattern yet.'
      },
      {
        title: 'Priority wallet',
        detail: leadNodes[0]
          ? `${leadWalletLabel} is the best starting point for evidence capture.`
          : 'No lead wallet stands out yet.'
      }
    ],
    tags: leadFlags,
    recommendedAction,
    copyText
  };
}

function renderInvestigationBrief(graph) {
  const insights = buildInvestigationInsights(graph);
  if (!insights) {
    latestBriefText = '';
    copyBriefBtn.disabled = true;
    investigationBrief.innerHTML = '<div class="empty-state">Run a trace to generate an investigation signature and response playbook.</div>';
    return;
  }

  latestBriefText = insights.copyText;
  copyBriefBtn.disabled = false;
  investigationBrief.innerHTML = `
    <div class="brief-grid">
      ${insights.metrics
        .map(
          (metric) => `
            <div class="brief-metric">
              <span>${escapeHtml(metric.label)}</span>
              <strong>${escapeHtml(metric.value)}</strong>
            </div>
          `
        )
        .join('')}
    </div>
    <div class="signature-block">
      <span class="eyebrow">Trace signature</span>
      <code>${escapeHtml(insights.signature)}</code>
    </div>
    <div class="brief-list">
      ${insights.highlights
        .map(
          (item) => `
            <div class="brief-item">
              <strong>${escapeHtml(item.title)}</strong>
              <p>${escapeHtml(item.detail)}</p>
            </div>
          `
        )
        .join('')}
    </div>
    <div class="brief-footer">
      <div class="brief-tags">
        ${
          insights.tags.length
            ? insights.tags.map((flag) => `<span class="tag warning">${escapeHtml(flag)}</span>`).join('')
            : '<span class="tag">Low-signal path</span>'
        }
      </div>
      <p><span class="eyebrow">Next move</span><br /><span class="inline-code">${escapeHtml(insights.recommendedAction)}</span></p>
    </div>
  `;
}

function renderGraph(graph) {
  const container = document.getElementById('graph');
  container.innerHTML = '';

  if (!graph?.nodes?.length) {
    container.innerHTML = '<div class="empty-state">No trace yet. Run a trace to map fund flow and risk hotspots.</div>';
    graphView = null;
    return;
  }

  const width = Math.max(container.clientWidth, 320);
  const height = Math.max(container.clientHeight, 320);

  const svg = d3.select(container).append('svg').attr('width', width).attr('height', height);
  const zoomGroup = svg.append('g').attr('class', 'zoom-layer');

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
    .force('link', d3.forceLink(graph.edges).id((d) => d.id).distance(140))
    .force('charge', d3.forceManyBody().strength(-340))
    .force('center', d3.forceCenter(width / 2, height / 2))
    .force('collision', d3.forceCollide().radius((d) => nodeRadius(d) + 14))
    .force('x', d3.forceX(width / 2).strength(0.08))
    .force('y', d3.forceY(height / 2).strength(0.08));

  const link = zoomGroup
    .append('g')
    .selectAll('line')
    .data(graph.edges)
    .enter()
    .append('line')
    .attr('stroke', (d) => riskColor(d.riskScore))
    .attr('stroke-width', (d) => (d.suspicious ? 2.5 : 1.2))
    .attr('marker-end', 'url(#arrow)')
    .attr('opacity', 0.82);

  const node = zoomGroup
    .append('g')
    .selectAll('circle')
    .data(graph.nodes)
    .enter()
    .append('circle')
    .attr('r', (d) => nodeRadius(d))
    .attr('fill', (d) => riskColor(d.riskScore))
    .attr('stroke', '#08121e')
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

  const showAllLabels = Boolean(showLabelsInput?.checked);
  const labelData = showAllLabels ? graph.nodes : graph.nodes.filter((n) => n.riskScore >= 50);

  const label = zoomGroup
    .append('g')
    .selectAll('text')
    .data(labelData)
    .enter()
    .append('text')
    .text((d) => `${getChainName(d.chain)}:${shortenLabel(d.label, 6, 4)}`)
    .attr('font-size', '10px')
    .attr('fill', '#d0e7ff')
    .attr('opacity', 0.72);

  const tooltip = d3
    .select(container)
    .append('div')
    .style('position', 'absolute')
    .style('padding', '8px 10px')
    .style('background', 'rgba(4, 11, 18, 0.95)')
    .style('border', '1px solid rgba(255,255,255,0.08)')
    .style('border-radius', '12px')
    .style('pointer-events', 'none')
    .style('font-size', '12px')
    .style('color', '#edf7ff')
    .style('opacity', 0);

  node.on('mousemove', (event, d) => {
    positionTooltip(tooltip, event, container);
    tooltip.html(
      `Wallet: ${escapeHtml(d.label)}<br/>Risk: ${escapeHtml(titleCase(d.riskLevel || 'low'))}<br/>Chain: ${escapeHtml(
        getChainName(d.chain)
      )}`
    );
  });

  node.on('mouseleave', () => {
    tooltip.style('opacity', 0);
  });

  node.on('contextmenu', (event, d) => {
    event.preventDefault();
    const link = buildExplorerLink(d);
    if (link) {
      window.open(link, '_blank');
    }
  });

  link.on('mousemove', (event, d) => {
    positionTooltip(tooltip, event, container);
    tooltip.html(
      `Tx: ${escapeHtml(d.hash || 'unknown')}<br/>${escapeHtml(d.amount)} ${escapeHtml(
        d.asset || ''
      )}<br/>Time: ${escapeHtml(new Date(d.timestamp).toLocaleString())}<br/>Flags: ${escapeHtml(
        getEdgeFlags(d).join(', ') || 'none'
      )}`
    );
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

  svg.call(
    d3
      .zoom()
      .scaleExtent([0.4, 4])
      .on('zoom', (event) => {
        zoomGroup.attr('transform', event.transform);
      })
  );

  graphView = {
    graph,
    link,
    node,
    label
  };
}

function positionTooltip(tooltip, event, container) {
  const rect = container.getBoundingClientRect();
  tooltip
    .style('opacity', 1)
    .style('left', `${event.clientX - rect.left + 14}px`)
    .style('top', `${event.clientY - rect.top + 14}px`);
}

function buildExplorerLink(node) {
  const addr = node.label;
  switch (node.chain) {
    case 'ethereum':
    case '1':
      return `https://etherscan.io/address/${addr}`;
    case 'bsc':
    case '56':
      return `https://bscscan.com/address/${addr}`;
    case 'bitcoin':
      return `https://mempool.space/address/${addr}`;
    default:
      return null;
  }
}

async function loadCases() {
  try {
    const cases = await fetchJson('/api/cases');
    caseList.innerHTML = '';

    if (!cases.length) {
      caseList.innerHTML = '<div class="audit-item">No cases yet. Register a trace to start the public audit trail.</div>';
      return;
    }

    cases.forEach((record) => {
      const item = document.createElement('div');
      item.className = 'audit-item';
      item.innerHTML = `
        <strong>${escapeHtml(record.title)}</strong><br />
        Seed: ${escapeHtml(shortenLabel(record.seed, 14, 10))}<br />
        Created: ${escapeHtml(new Date(record.createdAt).toLocaleString())}<br />
        <a class="case-link" href="/case.html?id=${encodeURIComponent(record.id)}">Open case</a>
      `;
      caseList.appendChild(item);
    });
  } catch (error) {
    caseList.innerHTML = `<div class="audit-item">Unable to load saved cases: ${escapeHtml(error.message)}</div>`;
  }
}

function refreshTraceView() {
  latestFilteredGraph = applyFilters();
  renderGraph(latestFilteredGraph);
  renderChainSummary(buildChainSummary(latestFilteredGraph.edges, getActiveChainMeta(latestGraph?.meta?.chains)));
  renderAttestations(latestFilteredGraph);
  renderInvestigationBrief(latestFilteredGraph);
  updateFilterSummary(latestFilteredGraph);
  renderHeroMetrics(latestFilteredGraph, latestHealth);
}

async function copyBrief() {
  if (!latestBriefText) {
    return;
  }

  const originalLabel = copyBriefBtn.textContent;
  try {
    await navigator.clipboard.writeText(latestBriefText);
    copyBriefBtn.textContent = 'Copied';
    setTimeout(() => {
      copyBriefBtn.textContent = originalLabel;
    }, 1200);
  } catch (error) {
    setStatus(caseStatus, 'Copy failed. Clipboard access is not available here.', 'error');
  }
}

function debounce(fn, delay = 150) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

traceBtn.addEventListener('click', trace);
registerBtn.addEventListener('click', registerCase);
copyBriefBtn.addEventListener('click', copyBrief);

filterInputs.forEach((input) => {
  const eventName = input.type === 'number' ? 'input' : 'change';
  input.addEventListener(eventName, () => {
    if (!latestGraph) {
      return;
    }
    refreshTraceView();
    setStatus(
      caseStatus,
      `Trace complete. ${latestFilteredGraph.nodes.length} nodes, ${latestFilteredGraph.edges.length} edges.`,
      'success'
    );
  });
});

window.addEventListener(
  'resize',
  debounce(() => {
    if (latestFilteredGraph) {
      renderGraph(latestFilteredGraph);
    }
  })
);

renderGraph({ nodes: [], edges: [] });
renderInvestigationBrief(null);
renderAttestations({ nodes: [], edges: [] });
updateFilterSummary();
renderHeroMetrics(null, null);
loadHealth();
loadCases();
