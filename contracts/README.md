# Kadena Pact Contracts

This folder contains the Pact module that anchors fraud cases, reports, wallet risk attestations, and the public audit trail.

## Module
- `fraud-case-registry` in `fraud-case.pact`

## Deployment Notes
1. Deploy `fraud-case.pact` to Kadena testnet or mainnet using `node scripts/deployContract.js`.
2. The module uses the `fraud-case-admin` keyset during deployment, so the deploy script injects that keyset from `KADENA_PUBLIC_KEY`.
3. The module deploys to the root namespace (no custom namespace required).
4. A provider API key can be added for RPC access, but it does not replace transaction signing.
5. Signing can use either `KADENA_PRIVATE_KEY` or Chainweaver Desktop with `KADENA_SIGNING_MODE=chainweaver`.
6. Use the module functions:
   - `register-case`
   - `submit-report`
   - `attest-wallet`
   - `list-audit`

## Metadata Hashing
The contract stores a `metadata-hash` for cases/reports instead of full metadata. Use SHA-256 (or your preferred hash) off-chain to avoid exposing sensitive data.
