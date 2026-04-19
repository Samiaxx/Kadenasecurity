# Hybrid Fraud and Scam Tracing MVP

This repository implements a hybrid fraud tracing system that combines off-chain analysis with Kadena Pact smart contracts for immutable, verifiable fraud case anchors.

## What is included
- Live multi-chain indexers (Ethereum via Etherscan V2, BNB Smart Chain via BscScan, Bitcoin via Blockstream Esplora).
- Recursive transaction graph builder and risk heuristics engine (fan-out, mixer/bridge use, rapid hops, peel-chain fan-outs, rapid cash-outs to bridges/mixers/CEX endpoints).
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
ETH_CEX_ENDPOINTS=comma_separated_cex_hotwallets

BSCSCAN_API_KEY=your_bscscan_key_or_leave_blank_to_reuse_etherscan
BSCSCAN_API_URL=https://api.bscscan.com/api
BSC_CHAIN_ID=56
BSCSCAN_TX_LIMIT=25
BSCSCAN_MIN_INTERVAL_MS=350
BSCSCAN_USE_V2=false
BSC_CEX_ENDPOINTS=comma_separated_cex_hotwallets_on_bsc

BTC_API_URL=https://blockstream.info/api
BTC_TX_LIMIT=25
BTC_MIN_INTERVAL_MS=250
BTC_CEX_ENDPOINTS=comma_separated_cex_hotwallets_on_bitcoin

# Kadena configuration (optional, for real blockchain anchoring)
KADENA_PUBLIC_KEY=your_kadena_public_key
KADENA_PRIVATE_KEY=your_kadena_private_key
# Optional. Defaults to k:<KADENA_PUBLIC_KEY>
KADENA_SENDER_ACCOUNT=your_kadena_account_name
# Optional. Only needed when your RPC provider requires an API key header.
KADENA_TESTNET_API_KEY=your_provider_api_key
KADENA_API_KEY_HEADER=x-api-key
# Optional. Defaults to the public Kadena testnet endpoint.
KADENA_API_HOST=https://api.testnet.chainweb.com
KADENA_NETWORK_ID=testnet04
KADENA_CHAIN_ID=1
```

## Kadena Pact Contract Deployment
To enable real blockchain anchoring of fraud cases and attestations:

1. Set up a funded Kadena account with some test KDA on testnet.
2. Add your `KADENA_PUBLIC_KEY` and `KADENA_PRIVATE_KEY` to `api/.env`.
3. If your RPC provider also requires an API key, add `KADENA_TESTNET_API_KEY` and, if necessary, `KADENA_API_KEY_HEADER`.
4. If you do not set `KADENA_SENDER_ACCOUNT`, the app will default to `k:<KADENA_PUBLIC_KEY>`.
5. Deploy the contract:
```bash
node scripts/deployContract.js
```
6. The API will now submit real transactions when registering cases and creating attestations.

Important:
- A testnet API key by itself does not sign Pact transactions. Real Kadena anchoring still requires `KADENA_PUBLIC_KEY` and `KADENA_PRIVATE_KEY`.
- The dashboard now reports whether Kadena anchoring was submitted, skipped because keys are missing, or rejected during preflight.
- If no Kadena signing keys are provided, the system still works for local development, but it stores the case off-chain only.

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
