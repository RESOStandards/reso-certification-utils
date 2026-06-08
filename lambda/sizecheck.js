'use strict';

// Step Function size-check task. Counts the reports a backup would pull and decides whether
// the run fits in Lambda (fast path) or should be handed to AWS Batch (>15-min path). Returns
// the routing decision plus the config the downstream states need, so the state machine
// doesn't have to re-derive anything. Threshold is env-driven (REPORT_COUNT_THRESHOLD) so it
// can be tuned without touching the state machine definition.

const { countReports } = require('@reso/reso-certification-utils/lib/backup/count');
const { loadApiKey } = require('@reso/reso-certification-utils/lib/backup/secret');

const {
  CERT_API_URL,
  BACKUP_S3_BUCKET,
  SECRET_ARN,
  ENDORSEMENTS_PATH,
  AWS_REGION,
  INCLUDE_ARCHIVED = 'true',
  REPORT_COUNT_THRESHOLD = '3000'
} = process.env;

exports.handler = async (event = {}) => {
  const url = event.url || CERT_API_URL;
  if (!url) throw new Error('CERT_API_URL env var or event.url is required');

  const includeArchived = event.includeArchived ?? INCLUDE_ARCHIVED !== 'false';
  const apiKey = event.apiKey || (await loadApiKey({ secretArn: SECRET_ARN, region: AWS_REGION }));

  const { reportCount, breakdown } = await countReports({
    url,
    apiKey,
    endorsementsPath: ENDORSEMENTS_PATH,
    includeArchived
  });

  const threshold = parseInt(REPORT_COUNT_THRESHOLD, 10) || 3000;
  const routeToBatch = reportCount > threshold;

  const result = {
    url,
    bucket: event.bucket || BACKUP_S3_BUCKET,
    includeArchived,
    reportCount,
    threshold,
    routeToBatch,
    breakdown
  };

  console.log('Size check:', JSON.stringify(result));
  return result;
};
