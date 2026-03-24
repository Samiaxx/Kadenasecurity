# Hybrid Fraud and Scam Tracing MVP

This repository implements a hybrid fraud tracing system that combines off-chain analysis with Kadena Pact smart contracts for immutable, verifiable fraud case anchors.

## What is included
- Live multi-chain indexers (Ethereum + BNB Smart Chain via Etherscan V2, Bitcoin via Blockstream Esplora).
- Recursive transaction graph builder and risk heuristics engine (fan-out, bridge usage, mixer usage, rapid hops).
- Interactive frontend graph visualization with color-coded risk paths.
- API layer serving traces and fraud cases.
- Pact smart contracts for fraud case registry, timestamped reports, wallet risk attestations, and public audit trail.

## Run locally
1. Install Node.js 18+.
2. Create `api/.env` with your API keys (examples below).
3. From `api`, install dependencies and run the server.

```bash
cd api
npm install
npm start
```

Open `http://localhost:4000`.

### Example `api/.env`
```
ETHERSCAN_API_KEY=your_etherscan_key
ETHERSCAN_API_URL=https://api.etherscan.io/v2/api
ETH_CHAIN_ID=1
ETHERSCAN_TX_LIMIT=25
ETHERSCAN_MIN_INTERVAL_MS=350

BSCSCAN_API_KEY=your_bscscan_key_or_leave_blank_to_reuse_etherscan
BSCSCAN_API_URL=https://api.etherscan.io/v2/api
BSC_CHAIN_ID=56
BSCSCAN_TX_LIMIT=25
BSCSCAN_MIN_INTERVAL_MS=350

BTC_API_URL=https://blockstream.info/api
BTC_TX_LIMIT=25
BTC_MIN_INTERVAL_MS=250
```

## Deploy on Vercel (demo link)
This repo includes a `vercel.json` that deploys the Express API as a serverless function and the static frontend from `frontend/`.

1. Push this repo to GitHub/GitLab.
2. In Vercel, click **Add New Project**, import the repo, and deploy (no build command needed).

Notes:
- The Vercel serverless function uses in-memory case storage, so saved cases reset between cold starts.

## API endpoints
- `GET /api/trace?seed=<wallet_or_tx>&depth=3`
- `POST /api/case` with `{ seed, title, notes, depth }`
- `GET /api/case/:id`
- `GET /api/cases`
- `POST /api/attest` with `{ wallet, chain, riskScore, flags }`

## Pact contracts
See `contracts/fraud-case.pact` and `contracts/README.md` for usage notes.

## Notes
- The indexers use Etherscan V2 for EVM chains and Blockstream Esplora for Bitcoin. You can swap in other providers or extend to more chains.
- The graph and risk engine are modular, making it straightforward to plug in additional heuristics or chains.
- Pact stores metadata hashes for public auditability without exposing sensitive details.
