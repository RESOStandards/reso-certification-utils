const { Axios } = require('axios');
const fs = require('fs');
const CONFIG = require('../config.json');

const getDataDictionaryOptions = (providerUoi, recipientUoi, data) => {
  if (!providerUoi) throw new Error('providerUoi is required!');
  if (!recipientUoi) throw new Error('recipientUoi is required!');
  if (!data) throw new Error('data is required!');

  return {
    'method': 'post',
    'baseURL': CONFIG.CERTIFICATION_API_URL,
    'url': `/api/v1/certification_reports/data_dictionary/${providerUoi}`,
    'headers': {
      'Authorization': `ApiKey ${CONFIG.API_KEY}`,
      'recipientUoi': recipientUoi,
      'Content-Type': 'application/json',
      'User-Agent': 'CommanderBatchProcess/0.1',
      'Accept': '*/*',
      'Cache-Control': 'no-cache',
      'Host': 'certification.reso.org',
      'Accept-Encoding': 'gzip, deflate',
      'Connection': 'keep-alive'
    },
    data
  }; 
};

const getDataAvailabilityOptions = (metadataReportId, data) => {
  if (!metadataReportId) throw new Error('metadataReportId is required!');
  if (!data) throw new Error('data is required!');

  return {
    'method': 'post',
    'baseURL': CONFIG.CERTIFICATION_API_URL,
    'url': `/api/v1/payload/data_availability/${metadataReportId}`,
    'headers': {
      'Authorization': `ApiKey ${CONFIG.API_KEY}`,
      'Content-Type': 'application/json',
      'User-Agent': 'CommanderBatchProcess/0.1',
      'Accept': '*/*',
      'Cache-Control': 'no-cache',
      'Host': 'certification.reso.org',
      'Accept-Encoding': 'gzip, deflate',
      'Connection': 'keep-alive'
    },
    data
  };
};

const buildDataDictionaryResultsPath = (providerUoi, recipientUoi) => `${providerUoi}/${recipientUoi}/${CONFIG.METADATA_REPORT_FILE_NAME}`;
const buildDataAvailabilityResultsPath = (providerUoi, recipientUoi) => `${providerUoi}/${recipientUoi}/${CONFIG.AVAILABILITY_REPORT_FILE_NAME}`;

const postDataDictionaryResultsToApi = async (providerUoi, recipientUoi) => {
  if (!providerUoi) throw new Error('providerUoi is required!');
  if (!recipientUoi) throw new Error('recipientUoi is required!');

  try {
    const data = await fs.readFileAsync(buildDataDictionaryResultsPath(providerUoi, recipientUoi), CONFIG.FILE_ENCODING);

    const response = await Axios.post(getDataDictionaryOptions(providerUoi, recipientUoi, data));

    if (!response.id) throw new Error('Did not receive the required id parameter from the response!');

    return response.id;
  } catch (err) {
    throw new Error('Could not post data dictionary results to API!' + '\n' + err);
  }
};

const postDataAvailabilityResultsToApi = async (metadataReportId, providerUoi, recipientUoi) => {
  try {
    const data = await fs.readFileAsync(buildDataAvailabilityResultsPath(providerUoi, recipientUoi), CONFIG.FILE_ENCODING);

    const response = await Axios.post(getDataAvailabilityOptions(metadataReportId, data));

    if (!response || !response.success) throw new Error('Api did not report a successful response! ');

    return response.id;
  } catch (err) {
    throw new Error('Could not post data availability results to API!' + '\n' + err);
  }
};

const snooze = ms => new Promise(resolve => setTimeout(resolve, ms));

const processDataDictionaryResults = async (providerUoi, recipientUoi) => {
  try {
    await snooze(CONFIG.API_DEBOUNCE_SECONDS * 1000); //wait for the dust to settle to avoid thrashing the server
    // TODO: handle this in the CLI util
    // console.log('Posting Data Dictionary results...');
    const reportId = await postDataDictionaryResultsToApi(providerUoi, recipientUoi);
    // TODO: handle this in the CLI util
    // console.log('Results posted, reportId: ' + reportId);

    await snooze(CONFIG.API_DEBOUNCE_SECONDS * 1000); //wait for the dust to settle to avoid thrashing the server

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

module.exports = {
  processDataDictionaryResults
};