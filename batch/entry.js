'use strict';

// AWS Batch entry point for the >15-min backup path. Runs the SAME shared engine as the
// Lambda wrapper — the only difference is packaging: Batch runs a container (it can't mount
// a Lambda layer), so the whole repo ships in the image and the engine is required by
// relative path here instead of from the layer's node_modules.
//
// Config comes entirely from the environment (set by the Batch job definition): a URL, a
// bucket, and either an API key directly (CERTIFICATION_API_KEY) or a Secrets Manager ARN
// (SECRET_ARN) to load it from. Exits non-zero on failure so Batch marks the job FAILED.

const { runBackup } = require('../lib/backup/runner');
const { loadApiKey } = require('../lib/backup/secret');

const main = async () => {
  const {
    CERT_API_URL,
    BACKUP_S3_BUCKET,
    SECRET_ARN,
    CERTIFICATION_API_KEY,
    ENDORSEMENTS_PATH,
    AWS_REGION,
    INCLUDE_ARCHIVED = 'true',
    UPLOAD_CONCURRENCY,
    WORK_DIR = '/data'
  } = process.env;

  if (!CERT_API_URL) throw new Error('CERT_API_URL is required');
  if (!BACKUP_S3_BUCKET) throw new Error('BACKUP_S3_BUCKET is required');

  const apiKey = CERTIFICATION_API_KEY || (await loadApiKey({ secretArn: SECRET_ARN, region: AWS_REGION }));

  const summary = await runBackup({
    url: CERT_API_URL,
    apiKey,
    bucket: BACKUP_S3_BUCKET,
    region: AWS_REGION,
    includeArchived: INCLUDE_ARCHIVED !== 'false',
    endorsementsPath: ENDORSEMENTS_PATH,
    workDir: WORK_DIR,
    uploadConcurrency: UPLOAD_CONCURRENCY ? parseInt(UPLOAD_CONCURRENCY, 10) : undefined
  });

  console.log(JSON.stringify(summary));
};

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
