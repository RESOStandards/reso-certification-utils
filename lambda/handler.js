'use strict';

const { readdir, readFile, rm } = require('fs/promises');
const { join, relative } = require('path');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

// NOTE: do NOT require('../lib/backup') at module scope. The backup lib's transitive deps
// destructure process.env at load time, so the Secrets Manager-sourced API key must be
// set in process.env BEFORE the require happens.

const {
  CERT_API_URL,
  BACKUP_S3_BUCKET,
  SECRET_ARN,
  ENDORSEMENTS_PATH,
  AWS_REGION,
  UPLOAD_CONCURRENCY = '10'
} = process.env;

const BACKUP_LOCAL_ROOT = '/tmp';
const BACKUP_DIR_NAME = 'reso-server-backup';

const s3 = new S3Client({ region: AWS_REGION });
const secrets = new SecretsManagerClient({ region: AWS_REGION });

let cachedApiKey;

const loadApiKey = async () => {
  if (cachedApiKey) return cachedApiKey;
  if (!SECRET_ARN) throw new Error('SECRET_ARN env var is required');

  const { SecretString } = await secrets.send(new GetSecretValueCommand({ SecretId: SECRET_ARN }));
  if (!SecretString) throw new Error(`Secret ${SECRET_ARN} has no SecretString`);

  try {
    const parsed = JSON.parse(SecretString);
    cachedApiKey = parsed.CERTIFICATION_API_KEY ?? SecretString.trim();
  } catch {
    cachedApiKey = SecretString.trim();
  }

  return cachedApiKey;
};

const walkFiles = async dir => {
  const out = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walkFiles(full)));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
};

const uploadAll = async (rootDir, bucket, keyPrefix) => {
  const files = await walkFiles(rootDir);
  const concurrency = Math.max(1, parseInt(UPLOAD_CONCURRENCY, 10) || 10);
  let cursor = 0;
  let totalBytes = 0;

  const worker = async () => {
    while (cursor < files.length) {
      const i = cursor++;
      const local = files[i];
      const body = await readFile(local);
      const Key = `${keyPrefix}/${relative(rootDir, local)}`;
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key,
          Body: body,
          ContentType: 'application/json'
        })
      );
      totalBytes += body.length;
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return { fileCount: files.length, totalBytes };
};

exports.handler = async (event = {}) => {
  const started = Date.now();

  if (!CERT_API_URL && !event.url) throw new Error('CERT_API_URL env var or event.url is required');
  if (!BACKUP_S3_BUCKET) throw new Error('BACKUP_S3_BUCKET env var is required');

  process.env.CERTIFICATION_API_KEY = await loadApiKey();
  if (ENDORSEMENTS_PATH) process.env.ENDORSEMENTS_PATH = ENDORSEMENTS_PATH;

  // Require only after env is populated — see note at top.
  const { backup } = require('../lib/backup');

  const localBackupDir = join(BACKUP_LOCAL_ROOT, BACKUP_DIR_NAME);
  await rm(localBackupDir, { recursive: true, force: true });

  const url = event.url || CERT_API_URL;
  const stats = await backup({ url, pathToBackup: BACKUP_LOCAL_ROOT });

  if (!stats) throw new Error('Backup returned no stats — see logs for root cause');

  const runDate = new Date().toISOString().slice(0, 10);
  const keyPrefix = `${runDate}/${started}`;
  const { fileCount, totalBytes } = await uploadAll(localBackupDir, BACKUP_S3_BUCKET, keyPrefix);

  if (fileCount === 0) throw new Error('Backup produced no files — nothing uploaded to S3');

  await rm(localBackupDir, { recursive: true, force: true });

  const summary = {
    url,
    s3Bucket: BACKUP_S3_BUCKET,
    s3Prefix: keyPrefix,
    fileCount,
    totalBytes,
    durationSeconds: Math.round((Date.now() - started) / 1000),
    stats
  };
  console.log('Backup complete:', JSON.stringify(summary));
  return summary;
};
