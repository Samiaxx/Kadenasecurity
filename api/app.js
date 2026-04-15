const path = require('path');
const fs = require('fs');
loadEnv();

const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const { buildGraph } = require('./graph/graphBuilder');
const { getIndicators, reloadIndicators, INDICATOR_PATH } = require('./indicators');

const app = express();
const CASES_PATH = path.join(__dirname, 'data', 'cases.json');
const isServerless = Boolean(process.env.VERCEL);
let memoryCases = [];

app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Local dev convenience: serve the static frontend when running the node server.
app.use(express.static(path.join(__dirname, '..', 'frontend')));

function loadEnv() {
  const primaryEnv = path.join(__dirname, '.env');
  const fallbackEnv = path.join(__dirname, 'api.env');
  let envPath = primaryEnv;
  if (!fs.existsSync(envPath)) {
    envPath = fallbackEnv;
  }
  if (!fs.existsSync(envPath)) {
    return;
  }
  const content = fs.readFileSync(envPath, 'utf-8');
  content.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      return;
    }
    const [rawKey, ...rest] = trimmed.split('=');
    if (!rawKey) {
      return;
    }
    const key = rawKey.replace(/^\uFEFF/, '');
    let value = rest.join('=').trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  });
}

function readCases() {
  if (isServerless) {
    return memoryCases;
  }
  if (!fs.existsSync(CASES_PATH)) {
    return [];
  }
  const raw = fs.readFileSync(CASES_PATH, 'utf-8');
  return JSON.parse(raw || '[]');
}

function writeCases(cases) {
  if (isServerless) {
    memoryCases = cases;
    return;
  }
  fs.writeFileSync(CASES_PATH, JSON.stringify(cases, null, 2));
}

app.get('/api/health', (req, res) => {
  const indicatorCounts = summaryCounts(getIndicators());
  const hasAnyIndicators = Object.values(indicatorCounts).some((value) => value > 0);
  const ethKeyConfigured = Boolean((process.env.ETHERSCAN_API_KEY || '').trim());
  const bscKeyConfigured = Boolean((process.env.BSCSCAN_API_KEY || '').trim());
  const ethApiUrl = process.env.ETHERSCAN_API_URL || 'https://api.etherscan.io/v2/api';
  const bscApiUrl = process.env.BSCSCAN_API_URL || 'https://api.bscscan.com/api';
  const btcApiUrl = process.env.BTC_API_URL || 'https://blockstream.info/api';
  const chains = {
    ethereum: {
      name: 'Ethereum',
      enabled: true,
      configured: ethKeyConfigured,
      setupHint: ethKeyConfigured ? '' : 'Set ETHERSCAN_API_KEY to enable reliable Ethereum tracing.',
      apiUrl: ethApiUrl.split('?')[0],
      chainId: process.env.ETH_CHAIN_ID || '1'
    },
    bsc: {
      name: 'BNB Smart Chain',
      enabled: bscKeyConfigured,
      configured: bscKeyConfigured,
      setupHint: bscKeyConfigured ? '' : 'Add BSCSCAN_API_KEY to turn on BNB Smart Chain tracing.',
      apiUrl: bscApiUrl.split('?')[0],
      chainId: process.env.BSC_CHAIN_ID || '56',
      useV2: process.env.BSCSCAN_USE_V2 || 'false'
    },
    bitcoin: {
      name: 'Bitcoin',
      enabled: true,
      configured: Boolean(btcApiUrl.trim()),
      setupHint: '',
      apiUrl: btcApiUrl
    }
  };

  res.json({
    status: 'ok',
    time: new Date().toISOString(),
    features: {
      tracing: true,
      caseRegistration: true,
      attestations: true,
      multiSeedTracing: true
    },
    indicators: {
      path: INDICATOR_PATH,
      counts: indicatorCounts,
      totalCount: Object.values(indicatorCounts).reduce((sum, value) => sum + value, 0),
      hasAnyIndicators
    },
    caseStorage: {
      mode: isServerless ? 'memory' : 'file',
      path: isServerless ? null : CASES_PATH
    },
    availableChains: Object.entries(chains)
      .filter(([, chain]) => chain.enabled)
      .map(([chainId]) => chainId),
    chains
  });
});

app.post('/api/indicators/reload', (req, res) => {
  try {
    const data = reloadIndicators();
    res.json({ status: 'reloaded', counts: summaryCounts(data) });
  } catch (err) {
    res.status(500).json({ error: err.message || 'reload failed' });
  }
});

function summaryCounts(data) {
  return {
    mixers: Object.values(data.mixers || {}).reduce((a, b) => a + b.length, 0),
    bridges: Object.values(data.bridges || {}).reduce((a, b) => a + b.length, 0),
    cexEndpoints: Object.values(data.cexEndpoints || {}).reduce((a, b) => a + b.length, 0),
    drainerBytecodes: (data.drainerBytecodes || []).length,
    fuelWallets: (data.fuelWallets || []).length,
    taggedExploits: (data.taggedExploits || []).length,
    domains: (data.domains || []).length
  };
}

app.get('/api/trace', async (req, res) => {
  const seed = (req.query.seed || '').trim();
  const depth = Number(req.query.depth || 2);
  if (!seed) {
    return res.status(400).json({ error: 'seed is required' });
  }
  try {
    const graph = await buildGraph({ seed, depth });
    res.json(graph);
  } catch (error) {
    res.status(500).json({ error: error.message || 'trace failed' });
  }
});

app.post('/api/case', async (req, res) => {
  const payload = req.body || {};
  const seed = (payload.seed || '').trim();
  if (!seed) {
    return res.status(400).json({ error: 'seed is required' });
  }

  try {
    const cases = readCases();
    const caseId = `case-${uuidv4()}`;
    const now = new Date().toISOString();
    const graph = await buildGraph({ seed, depth: payload.depth || 3 });

    const record = {
      id: caseId,
      title: payload.title || 'Untitled Fraud Case',
      notes: payload.notes || '',
      seed,
      createdAt: now,
      chainSummary: graph.meta.chains,
      graphSnapshot: graph,
      pactAnchor: {
        module: 'fraud-case-registry',
        function: 'register-case',
        networkId: payload.networkId || 'testnet04',
        chainId: payload.chainId || '1'
      }
    };

    cases.unshift(record);
    writeCases(cases);

    res.json({
      caseId,
      createdAt: now,
      shareUrl: `/case.html?id=${caseId}`,
      pactAnchor: record.pactAnchor
    });
  } catch (error) {
    res.status(500).json({ error: error.message || 'case creation failed' });
  }
});

app.get('/api/case/:id', (req, res) => {
  const cases = readCases();
  const record = cases.find((item) => item.id === req.params.id);
  if (!record) {
    return res.status(404).json({ error: 'case not found' });
  }
  res.json(record);
});

app.get('/api/cases', (req, res) => {
  const cases = readCases();
  res.json(cases.map((record) => ({
    id: record.id,
    title: record.title,
    seed: record.seed,
    createdAt: record.createdAt,
    chainSummary: record.chainSummary
  })));
});

app.post('/api/attest', (req, res) => {
  const payload = req.body || {};
  if (!payload.wallet || !payload.chain || !payload.riskScore) {
    return res.status(400).json({ error: 'wallet, chain, and riskScore are required' });
  }
  const attestation = {
    id: `att-${uuidv4()}`,
    wallet: payload.wallet,
    chain: payload.chain,
    riskScore: payload.riskScore,
    flags: payload.flags || [],
    createdAt: new Date().toISOString(),
    pactAnchor: {
      module: 'fraud-case-registry',
      function: 'attest-wallet',
      networkId: payload.networkId || 'testnet04',
      chainId: payload.chainId || '1'
    }
  };
  res.json(attestation);
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

module.exports = app;
