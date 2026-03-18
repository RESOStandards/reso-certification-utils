'use strict';

const chalk = require('chalk');

const { CERTIFICATION_API_KEY, ORGS_DATA_URL, SYSTEMS_DATA_URL, ENDORSEMENTS_PATH } = process.env;
const { sleep } = require('../../../common');

const API_DEBOUNCE_SECONDS = 1;

const CERTIFICATION_ORG_TYPES = Object.freeze(['MLS', 'Technology Company', 'Pooled Platform', 'Commercial', 'Brokerage']);

const STATUSES = Object.freeze({
  PASSED: 'passed',
  CERTIFIED: 'certified',
  NOTIFIED: 'recipient_notified'
});

const ENDORSEMENTS = Object.freeze({
  DATA_DICTIONARY: 'data_dictionary',
  DATA_AVAILABILITY: 'data_availability',
  WEB_API: 'web_api_server_core'
});

/**
 * Posts Data Dictionary results to the Certification API at the given URL.
 *
 * @param {Object} args includes the URL to post to and UOI and USI information
 * @returns reportId that was created
 * @throws if invalid JSON response or reportId is returned from the API
 */
const postDataDictionaryResultsToApi = async ({ url, providerUoi, providerUsi, recipientUoi, metadataReport = {} } = {}) => {
  if (!url) throw new Error('url is required!');
  if (!providerUoi) throw new Error('providerUoi is required!');
  if (!providerUsi) throw new Error('providerUsi is required!');
  if (!recipientUoi) throw new Error('recipientUoi is required!');
  if (!Object.keys(metadataReport)?.length) throw new Error('metadataReport is empty!');

  //TODO: add report pre-processing
  try {
    const response = await fetch(`${url}/api/v1/certification_reports/data_dictionary/${providerUoi}`, {
      headers: {
        Authorization: `ApiKey ${CERTIFICATION_API_KEY}`,
        recipientUoi,
        'Content-Type': 'application/json',
        providerUsi
      },
      method: 'POST',
      body: JSON.stringify(metadataReport)
    });

    if (!response.ok) throw new Error(`Received invalid response from the API! Status code: ${response.status}`);

    const { id: reportId = null } = await response.json();

    if (!(!!reportId && typeof reportId === 'string' && reportId?.length)) {
      throw new Error('Did not receive a valid reportId from the Certification API!');
    }
    return reportId;
  } catch (err) {
    throw new Error(`Could not post data dictionary results to API! ${err}`);
  }
};

/**
 *
 * Posts data availability reports to the API.
 *
 * @param {Object} args includes the URL of the Certification API, reportId, and report
 * @returns true if report was processed, false otherwise
 * @throws if report could not be processed or is in an invalid format
 */
const postDataAvailabilityResultsToApi = async ({ url, reportId, dataAvailabilityReport = {} } = {}) => {
  if (!url) throw new Error('url is required!');
  if (!reportId) throw new Error('reportId is required!');
  if (!Object.keys(dataAvailabilityReport)?.length) throw new Error('metadataReport is empty!');

  try {
    const response = await fetch(`${url}/api/v1/payload/data_availability/${reportId}`, {
      headers: {
        Authorization: `ApiKey ${CERTIFICATION_API_KEY}`,
        'Content-Type': 'application/json'
      },
      method: 'POST',
      body: JSON.stringify(dataAvailabilityReport)
    });

    if (!response.ok) return false;

    const { success = false } = await response.json();
    return success;
  } catch (err) {
    throw new Error(`Could not post data availability results to API!\n${err}`);
  }
};

/**
 * Processes DD results for the given org and reports.
 *
 * @param {Object} args include API, reports, and UOI/USI information
 * @returns outcome of posting availability results to API or null
 */
const processDataDictionaryResults = async ({
  url,
  providerUoi,
  providerUsi,
  recipientUoi,
  metadataReport = {},
  dataAvailabilityReport = {}
}) => {
  try {
    //wait for the dust to settle to avoid thrashing the server
    await sleep(API_DEBOUNCE_SECONDS * 1000);

    const reportId = await postDataDictionaryResultsToApi({
      url,
      providerUoi,
      providerUsi,
      recipientUoi,
      metadataReport
    });

    if (reportId) {
      //wait for the dust to settle to avoid thrashing the server
      await sleep(API_DEBOUNCE_SECONDS * 1000);
      return await postDataAvailabilityResultsToApi({ url, reportId, dataAvailabilityReport });
    } else {
      return null;
    }
  } catch (err) {
    throw new Error(`Could not process data dictionary results! ${err}`);
  }
};

/**
 * Creates a map of UOIs based on data in the ORGS_DATA_URL environment variable.
 *
 * @returns map of orgs eligible for certification
 */
const getOrgsMap = async () => {
  const ERR_MSG = `Could not fetch RESO UOI data!\nURL: ${ORGS_DATA_URL}`;

  try {
    const response = await fetch(ORGS_DATA_URL);
    if (!response.ok) throw new Error(`${ERR_MSG}\nStatus code: ${response.status}`);

    const { Data: uoiData = [] } = await response.json();

    return uoiData.reduce((acc, { OrganizationUniqueId, OrganizationType }) => {
      const uoi = !!OrganizationUniqueId && OrganizationUniqueId?.trim()?.length ? OrganizationUniqueId.trim() : null;
      const orgType = !!OrganizationType && OrganizationType?.trim()?.length ? OrganizationType.trim() : null;

      if (!(uoi && orgType && CERTIFICATION_ORG_TYPES.includes(orgType))) {
        return acc;
      }
      acc[uoi] = true;
      return acc;
    }, {});
  } catch (err) {
    throw new Error(`${ERR_MSG}\nError: ${err}`);
  }
};

/**
 * Creates a map of USIs based on data in the SYSTEMS_DATA_URL environment variable.
 * 
 * @returns current USIs 
 * @throws if USI data could not be fetched or processed
 */
const getOrgSystemsMap = async () => {
  try {
    const response = await fetch(SYSTEMS_DATA_URL);

    if (!response.ok) throw new Error(`Received invalid response from the API! Status code: ${response.status}`);

    const { values = [] } = await response.json();

    return values?.slice(1).reduce((acc, [providerUoi, , usi]) => {
      if (!acc?.[providerUoi]) acc[providerUoi] = [];
      acc[providerUoi].push(usi);
      return acc;
    }, {}) ?? {};

  } catch (err) {
    throw new Error(`Could not fetch RESO USI data!\nURL: ${SYSTEMS_DATA_URL}\nError: ${err}`);
  }
};

/**
 * Builds the filter options payload for the endorsements endpoint.
 *
 * @param {Number} from pagination offset
 * @param {Boolean} backup if true, fetches all statuses; otherwise only passed/certified/notified
 * @returns filter options object
 */
const buildEndorsementsFilterOptions = (from = 0, backup = false) => ({
  options: {
    from,
    endorsementFilter: [],
    statusFilter: backup ? [] : [STATUSES.PASSED, STATUSES.CERTIFIED, STATUSES.NOTIFIED],
    showMyResults: true,
    providerUoi: null,
    searchKey: '',
    sortBy: 'asc'
  }
});

/**
 * Fetches all Data Dictionary report IDs from the server by paginating through the endorsements endpoint.
 *
 * @param {Object} args serverUrl and optional backup flag
 * @returns [reportIds, otherReports] tuple
 */
const fetchDataDictionaryReportIds = async ({ serverUrl = '', endorsementsPath = ENDORSEMENTS_PATH, backup = false } = {}) => {
  let lastIndex = 0,
    lastStatusCode = 0;

  const reportIds = [];
  const otherReports = [];

  do {
    const response = await fetch(`${serverUrl}${endorsementsPath}`, {
      method: 'POST',
      headers: {
        Authorization: `ApiKey ${CERTIFICATION_API_KEY}`,
        'Content-Type': 'application/json',
        isadmin: 'true'
      },
      body: JSON.stringify(buildEndorsementsFilterOptions(lastIndex, backup))
    });

    lastStatusCode = response.status;

    if (!response.ok) break;

    const { lastUoiIndex, reportsByOrgs = {} } = await response.json();

    if (!Object.keys(reportsByOrgs).length) break;

    lastIndex = lastUoiIndex;

    Object.values(reportsByOrgs).forEach((endorsements = []) => {
      endorsements.forEach(({ type, id: reportId, ...rest }) => {
        if (type === ENDORSEMENTS.DATA_DICTIONARY) {
          reportIds.push(reportId);
        } else if (type !== ENDORSEMENTS.WEB_API) {
          otherReports.push({ type, id: reportId, ...rest });
        }
      });
    });

    await sleep(500);
  } while (lastStatusCode >= 200 && lastStatusCode < 300);

  return [reportIds, otherReports];
};

/**
 * Fetches a single full Data Dictionary report by ID.
 *
 * @param {Object} args serverUrl and report id
 * @returns report data or null on error
 */
const fetchSingleDDReport = async ({ serverUrl = '', id = '' } = {}) => {
  try {
    const response = await fetch(`${serverUrl}/api/v1/certification_reports/full/data_dictionary/${id}`, {
      headers: {
        Authorization: `ApiKey ${CERTIFICATION_API_KEY}`
      }
    });

    if (!response.ok) throw new Error(`Status: ${response.status}`);

    return await response.json();
  } catch (err) {
    console.log(chalk.redBright.bold(`Could not fetch data dictionary report ${id}`));
    return null;
  }
};

/**
 * Fetches all Web API Core reports from the server.
 *
 * @param {Object} args serverUrl
 * @returns array of reports or null on error
 */
const fetchAllWebApiReports = async ({ serverUrl = '' } = {}) => {
  try {
    const response = await fetch(`${serverUrl}/api/v1/certification_reports/web_api/all`, {
      headers: {
        Authorization: `ApiKey ${CERTIFICATION_API_KEY}`
      }
    });

    if (!response.ok) throw new Error(`Status: ${response.status}`);

    return await response.json();
  } catch (err) {
    console.log(chalk.redBright.bold('Could not fetch web api reports'));
    return null;
  }
};

/**
 * Fetches a full Data Availability report by its associated report ID.
 *
 * @param {Object} args serverUrl and reportId
 * @returns report data or null on error
 */
const fetchDataAvailabilityReport = async ({ serverUrl = '', reportId = '' } = {}) => {
  if (!reportId) return null;

  try {
    const response = await fetch(`${serverUrl}/api/v1/certification_reports/full/data_availability/${reportId}`, {
      headers: {
        Authorization: `ApiKey ${CERTIFICATION_API_KEY}`
      }
    });

    if (!response.ok) throw new Error(`Status: ${response.status}`);

    return await response.json();
  } catch (err) {
    console.log(chalk.redBright.bold(`Could not fetch data availability report ${reportId}`));
    return null;
  }
};

/**
 * Restores a previously backed-up report by POSTing it to the server's restore endpoint.
 *
 * @param {Object} args serverUrl and the full report object
 * @returns true on success, false on error
 */
const restoreBackedUpReport = async ({ serverUrl = '', report = {} } = {}) => {
  try {
    const response = await fetch(`${serverUrl}/api/v1/restore`, {
      method: 'POST',
      headers: {
        Authorization: `ApiKey ${CERTIFICATION_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(report)
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      console.log(chalk.redBright.bold(`Restore failed (${response.status}): ${body}`));
    }

    return response.ok;
  } catch (err) {
    console.log(err);
    return false;
  }
};

module.exports = {
  processDataDictionaryResults,
  getOrgsMap,
  getOrgSystemsMap,
  fetchDataDictionaryReportIds,
  fetchSingleDDReport,
  fetchAllWebApiReports,
  fetchDataAvailabilityReport,
  restoreBackedUpReport
};
