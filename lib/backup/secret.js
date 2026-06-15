'use strict';

const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

// Shared Secrets Manager loaders. Used by both Lambda wrappers (backup + size-check) and the
// Batch entry. Values are cached per warm container — rotate by forcing a cold start (e.g.
// update an env var on the function/job). Note: the Secrets Manager client always uses THIS
// account's region/role to read the secret; any cross-account S3 creds it returns are used
// only by the S3 client downstream, not to read the secret itself.

let client;
let cachedApiKey;
let s3CredsClient;
let cachedS3Creds;

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

/**
 * Loads static S3 credentials for writing to a cross-account destination bucket. The secret
 * must be JSON with `accessKeyId` and `secretAccessKey` fields (the values a partner hands over
 * for their bucket). Cached per warm container — rotate by forcing a cold start.
 *
 * @param {Object} args
 * @param {String} args.secretArn ARN (or name) of the secret holding the destination creds
 * @param {String} [args.region] AWS region for the Secrets Manager client (THIS account's region)
 * @returns {Promise<{accessKeyId: String, secretAccessKey: String}>} static credentials
 */
const loadS3Credentials = async ({ secretArn, region } = {}) => {
  if (cachedS3Creds) return cachedS3Creds;
  if (!secretArn) throw new Error('secretArn is required');

  s3CredsClient = s3CredsClient || new SecretsManagerClient(region ? { region } : {});
  const { SecretString } = await s3CredsClient.send(new GetSecretValueCommand({ SecretId: secretArn }));
  if (!SecretString) throw new Error(`Secret ${secretArn} has no SecretString`);

  let parsed;
  try {
    parsed = JSON.parse(SecretString);
  } catch {
    throw new Error(`Secret ${secretArn} must be JSON with accessKeyId and secretAccessKey`);
  }

  const { accessKeyId, secretAccessKey } = parsed;
  if (!accessKeyId || !secretAccessKey) {
    throw new Error(`Secret ${secretArn} must contain accessKeyId and secretAccessKey`);
  }

  cachedS3Creds = { accessKeyId, secretAccessKey };
  return cachedS3Creds;
};

module.exports = {
  loadApiKey,
  loadS3Credentials
};
