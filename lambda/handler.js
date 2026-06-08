'use strict';

// Thin Lambda wrapper around the shared backup engine. The engine and all deps live in the
// Lambda layer (see layer/build.sh), resolved here as a normal module from
// /opt/nodejs/node_modules via NODE_PATH. The function package itself is just this file.
//
// Invoked either directly (EventBridge/manual) or as the "small backup" branch of the
// Step Function. Needs only minimal config: a URL, an API key (from Secrets Manager), and a
// bucket — all overridable via the event for ad-hoc runs against other environments.

const { runBackup } = require('@reso/reso-certification-utils/lib/backup/runner');
const { loadApiKey } = require('@reso/reso-certification-utils/lib/backup/secret');

const {
  CERT_API_URL,
  BACKUP_S3_BUCKET,
  SECRET_ARN,
  ENDORSEMENTS_PATH,
  AWS_REGION,
  UPLOAD_CONCURRENCY,
  INCLUDE_ARCHIVED = 'true'
} = process.env;

exports.handler = async (event = {}) => {
  const url = event.url || CERT_API_URL;
  const bucket = event.bucket || BACKUP_S3_BUCKET;

  if (!url) throw new Error('CERT_API_URL env var or event.url is required');
  if (!bucket) throw new Error('BACKUP_S3_BUCKET env var or event.bucket is required');

  const apiKey = event.apiKey || (await loadApiKey({ secretArn: SECRET_ARN, region: AWS_REGION }));
  const includeArchived = event.includeArchived ?? INCLUDE_ARCHIVED !== 'false';

  return runBackup({
    url,
    apiKey,
    bucket,
    region: AWS_REGION,
    includeArchived,
    endorsementsPath: ENDORSEMENTS_PATH,
    workDir: '/tmp',
    uploadConcurrency: UPLOAD_CONCURRENCY ? parseInt(UPLOAD_CONCURRENCY, 10) : undefined
  });
};
