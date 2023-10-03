'use strict';

const { replicationIterator, REPLICATION_STRATEGIES } = require('./replication-iterator');
const { scorePayload, writeDataAvailabilityReport, ERROR_TYPES } = require('./utils');
const { writeFile, mkdir } = require('fs/promises');
const humanizeDuration = require('humanize-duration');
const { parseResourceNameFromODataRequestUri, buildOutputFilePath } = require('./utils');
const { join } = require('path');

/**
 * Replicates data from the given OData request URL using the given strategy, credentials, and options
 *
 * @param {Object} args this function takes multiple parameters
 * @returns this function has no return value, but will produce side effects if outputPath is used (will write files)
 */
const replicate = async ({ url: initialRequestUri, strategy, bearerToken, outputPath, limit, expansions = ['Media' /* TODO */] }) => {
  if (!Object.values(REPLICATION_STRATEGIES).includes(strategy)) {
    throw new Error(`Unknown strategy: '${strategy}'!`);
  }

  const resourceName = parseResourceNameFromODataRequestUri(initialRequestUri),
    shouldSaveResults = !!outputPath,
    resultsPath = shouldSaveResults ? buildOutputFilePath(outputPath, resourceName) : null;

  const startTime = Date.now(),
    resourceAvailabilityMap = {};

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
      pagesFetched = 0,
      requestUri,
      responseBytes = 0
    } of replicationIterator({ initialRequestUri, strategy, authInfo: { bearerToken }, limit })) {

      // inner try in case we want to keep going on error
      // for example, we get an error and can't parse one payload or response, but want
      // to keep going until the error limit
      try {
        //handle errors
        if (hasError) {
          const { statusCode, message, errorType, error: errorData } = error;
          if (errorType === ERROR_TYPES.HTTP) {
            console.error(`HTTP request error! Status code: ${statusCode}, message: '${message}'`);
          } else {
            let errorString = null;
            try {
              errorString = JSON.stringify(JSON.parse(errorData));
            } catch (err) {
              errorString = err?.toString ? err.toString() : err.cause || '<unknown>';
            }
            throw new Error(`${errorType} error occurred! Error: ${errorString}`);
          }
        }

        //process results
        if (hasResults) {
          //TODO: call schema validator if flag is set

          scorePayload({
            requestUri,
            records: response.value,
            resourceAvailabilityMap, // mutated on each call
            resourceName,
            expansions,
            responseTimeMs,
            startTime,
            stopTime,
            responseBytes
          });

          if (shouldSaveResults) {
            await mkdir(resultsPath, { recursive: true });
            await writeFile(join(resultsPath, `page-${pagesFetched}.json`), JSON.stringify(response));
          }
        }

        if (!!limit && totalRecordsFetched >= limit) {
          break;
        }
  
      } catch (err) {
        //TODO: add logic to allow fast fail, in which case we'd return here
        console.error(err);
      }
    }
  } catch (err) {
    //TODO: add logic to allow fast fail, in which case we'd return here
    console.error(err);
  } finally {

    try {
      await writeDataAvailabilityReport({ version: '1.7', resourceAvailabilityMap });
    } catch (err) {
      console.error(`Could not write data availability report! ${err}`);
    }

    console.log(`\nRESO Replication Client completed in ${humanizeDuration(Date.now() - startTime, { round: false })}!`);

    const runtimeStats = createRuntimeAvailabilityStats(resourceAvailabilityMap);
    console.log(
      `Total requests: ${runtimeStats.totalRequests}, ` +
        `Average response time: ${humanizeDuration(runtimeStats.totalResponseTimeMs / (runtimeStats.totalRequests || 1))}, ` +
        `Records fetched: ${runtimeStats.totalRecordCount}${runtimeStats.expandedRecordCount
          ? `, Expanded records: ${runtimeStats.expandedRecordCount}` : ''}\n`
    );
  }
  return;
};

const createRuntimeAvailabilityStats = (resourceAvailabilityMap = {}) =>
  Object.entries(resourceAvailabilityMap).reduce(
    (acc, [, { isExpansion = false, responses = [], numRecordsFetched = 0 }]) => {
     
      if (isExpansion) {
        acc.expandedRecordCount += numRecordsFetched;
      } else {
        acc.totalRecordCount += numRecordsFetched;
      }
      
      responses.forEach(({ responseTimeMs = 0 }) => {
        if (!isExpansion) {
          acc.totalRequests++;
          acc.totalResponseTimeMs += responseTimeMs;
        }
        return acc;
      });
      return acc;
    },
    {
      totalRequests: 0,
      totalResponseTimeMs: 0,
      totalRecordCount: 0,
      expandedRecordCount: 0
    }
  );

module.exports = {
  replicate
};
