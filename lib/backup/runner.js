'use strict';

const { readdir, readFile, rm } = require('fs/promises');
const { join, relative } = require('path');
const { gzipSync } = require('node:zlib');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

// Shared backup orchestrator used by BOTH execution paths:
//   - the Lambda wrapper (lambda/handler.js), and
//   - the AWS Batch entry (batch/entry.js)
// so a single code path produces and uploads the backup regardless of where it runs.
//
// NOTE: do NOT require('./index') (the backup lib) at module scope. Its transitive dep
// lib/misc/data-access/cert-api-client.js destructures process.env at load time, so the
// API key must be set in process.env BEFORE that require happens — hence the dynamic
// require inside runBackup(), after env is populated.

const BACKUP_DIR_NAME = 'reso-server-backup';
const DEFAULT_UPLOAD_CONCURRENCY = 10;

/**
 * Recursively lists every file under a directory.
 *
 * @param {String} dir directory to walk
 * @returns {Promise<String[]>} absolute file paths
 */
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

/**
 * Gzips and uploads every file under rootDir to S3 under keyPrefix, with bounded concurrency.
 * Keys mirror the local tree and get a `.gz` suffix.
 *
 * @param {Object} args s3 client, rootDir, bucket, keyPrefix, concurrency
 * @returns {Promise<{fileCount: Number, totalBytes: Number}>} upload stats (compressed bytes)
 */
const uploadDir = async ({ s3, rootDir, bucket, keyPrefix, concurrency = DEFAULT_UPLOAD_CONCURRENCY } = {}) => {
  const files = await walkFiles(rootDir);
  const workers = Math.max(1, parseInt(concurrency, 10) || DEFAULT_UPLOAD_CONCURRENCY);
  let cursor = 0;
  let totalBytes = 0;

  const worker = async () => {
    while (cursor < files.length) {
      const i = cursor++;
      const local = files[i];
      const body = gzipSync(await readFile(local));
      const Key = `${keyPrefix}/${relative(rootDir, local)}.gz`;
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key,
          Body: body,
          ContentType: 'application/json',
          ContentEncoding: 'gzip'
        })
      );
      totalBytes += body.length;
    }
  };

  await Promise.all(Array.from({ length: workers }, () => worker()));
  return { fileCount: files.length, totalBytes };
};

/**
 * Runs a full Cert API backup and uploads the result to S3.
 *
 * Self-contained given minimal config: a URL, an API key, and a target bucket. Everything
 * else (region, archived toggle, work dir) has sensible defaults so wrappers stay thin.
 *
 * @param {Object} args
 * @param {String} args.url Cert API root URL to back up
 * @param {String} args.apiKey admin-tier Cert API key
 * @param {String} args.bucket destination S3 bucket
 * @param {String} [args.region] AWS region for the S3 client (the DESTINATION bucket's region)
 * @param {Object} [args.credentials] static S3 credentials ({accessKeyId, secretAccessKey}) for
 *   writing to a cross-account bucket. Omit to use the ambient execution-role credentials.
 * @param {Boolean} [args.includeArchived=true] also back up archived reports
 * @param {String} [args.endorsementsPath] override for the paginated filter endpoint path
 * @param {String} [args.workDir='/tmp'] local scratch dir for the on-disk backup tree
 * @param {String} [args.keyPrefix] full S3 key prefix override; defaults to `<YYYY-MM-DD>/<startMs>`
 * @param {String} [args.keyPrefixBase] prefix the default `<YYYY-MM-DD>/<startMs>` with this base
 *   (e.g. a partner-required folder). Ignored when `keyPrefix` is given.
 * @param {Number} [args.uploadConcurrency=10] parallel S3 uploads
 * @param {Object} [args.logger=console] logger with a .log method
 * @returns {Promise<Object>} run summary (bucket, prefix, fileCount, totalBytes, duration, stats)
 */
const runBackup = async ({
  url,
  apiKey,
  bucket,
  region = process.env.AWS_REGION,
  credentials,
  includeArchived = true,
  endorsementsPath,
  workDir = '/tmp',
  keyPrefix,
  keyPrefixBase,
  uploadConcurrency = DEFAULT_UPLOAD_CONCURRENCY,
  logger = console
} = {}) => {
  if (!url) throw new Error('url is required');
  if (!apiKey) throw new Error('apiKey is required');
  if (!bucket) throw new Error('bucket is required');

  const started = Date.now();

  // Populate env BEFORE the dynamic require below — see note at top of file.
  process.env.CERTIFICATION_API_KEY = apiKey;
  if (endorsementsPath) process.env.ENDORSEMENTS_PATH = endorsementsPath;

  const { backup } = require('./index');

  const localBackupDir = join(workDir, BACKUP_DIR_NAME);
  await rm(localBackupDir, { recursive: true, force: true });

  const stats = await backup({ url, pathToBackup: workDir, includeArchived });
  if (!stats) throw new Error('Backup returned no stats — see logs for root cause');

  const defaultPrefix = `${new Date(started).toISOString().slice(0, 10)}/${started}`;
  const prefix = keyPrefix || (keyPrefixBase ? `${keyPrefixBase.replace(/\/+$/, '')}/${defaultPrefix}` : defaultPrefix);
  const s3 = new S3Client({
    ...(region ? { region } : {}),
    ...(credentials ? { credentials } : {})
  });
  const { fileCount, totalBytes } = await uploadDir({
    s3,
    rootDir: localBackupDir,
    bucket,
    keyPrefix: prefix,
    concurrency: uploadConcurrency
  });

  if (fileCount === 0) throw new Error('Backup produced no files — nothing uploaded to S3');

  await rm(localBackupDir, { recursive: true, force: true });

  const summary = {
    url,
    s3Bucket: bucket,
    s3Prefix: prefix,
    fileCount,
    totalBytes,
    durationSeconds: Math.round((Date.now() - started) / 1000),
    stats
  };

  logger.log?.('Backup complete:', JSON.stringify(summary));
  return summary;
};

module.exports = {
  runBackup,
  uploadDir
};
