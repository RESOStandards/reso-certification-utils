'use strict';

const { replicationIterator, REPLICATION_STRATEGIES } = require('./replication-iterator');
const { scorePayload, writeDataAvailabilityReport } = require('./utils');
const { writeFile, mkdir } = require('fs/promises');
const { join } = require('path');
const humanizeDuration = require('humanize-duration');

const REPLICATION_DIRECTORY_NAME = 'reso-replication-output';

/**
 *
 * Parses the OData resource name from the given URI
 *
 * Example: https://some.api.com/v2/Property
 *
 * @param {String} requestUri the string for the OData request URI
 * @returns OData resource name or null
 */
const parseResourceNameFromODataRequestUri = (requestUri = '') => {
  try {
    const [resourceName = null] = new URL(requestUri).pathname.split('/').slice(-1);
    return resourceName;
  } catch (err) {
    console.error(err);
    return null;
  }
};

/**
 * Builds a path to use when saving results
 *
 * @param {String} outputPath the target directory in which to save results (current by default)
 * @param {*} resourceName the name of the Data Dictionary resource whose files are being saved
 * @returns an operating system dependent path to save replication data with
 */
const buildOutputFilePath = (outputPath, resourceName) =>
  join(outputPath, REPLICATION_DIRECTORY_NAME, resourceName, new Date().toISOString().replaceAll(':', '-'));

/**
 * Replicates data from the given OData request URL using the given strategy, credentials, and options
 *
 * @param {Object} args this function takes multiple parameters
 * @returns this function has no return value, but will produce side effects if outputPath is used (will write files)
 */
const replicate = async ({ url: requestUri, strategy, bearerToken, outputPath, limit, expansions = ['Media' /* TODO */] }) => {
  if (!Object.values(REPLICATION_STRATEGIES).includes(strategy)) {
    throw new Error(`Unknown strategy: '${strategy}'!`);
  }

  const resourceName = parseResourceNameFromODataRequestUri(requestUri),
    shouldSaveResults = !!outputPath,
    resultsPath = shouldSaveResults ? buildOutputFilePath(outputPath, resourceName) : null;

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
    } of replicationIterator({ requestUri, strategy, authInfo: { bearerToken } })) {
      if (hasError) {
        const { statusCode, message, errorType, error: errorData } = error;
        if (errorType === 'http') {
          console.error(`HTTP request error! Status code: ${statusCode}, message: '${message}'`);
        } else {
          let errorString = null;
          try {
            errorString = JSON.stringify(JSON.parse(errorData));
          } catch (err) {
            errorString = err?.toString ? err.toString() : '<unknown>';
          }
          throw new Error(`${errorType} error occurred! Error: ${errorString}`);
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
      `Total requests: ${responseTimes?.length || 0}, Average response time: ${humanizeDuration(
        parseInt(
          responseTimes?.reduce((acc, item) => {
            if (item) {
              acc += item;
            }
            return acc;
          }, 0) / (responseTimes.length || 1)
        )
      )}, Total records: ${totalRecordCount}\n`
    );
  }
  return;
};

module.exports = {
  replicate
};
