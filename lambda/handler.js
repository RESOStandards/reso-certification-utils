'use strict';

// Thin Lambda wrapper around the shared backup engine. The engine and all deps live in the
// Lambda layer (see layer/build.sh), resolved here as a normal module from
// /opt/nodejs/node_modules via NODE_PATH. The function package itself is just this file.
//
// Invoked either directly (EventBridge/manual) or as the "small backup" branch of the
// Step Function. Needs only minimal config: a URL, an API key (from Secrets Manager), and a
// bucket — all overridable via the event for ad-hoc runs against other environments.

const { runBackup } = require('@reso/reso-certification-utils/lib/backup/runner');
const { loadApiKey, loadS3Credentials } = require('@reso/reso-certification-utils/lib/backup/secret');

const {
  CERT_API_URL,
  BACKUP_S3_BUCKET,
  SECRET_ARN,
  ENDORSEMENTS_PATH,
  AWS_REGION,
  UPLOAD_CONCURRENCY,
  INCLUDE_ARCHIVED = 'true',
  // Cross-account destination (prod-to-partner). When DEST_S3_SECRET_ARN is set, the backup
  // writes to BACKUP_S3_BUCKET using the static key in that secret instead of this account's
  // execution role. Unset on the QA stack -> writes to our own bucket via the role.
  DEST_S3_SECRET_ARN,
  DEST_S3_REGION,
  DEST_KEY_PREFIX
} = process.env;

exports.handler = async (event = {}) => {
  const url = event.url || CERT_API_URL;
  const bucket = event.bucket || BACKUP_S3_BUCKET;

  if (!url) throw new Error('CERT_API_URL env var or event.url is required');
  if (!bucket) throw new Error('BACKUP_S3_BUCKET env var or event.bucket is required');

  const apiKey = event.apiKey || (await loadApiKey({ secretArn: SECRET_ARN, region: AWS_REGION }));
  const includeArchived = event.includeArchived ?? INCLUDE_ARCHIVED !== 'false';

  // Resolve the destination: own bucket via role (no dest secret) vs. partner bucket via
  // static key. The dest-creds secret lives in THIS account, so it's read with AWS_REGION.
  let credentials, region = AWS_REGION;
  if (DEST_S3_SECRET_ARN) {
    credentials = await loadS3Credentials({ secretArn: DEST_S3_SECRET_ARN, region: AWS_REGION });
    region = DEST_S3_REGION || AWS_REGION;
  }

  return runBackup({
    url,
    apiKey,
    bucket,
    region,
    credentials,
    includeArchived,
    endorsementsPath: ENDORSEMENTS_PATH,
    workDir: '/tmp',
    keyPrefixBase: DEST_KEY_PREFIX || undefined,
    uploadConcurrency: UPLOAD_CONCURRENCY ? parseInt(UPLOAD_CONCURRENCY, 10) : undefined
  });
};
