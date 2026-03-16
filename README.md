# Hybrid Fraud and Scam Tracing MVP

This repository implements a hybrid fraud tracing system that combines off-chain analysis with Kadena Pact smart contracts for immutable, verifiable fraud case anchors.

## What is included
- Multi-chain indexer stubs (Ethereum, BSC, Bitcoin) with mock data. Kadena indexing is optional and can be added next.
- Recursive transaction graph builder and risk heuristics engine (fan-out, bridge usage, mixer usage, rapid hops).
- Interactive frontend graph visualization with color-coded risk paths.
- API layer serving traces and fraud cases.
- Pact smart contracts for fraud case registry, timestamped reports, wallet risk attestations, and public audit trail.

## Run locally
1. Install Node.js 18+.
2. From `api`, install dependencies and run the server.

```bash
cd api
npm install
npm start
```

Open `http://localhost:4000`.

## API endpoints
- `GET /api/trace?seed=<wallet_or_tx>&depth=3`
- `POST /api/case` with `{ seed, title, notes, depth }`
- `GET /api/case/:id`
- `GET /api/cases`
- `POST /api/attest` with `{ wallet, chain, riskScore, flags }`

## Pact contracts
See `contracts/fraud-case.pact` and `contracts/README.md` for usage notes.

## Notes
- The indexers are mock data to demonstrate architecture. Swap `shared/mock-data.json` with real indexer integrations.
- The graph and risk engine are modular, making it straightforward to plug in additional heuristics or chains.
- Pact stores metadata hashes for public auditability without exposing sensitive details.
