'use strict';

const axios = require('axios');
const chalk = require('chalk');
require('dotenv').config();
const { CERTIFICATION_API_KEY, ORGS_DATA_URL, SYSTEMS_DATA_URL } = process.env;

const API_DEBOUNCE_SECONDS = 0.1;

const STATUSES = {
  PASSED: 'passed',
  CERTIFIED: 'certified',
  NOTIFIED: 'recipient_notified'
};

const ENDORSEMENTS = {
  DATA_DICTIONARY: 'data_dictionary',
  DATA_AVAILABILITY: 'data_availability',
  WEB_API: 'web_api_server_core'
};

const postDataDictionaryResultsToApi = async ({
  url,
  providerUoi,
  providerUsi,
  recipientUoi,
  metadataReport = {}
} = {}) => {
  if (!url) throw new Error('url is required!');
  if (!providerUoi) throw new Error('providerUoi is required!');
  if (!providerUsi) throw new Error('providerUsi is required!');
  if (!recipientUoi) throw new Error('recipientUoi is required!');
  if (!Object.keys(metadataReport)?.length) throw new Error('metadataReport is empty!');

  try {
    const { id: reportId = null } =
      (
        await axios.post(
          `${url}/api/v1/certification_reports/data_dictionary/${providerUoi}`,
          metadataReport,
          {
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
            headers: {
              Authorization: `ApiKey ${CERTIFICATION_API_KEY}`,
              recipientUoi,
              'Content-Type': 'application/json',
              providerUsi
            }
          }
        )
      ).data || {};

    if (!reportId) throw new Error('Did not receive the required id parameter from the response!');

    return reportId;
  } catch (err) {
    throw new Error(`Could not post data dictionary results to API! ${err}`);
  }
};

const postDataAvailabilityResultsToApi = async ({ url, reportId, dataAvailabilityReport = {} } = {}) => {
  if (!url) throw new Error('url is required!');
  if (!reportId) throw new Error('reportId is required!');
  if (!Object.keys(dataAvailabilityReport)?.length) throw new Error('metadataReport is empty!');

  try {
    const { success = false } =
      (
        await axios.post(`${url}/api/v1/payload/data_availability/${reportId}`, dataAvailabilityReport, {
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
          headers: {
            Authorization: `ApiKey ${CERTIFICATION_API_KEY}`,
            'Content-Type': 'application/json'
          }
        })
      ).data || {};

    if (!success) throw new Error('Api did not report a successful response! ');

    return success;
  } catch (err) {
    throw new Error('Could not post data availability results to API!' + '\n' + err);
  }
};

const sleep = async ms => new Promise(resolve => setTimeout(resolve, ms));

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

const getOrgsMap = async () => {
  const { Organizations: orgs = [] } = (await axios.get(ORGS_DATA_URL)).data;

  if (!orgs?.length) throw new Error('ERROR: could not fetch Org data!');

  return orgs.reduce((acc, { OrganizationUniqueId, OrganizationType }) => {
    if (
      !['MLS', 'Technology Company', 'Pooled Platform', 'Commercial', 'Brokerage'].find(
        type => type?.trim() === OrganizationType
      )
    ) {
      return acc;
    }

    acc[OrganizationUniqueId] = true;

    return acc;
  }, {});
};

const findDataDictionaryReport = async ({ serverUrl, providerUoi, providerUsi, recipientUoi } = {}) => {
  const url = `${serverUrl}/api/v1/certification_reports/summary/${recipientUoi}`,
    config = {
      headers: {
        Authorization: `ApiKey ${CERTIFICATION_API_KEY}`
      }
    };

  try {
    const { data = [] } = await axios.get(url, config);

    return data.find(
      item =>
        item?.type === 'data_dictionary' &&
        item?.providerUoi === providerUoi &&
        //provider USI isn't in the data set at the moment, only filter if it's present
        (item?.providerUsi ? item.providerUsi === providerUsi : true)
    );
  } catch (err) {
    throw new Error(`Could not connect to ${url}`);
  }
};

const getOrgSystemsMap = async () => {
  return (await axios.get(SYSTEMS_DATA_URL))?.data?.values.slice(1).reduce((acc, [providerUoi, , usi]) => {
    if (!acc[providerUoi]) acc[providerUoi] = [];
    acc[providerUoi].push(usi);
    return acc;
  }, {});
};

const buildEndorsementsFilterOptions = (from = 0, backup) => {
  return {
    options: {
      from,
      endorsementFilter: [],
      statusFilter: backup ? [] : [STATUSES.PASSED, STATUSES.CERTIFIED, STATUSES.NOTIFIED],
      showMyResults: true,
      providerUoi: null,
      searchKey: '',
      sortBy: 'asc'
    }
  };
};

const fetchDataDictionaryReportIds = async ({ serverUrl = '', endorsementsPath = '', backup = false }) => {
  let lastIndex = 0,
    lastStatusCode = 0;

  const reportIds = [];
  const otherReports = [];

  do {
    const { data, status } = await axios.post(
      serverUrl + endorsementsPath,
      buildEndorsementsFilterOptions(lastIndex, backup),
      {
        headers: {
          Authorization: `ApiKey ${CERTIFICATION_API_KEY}`,
          isadmin: true
        }
      }
    );

    const { lastUoiIndex, reportsByOrgs = {} } = data;

    //if there's no data in the response, we've reached the end: terminate
    if (!Object.keys(reportsByOrgs).length) break;

    lastIndex = lastUoiIndex;
    lastStatusCode = status;

    Object.values(reportsByOrgs).forEach((endorsements = []) => {
      endorsements.forEach(({ type, id: reportId, ...rest }) => {
        if (type === ENDORSEMENTS.DATA_DICTIONARY) {
          // reportIds.push(reportId);
        } else if (type !== ENDORSEMENTS.WEB_API) {
          otherReports.push({ type, id: reportId, ...rest });
        }
      });
    });

    //sleep 1s so we don't hammer the server if it's busy
    await sleep(500);
  } while (lastStatusCode >= 200 && lastStatusCode < 300);

  return [reportIds, otherReports];
};

const fetchSingleDDReport = async ({ serverUrl = '', id = '' }) => {
  const DD_FULL_REPORT_BASE_URL = 'api/v1/certification_reports/full/data_dictionary';
  try {
    const { data } = await axios.get(`${serverUrl}/${DD_FULL_REPORT_BASE_URL}/${id}`, {
      headers: {
        Authorization: `ApiKey ${CERTIFICATION_API_KEY}`
      }
    });
    return data;
  } catch (error) {
    console.log(chalk.redBright.bold(`Could not fetch data dictionary report ${id}`));
    return null;
  }
};

const fetchAllWebApiReports = async ({ serverUrl = '' }) => {
  const ALL_WEB_API_REPORTS_URL = 'api/v1/certification_reports/web_api/all';
  try {
    const { data } = await axios.get(`${serverUrl}/${ALL_WEB_API_REPORTS_URL}`, {
      headers: {
        Authorization: `ApiKey ${CERTIFICATION_API_KEY}`
      }
    });
    return data;
  } catch (error) {
    console.log(chalk.redBright.bold('Could not fetch web api reports'));
    return null;
  }
};

const buildAvailabilityReportUrl = (serverUrl, reportId) =>
  `${serverUrl}/api/v1/certification_reports/full/data_availability/${reportId}`;

const fetchDataAvailabilityReport = async ({ serverUrl = '', reportId = '' }) => {
  if (!reportId) return null;

  try {
    const { data } = await axios.get(buildAvailabilityReportUrl(serverUrl, reportId), {
      headers: {
        Authorization: `ApiKey ${CERTIFICATION_API_KEY}`
      }
    });
    return data;
  } catch (err) {
    console.log(chalk.redBright.bold(`Could not fetch data availability report ${reportId}`));
    return null;
  }
};

const postTransformedReport = async ({ serverUrl, rescoredReport, reportId }) => {
  const RESCORE_BASE_URL = 'api/v1/payload/data_availability';
  try {
    await axios.post(
      `${serverUrl}/${RESCORE_BASE_URL}/${reportId}/rescore`,
      { ...rescoredReport },
      {
        headers: {
          Authorization: `ApiKey ${CERTIFICATION_API_KEY}`
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      }
    );
    return true;
  } catch (error) {
    console.log(error);
    return false;
  }
};

const restoreBackedUpReport = async ({ serverUrl, report }) => {
  const RESTORE_BASE_URL = 'restore';
  try {
    await axios.post(
      `${serverUrl}/api/v1/${RESTORE_BASE_URL}`,
      { ...report },
      {
        headers: {
          Authorization: `ApiKey ${CERTIFICATION_API_KEY}`
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      }
    );
    return true;
  } catch (error) {
    console.log(error);
    return false;
  }
};

module.exports = {
  processDataDictionaryResults,
  getOrgsMap,
  getOrgSystemsMap,
  findDataDictionaryReport,
  sleep,
  fetchDataDictionaryReportIds,
  fetchDataAvailabilityReport,
  fetchSingleDDReport,
  postTransformedReport,
  fetchAllWebApiReports,
  restoreBackedUpReport
};
