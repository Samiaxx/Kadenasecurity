const { Pact, createClient, createSignWithKeypair } = require('@kadena/client');

const DEFAULT_NETWORK_ID = 'testnet04';
const DEFAULT_CHAIN_ID = '1';
const DEFAULT_GAS_LIMIT = 10000;
const DEFAULT_GAS_PRICE = 0.00000001;
const DEFAULT_TTL = 900;

function clean(value) {
  return String(value || '').trim();
}

function cleanHex(value) {
  return clean(value).replace(/^0x/i, '');
}

function parseNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getNetworkId(override) {
  return clean(override || process.env.KADENA_NETWORK_ID) || DEFAULT_NETWORK_ID;
}

function getChainId(override) {
  return clean(override || process.env.KADENA_CHAIN_ID) || DEFAULT_CHAIN_ID;
}

function getBaseApiHost(networkId) {
  const configuredHost = clean(process.env.KADENA_API_HOST || process.env.KADENA_API_URL);
  if (configuredHost) {
    return configuredHost.replace(/\/+$/, '');
  }
  return networkId.startsWith('testnet')
    ? 'https://api.testnet.chainweb.com'
    : 'https://api.chainweb.com';
}

function buildPactHost({ networkId, chainId }) {
  const baseHost = getBaseApiHost(networkId);
  if (/\/chainweb\/0\.0\/[^/]+\/chain\/[^/]+\/pact$/i.test(baseHost)) {
    return baseHost;
  }
  return `${baseHost}/chainweb/0.0/${networkId}/chain/${chainId}/pact`;
}

function getApiKeyConfig() {
  const apiKey = clean(process.env.KADENA_API_KEY || process.env.KADENA_TESTNET_API_KEY);
  const headerName = clean(process.env.KADENA_API_KEY_HEADER) || 'x-api-key';
  return {
    apiKey,
    headerName,
    configured: Boolean(apiKey)
  };
}

function getSignerConfig() {
  const publicKey = cleanHex(process.env.KADENA_PUBLIC_KEY);
  const privateKey = cleanHex(process.env.KADENA_PRIVATE_KEY);
  const apiKeyConfig = getApiKeyConfig();

  if (!publicKey && !privateKey) {
    return {
      configured: false,
      publicKey: null,
      privateKey: null,
      reason: apiKeyConfig.configured
        ? 'KADENA_TESTNET_API_KEY is configured, but Kadena still needs KADENA_PUBLIC_KEY and KADENA_PRIVATE_KEY to sign a Pact transaction.'
        : 'Kadena signing keys are missing. Set KADENA_PUBLIC_KEY and KADENA_PRIVATE_KEY to enable on-chain anchoring.'
    };
  }

  if (!publicKey) {
    return {
      configured: false,
      publicKey: null,
      privateKey: null,
      reason: 'KADENA_PUBLIC_KEY is missing. The transaction cannot be signed without the account public key.'
    };
  }

  if (!privateKey) {
    return {
      configured: false,
      publicKey,
      privateKey: null,
      reason: apiKeyConfig.configured
        ? 'KADENA_PRIVATE_KEY is missing. A testnet API key can authenticate the HTTP request, but it cannot sign the Pact transaction.'
        : 'KADENA_PRIVATE_KEY is missing. Add the private key for the funded Kadena account that pays gas.'
    };
  }

  return {
    configured: true,
    publicKey,
    privateKey,
    reason: ''
  };
}

function getSenderAccount(publicKey) {
  const configuredSender = clean(process.env.KADENA_SENDER_ACCOUNT);
  if (configuredSender) {
    return configuredSender;
  }
  return publicKey ? `k:${publicKey}` : null;
}

function getKadenaConfig(options = {}) {
  const networkId = getNetworkId(options.networkId);
  const chainId = getChainId(options.chainId);
  const apiKeyConfig = getApiKeyConfig();
  const signerConfig = getSignerConfig();
  const publicKey = cleanHex(options.publicKey || signerConfig.publicKey);
  const senderAccount = clean(options.senderAccount) || getSenderAccount(publicKey);

  return {
    networkId,
    chainId,
    apiHost: buildPactHost({ networkId, chainId }),
    senderAccount,
    publicKey: publicKey || null,
    signerConfigured: signerConfig.configured,
    apiKeyConfigured: apiKeyConfig.configured,
    apiKeyHeader: apiKeyConfig.configured ? apiKeyConfig.headerName : null,
    reason: signerConfig.configured ? '' : signerConfig.reason
  };
}

function createKadenaClient() {
  const apiKeyConfig = getApiKeyConfig();
  return createClient(({ networkId, chainId }) => {
    const requestInit = {};
    if (apiKeyConfig.configured) {
      requestInit.headers = {
        [apiKeyConfig.headerName]: apiKeyConfig.apiKey
      };
    }
    return {
      hostUrl: buildPactHost({ networkId, chainId }),
      requestInit
    };
  });
}

function buildUnsignedTransaction(pactCode, options = {}) {
  const config = getKadenaConfig(options);
  if (!config.signerConfigured || !config.publicKey || !config.senderAccount) {
    throw new Error(config.reason || 'Kadena signing configuration is incomplete.');
  }

  const builder = Pact.builder
    .execution(pactCode)
    .addSigner(config.publicKey, (withCapability) => [withCapability('coin.GAS')])
    .setMeta({
      chainId: config.chainId,
      senderAccount: config.senderAccount,
      gasLimit: parseNumber(options.gasLimit || process.env.KADENA_GAS_LIMIT, DEFAULT_GAS_LIMIT),
      gasPrice: parseNumber(options.gasPrice || process.env.KADENA_GAS_PRICE, DEFAULT_GAS_PRICE),
      ttl: parseNumber(options.ttl || process.env.KADENA_TTL, DEFAULT_TTL)
    })
    .setNetworkId(config.networkId);

  (options.keysets || []).forEach((keyset) => {
    if (!keyset || !keyset.name || !Array.isArray(keyset.publicKeys) || keyset.publicKeys.length === 0) {
      return;
    }
    builder.addKeyset(keyset.name, keyset.predicate || 'keys-all', ...keyset.publicKeys);
  });

  return builder.createTransaction();
}

function formatPactError(error) {
  if (!error) {
    return 'Unknown Pact error';
  }
  if (typeof error === 'string') {
    return error;
  }
  if (typeof error.message === 'string' && error.message) {
    return error.message;
  }
  if (typeof error.msg === 'string' && error.msg) {
    return error.msg;
  }
  if (error.callStack) {
    try {
      return JSON.stringify(error.callStack);
    } catch (serializationError) {
      return 'Pact call stack error';
    }
  }
  try {
    return JSON.stringify(error);
  } catch (serializationError) {
    return 'Unable to serialize Pact error';
  }
}

function extractResult(payload) {
  if (payload && payload.result) {
    return payload.result;
  }
  return payload;
}

async function submitPactCode(pactCode, options = {}) {
  const config = getKadenaConfig(options);
  if (!config.signerConfigured) {
    return {
      status: 'skipped',
      message: config.reason,
      networkId: config.networkId,
      chainId: config.chainId,
      apiHost: config.apiHost,
      senderAccount: config.senderAccount
    };
  }

  try {
    const unsignedTransaction = buildUnsignedTransaction(pactCode, options);
    const signWithKeypair = createSignWithKeypair({
      publicKey: config.publicKey,
      secretKey: getSignerConfig().privateKey
    });
    const signedTransaction = await signWithKeypair(unsignedTransaction);
    const client = createKadenaClient();
    const preflightResponse = await client.preflight(signedTransaction);
    const preflightResult = extractResult(preflightResponse);

    if (preflightResult && preflightResult.status === 'failure') {
      return {
        status: 'preflight-failure',
        message: formatPactError(preflightResult.error),
        networkId: config.networkId,
        chainId: config.chainId,
        apiHost: config.apiHost,
        senderAccount: config.senderAccount,
        preflight: preflightResult
      };
    }

    const descriptor = await client.submit(signedTransaction);
    return {
      status: 'submitted',
      requestKey: descriptor.requestKey,
      networkId: descriptor.networkId,
      chainId: descriptor.chainId,
      apiHost: config.apiHost,
      senderAccount: config.senderAccount,
      preflight: preflightResult || { status: 'success' }
    };
  } catch (error) {
    return {
      status: 'error',
      message: error.message || 'Kadena transaction failed',
      networkId: config.networkId,
      chainId: config.chainId,
      apiHost: config.apiHost,
      senderAccount: config.senderAccount
    };
  }
}

async function listenForTransaction(descriptor) {
  const client = createKadenaClient();
  const response = await client.listen(descriptor);
  const result = extractResult(response);
  if (result && result.status === 'failure') {
    throw new Error(formatPactError(result.error));
  }
  return result;
}

function pactString(value) {
  return JSON.stringify(String(value == null ? '' : value));
}

function pactStringList(values) {
  return `[${(values || []).map((value) => pactString(value)).join(' ')}]`;
}

function pactInteger(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error('Expected an integer-compatible Pact value.');
  }
  return String(Math.round(parsed));
}

module.exports = {
  DEFAULT_NETWORK_ID,
  DEFAULT_CHAIN_ID,
  buildUnsignedTransaction,
  createKadenaClient,
  formatPactError,
  getKadenaConfig,
  listenForTransaction,
  pactInteger,
  pactString,
  pactStringList,
  submitPactCode
};
