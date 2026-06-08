'use strict';

const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

// Shared Secrets Manager loader for the admin-tier Cert API key. Used by both Lambda
// wrappers (backup + size-check). The key is cached per warm container — rotate by forcing
// a cold start (e.g. update an env var on the function).

let client;
let cachedApiKey;

/**
 * Loads the Cert API key from Secrets Manager. Accepts either a raw-string secret or a JSON
 * secret with a CERTIFICATION_API_KEY field.
 *
 * @param {Object} args
 * @param {String} args.secretArn ARN (or name) of the secret holding the API key
 * @param {String} [args.region] AWS region for the Secrets Manager client
 * @returns {Promise<String>} the API key
 */
const loadApiKey = async ({ secretArn, region } = {}) => {
  if (cachedApiKey) return cachedApiKey;
  if (!secretArn) throw new Error('secretArn is required');

  client = client || new SecretsManagerClient(region ? { region } : {});
  const { SecretString } = await client.send(new GetSecretValueCommand({ SecretId: secretArn }));
  if (!SecretString) throw new Error(`Secret ${secretArn} has no SecretString`);

  try {
    const parsed = JSON.parse(SecretString);
    cachedApiKey = parsed.CERTIFICATION_API_KEY ?? SecretString.trim();
  } catch {
    cachedApiKey = SecretString.trim();
  }

  return cachedApiKey;
};

module.exports = {
  loadApiKey
};
