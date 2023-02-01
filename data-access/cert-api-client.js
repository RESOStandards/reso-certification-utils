const axios = require('axios');
require('dotenv').config();
const { CERTIFICATION_API_KEY, ORGS_DATA_URL, SYSTEMS_DATA_URL } = process.env;

const API_DEBOUNCE_SECONDS = 0.1;

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

const deleteDataDictionaryResults = async ({ url, reportId } = {}) => {
  if (!url) throw new Error('url is required!');
  if (!reportId) throw new Error('reportId is required!');

  try {
    const { deletedReport } =
      (
        await axios.delete(`${url}/api/v1/certification_reports/${reportId}`, {
          headers: {
            Authorization: `ApiKey ${CERTIFICATION_API_KEY}`
          }
        })
      ).data || {};

    return deletedReport;
  } catch (err) {
    throw new Error(err);
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
  dataAvailabilityReport = {},
  reportIdToDelete,
  overwrite = false
}) => {
  try {
    if (overwrite) {
      if (!reportIdToDelete) throw new Error('reportIdToDelete MUST be present when overwrite is used!');
      await deleteDataDictionaryResults({ url, reportId: reportIdToDelete });
    }

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

module.exports = {
  processDataDictionaryResults,
  getOrgsMap,
  getOrgSystemsMap,
  findDataDictionaryReport,
  sleep
};
