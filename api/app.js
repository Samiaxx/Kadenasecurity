const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { buildGraph } = require('./graph/graphBuilder');

loadEnv();

const app = express();
const CASES_PATH = path.join(__dirname, 'data', 'cases.json');
const isServerless = Boolean(process.env.VERCEL);
let memoryCases = [];

app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Local dev convenience: serve the static frontend when running the node server.
app.use(express.static(path.join(__dirname, '..', 'frontend')));

function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) {
    return;
  }
  const content = fs.readFileSync(envPath, 'utf-8');
  content.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      return;
    }
    const [key, ...rest] = trimmed.split('=');
    if (!key) {
      return;
    }
    const value = rest.join('=').trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
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
  res.json({ status: 'ok', time: new Date().toISOString() });
});

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
