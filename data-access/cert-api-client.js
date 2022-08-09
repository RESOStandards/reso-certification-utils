const axios = require('axios');
require('dotenv').config();
const { CERTIFICATION_API_URL, CERTIFICATION_API_KEY, ORGS_DATA_URL, SYSTEMS_DATA_URL } =
  process.env;

const API_DEBOUNCE_SECONDS = 1;

const getDataDictionaryOptions = ({ providerUoi, providerUsi, recipientUoi, results } = {}) => {
  if (!providerUoi) throw new Error('providerUoi is required!');
  if (!recipientUoi) throw new Error('recipientUoi is required!');
  if (!providerUsi) throw new Error('providerUsi is required!');
  if (!results) throw new Error('results are required!');

  return {
    method: 'post',
    baseURL: CERTIFICATION_API_URL,
    url: `/api/v1/certification_reports/data_dictionary/${providerUoi}`,
    headers: {
      Authorization: `ApiKey ${CERTIFICATION_API_KEY}`,
      recipientUoi,
      providerUsi,
      'Content-Type': 'application/json',
      'User-Agent': 'CommanderBatchProcess/0.1',
      Accept: '*/*',
      'Cache-Control': 'no-cache',
      Host: 'certification.reso.org',
      'Accept-Encoding': 'gzip, deflate',
      Connection: 'keep-alive'
    },
    results
  };
};

const getDataAvailabilityOptions = ({ metadataReportId, results }) => {
  if (!metadataReportId) throw new Error('metadataReportId is required!');
  if (!Object.keys(results).length) throw new Error('data is required!');

  return {
    method: 'post',
    baseURL: CERTIFICATION_API_URL,
    url: `/api/v1/payload/data_availability/${metadataReportId}`,
    headers: {
      Authorization: `ApiKey ${CERTIFICATION_API_KEY}`,
      'Content-Type': 'application/json',
      'User-Agent': 'CommanderBatchProcess/0.1',
      Accept: '*/*',
      'Cache-Control': 'no-cache',
      Host: 'certification.reso.org',
      'Accept-Encoding': 'gzip, deflate',
      Connection: 'keep-alive'
    },
    results
  };
};

const postDataDictionaryResultsToApi = async ({
  providerUoi,
  providerUsi,
  recipientUoi,
  results = {}
} = {}) => {
  if (!providerUoi) throw new Error('providerUoi is required!');
  if (!recipientUoi) throw new Error('recipientUoi is required!');
  if (!Object.keys(results).length) throw new Error('Data Dictionary results were empty!');

  try {
    const response = await axios.post(
      getDataDictionaryOptions({ providerUoi, providerUsi, recipientUoi, results })
    );

    if (!response.id)
      throw new Error('Did not receive the required id parameter from the response!');

    return response.id;
  } catch (err) {
    throw new Error('Could not post data dictionary results to API!' + '\n' + err);
  }
};

const postDataAvailabilityResultsToApi = async ({ metadataReportId, results = {} } = {}) => {
  if (!metadataReportId) throw new Error('providerUoi is required!');
  if (!Object.keys(results).length) throw new Error('Data availability results were empty!');

  try {
    const response = await axios.post(getDataAvailabilityOptions(metadataReportId, results));

    if (!response || !response.success)
      throw new Error('Api did not report a successful response! ');

    return response.id;
  } catch (err) {
    throw new Error('Could not post data availability results to API!' + '\n' + err);
  }
};

const snooze = ms => new Promise(resolve => setTimeout(resolve, ms));

const processDataDictionaryResults = async (providerUoi, recipientUoi) => {
  try {
    await snooze(API_DEBOUNCE_SECONDS * 1000); //wait for the dust to settle to avoid thrashing the server
    // TODO: handle this in the CLI util
    // console.log('Posting Data Dictionary results...');
    const reportId = await postDataDictionaryResultsToApi(providerUoi, recipientUoi);
    // TODO: handle this in the CLI util
    // console.log('Results posted, reportId: ' + reportId);

    await snooze(API_DEBOUNCE_SECONDS * 1000); //wait for the dust to settle to avoid thrashing the server

    if (reportId) {
      // TODO: handle this in the CLI util
      // console.log('Posting data availability results for reportId');
      return await postDataAvailabilityResultsToApi(reportId, providerUoi, recipientUoi);
    }
  } catch (err) {
    throw new Error('Could not process data dictionary results! \nError:' + err);
  }
  return null;
};

const getOrgsMap = async () => {
  const { Data: orgs = [] } = (await axios.get(ORGS_DATA_URL)).data;

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

const getOrgSystemsMap = async () => {
  return (await axios.get(SYSTEMS_DATA_URL))?.data?.values
    .slice(1)
    .reduce((acc, [providerUoi, , usi]) => {
      if (!acc[providerUoi]) acc[providerUoi] = [];
      acc[providerUoi].push(usi);
      return acc;
    }, {});
};

module.exports = {
  processDataDictionaryResults,
  getOrgsMap,
  getOrgSystemsMap
};
