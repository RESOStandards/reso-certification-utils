'use strict';

const { replicationIterator, REPLICATION_STRATEGIES } = require('./replication-iterator');
const { scorePayload, writeDataAvailabilityReport } = require('./utils');
const { writeFile, mkdir } = require('fs/promises');
const { join } = require('path');
const humanizeDuration = require('humanize-duration');

const REPLICATION_DIRECTORY_NAME = 'reso-replication-output';

// need to get the last part of the URL before the querystring
const parseResourceNameFromODataRequestUri = (requestUri = '') => {
  try {
    const [resourceName = null] = new URL(requestUri).pathname.split('/').slice(-1);
    return resourceName;
  } catch (err) {
    console.error(err);
    return null;
  }
};

const buildOutputFilePath = (outputPath, resourceName) =>
  join(outputPath, REPLICATION_DIRECTORY_NAME, resourceName, new Date().toISOString().replaceAll(':', '-'));

const replicate = async ({ url: requestUri, strategy, bearerToken, outputPath, limit, expansions = ['Media' /* TODO */ ] }) => {
  if (!Object.values(REPLICATION_STRATEGIES).includes(strategy)) {
    throw new Error(`Unknown strategy: '${strategy}'!`);
  }

  const resourceName = parseResourceNameFromODataRequestUri(requestUri),
    shouldSaveResults = !!outputPath,
    resultsPath = shouldSaveResults
      ? buildOutputFilePath(outputPath, resourceName)
      : null;

  const startTime = Date.now(),
    responseTimes = [],
    resourceAvailabilityMap = {};

  let totalRecordCount = 0;

  try {
    for await (const {
      hasResults = false,
      hasError = false,
      responseTimeMs = 0,
      response = {},
      error = {},
      startTime = 0,
      stopTime = 0,
      totalRecordsFetched = 0,
      pagesFetched = 0
    } of replicationIterator({ requestUri, strategy, authInfo: { bearerToken }})) {

      if (hasError) {
        const { statusCode, message, errorType, error: errorData } = error;
        if (errorType === 'http') {
          console.error(`HTTP request error! Status code: ${statusCode}, message: '${message}'`);
        } else {
          throw new Error(`${errorType} error occurred! Error data: ${JSON.stringify(errorData, null, '  ')}`);
        }
      }

      if (hasResults) {
        if (response?.value?.length) {
          scorePayload({
            requestUri,
            records: response.value,
            resourceAvailabilityMap, // mutated on each call
            resourceName,
            expansions,
            responseTimeMs,
            startTime,
            stopTime
          });

          if (shouldSaveResults) {
            await mkdir(resultsPath, { recursive: true });
            await writeFile(join(resultsPath, `page-${pagesFetched}.json`), JSON.stringify(response));
          }
        }
        
        totalRecordCount = totalRecordsFetched;
        responseTimes.push(responseTimeMs);
      }

      if (!!limit && totalRecordsFetched >= limit) {
        break;
      }
    }
    await writeDataAvailabilityReport({ version: '1.7', resourceAvailabilityMap });
  } catch (err) {
    console.error(err);
  } finally {
    console.log(`\nReplication completed in ${humanizeDuration(Date.now() - startTime, { round: false })}!`);
    console.log(
      `Total requests: ${responseTimes?.length || 0}, Average response time: ${humanizeDuration(parseInt(
        responseTimes?.reduce((acc, item) => {
          if (item) {
            acc += item;
          }
          return acc;
        }, 0) / (responseTimes.length || 1)
      ))}, Total records: ${totalRecordCount}\n`
    );
  }
  return;
};

module.exports = {
  replicate
};
