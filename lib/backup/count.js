'use strict';

// Cheap pre-flight report count used by the Step Function size-check to decide whether a
// run fits inside Lambda's 15-min wall or should be handed off to AWS Batch.
//
// It only paginates report *IDs* and lists (the same lightweight calls backup() makes
// before downloading anything) — it does NOT fetch full reports, so it's fast and safe to
// run on every scheduled invocation.
//
// Same env-capture caveat as runner.js: cert-api-client.js reads process.env at load time,
// so the API key is set before the dynamic require below.

/**
 * Counts the reports a full backup of the given server would pull.
 *
 * Data Dictionary reports are weighted x2 because each one drives both a DD and a Data
 * Availability fetch during the backup, which is what actually dominates wall-clock.
 *
 * @param {Object} args
 * @param {String} args.url Cert API root URL
 * @param {String} args.apiKey admin-tier Cert API key
 * @param {String} [args.endorsementsPath] override for the paginated filter endpoint path
 * @param {Boolean} [args.includeArchived=true] include archived reports in the count
 * @returns {Promise<{reportCount: Number, breakdown: Object}>}
 */
const countReports = async ({ url, apiKey, endorsementsPath, includeArchived = true } = {}) => {
  if (!url) throw new Error('url is required');
  if (!apiKey) throw new Error('apiKey is required');

  process.env.CERTIFICATION_API_KEY = apiKey;
  if (endorsementsPath) process.env.ENDORSEMENTS_PATH = endorsementsPath;

  const {
    fetchDataDictionaryReportIds,
    fetchAllWebApiReports,
    fetchAllArchivedReports
  } = require('../misc/data-access/cert-api-client');

  // backup:true → all statuses, matching what backup() actually pulls.
  const [ddReportIds = [], otherReports = []] = await fetchDataDictionaryReportIds({
    serverUrl: url,
    endorsementsPath,
    backup: true
  });

  const webApiReports = (await fetchAllWebApiReports({ serverUrl: url })) || [];
  const archived = includeArchived ? (await fetchAllArchivedReports({ serverUrl: url })) || [] : [];

  const dd = ddReportIds.length;
  const breakdown = {
    dd,
    da: dd,
    webApi: webApiReports.length,
    other: otherReports.length,
    archived: archived.length
  };

  const reportCount = dd * 2 + webApiReports.length + otherReports.length + archived.length;
  return { reportCount, breakdown };
};

module.exports = {
  countReports
};
