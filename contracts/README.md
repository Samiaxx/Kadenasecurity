# Kadena Pact Contracts

This folder contains the Pact module that anchors fraud cases, reports, wallet risk attestations, and the public audit trail.

## Module
- `fraud-case-registry` in `fraud-case.pact`

## Deployment Notes
1. Create a namespace (optional) or deploy under `fraud`.
2. Load `fraud-case.pact` with the Pact CLI or Kadena tooling.
3. Use the module functions:
   - `register-case`
   - `submit-report`
   - `attest-wallet`
   - `list-audit`

## Metadata Hashing
The contract stores a `metadata-hash` for cases/reports instead of full metadata. Use SHA-256 (or your preferred hash) off-chain to avoid exposing sensitive data.
