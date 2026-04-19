#!/usr/bin/env node
/**
 * Deploy the fraud-case-registry Pact module to Kadena testnet.
 */

const fs = require('fs');
const path = require('path');
const {
  getKadenaConfig,
  listenForTransaction,
  submitPactCode
} = require(path.join(__dirname, '..', 'api', 'kadena'));

loadEnv();

function loadEnv() {
  const primaryEnv = path.join(__dirname, '..', 'api', '.env');
  const fallbackEnv = path.join(__dirname, '..', 'api', 'api.env');
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

async function deployContract() {
  const networkId = process.env.KADENA_NETWORK_ID || 'testnet04';
  const chainId = process.env.KADENA_CHAIN_ID || '1';
  const kadenaConfig = getKadenaConfig({ networkId, chainId });

  if (!kadenaConfig.signerConfigured || !kadenaConfig.publicKey) {
    console.error(kadenaConfig.reason || 'Please set KADENA_PRIVATE_KEY and KADENA_PUBLIC_KEY.');
    process.exit(1);
  }

  try {
    const contractPath = path.join(__dirname, '..', 'contracts', 'fraud-case.pact');
    const contractCode = fs.readFileSync(contractPath, 'utf-8');

    console.log(`Deploying contract to ${networkId} chain ${chainId} via ${kadenaConfig.apiHost}...`);
    const submission = await submitPactCode(contractCode, {
      networkId,
      chainId,
      gasLimit: 150000,
      keysets: [
        {
          name: 'fraud-case-admin',
          predicate: 'keys-all',
          publicKeys: [kadenaConfig.publicKey]
        }
      ]
    });

    if (submission.status !== 'submitted' || !submission.requestKey) {
      console.error(`Deployment failed before submission: ${submission.message || submission.status}`);
      process.exit(1);
    }

    console.log('Contract deployment submitted. Request key:', submission.requestKey);
    const result = await listenForTransaction({
      requestKey: submission.requestKey,
      chainId: submission.chainId,
      networkId: submission.networkId
    });

    console.log('Contract deployed successfully.');
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('Deployment error:', error.message || error);
    process.exit(1);
  }
}

deployContract();
