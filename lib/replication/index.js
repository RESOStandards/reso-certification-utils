'use strict';

const { replicationIterator, REPLICATION_STRATEGIES } = require('./replication-iterator');
const { DEFAULT_DD_VERSION, NOT_OK, handleError, scorePayload, writeDataAvailabilityReport, displayRuntimeInfo } = require('./utils');
const { writeFile, mkdir } = require('fs/promises');
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
      try {
        //handle errors
        if (hasError) {
          handleError(error);
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
        return NOT_OK;
      }
    }
  } catch (err) {
    //TODO: add logic to allow fast fail, in which case we'd return here
    console.error(err);
    return NOT_OK;
  } finally {
    
    try {
      await writeDataAvailabilityReport({ version: DEFAULT_DD_VERSION, resourceAvailabilityMap });
    } catch (err) {
      console.error(`Could not write data availability report! ${err}`);
    }

    displayRuntimeInfo({ version: DEFAULT_DD_VERSION, startTime, resourceAvailabilityMap });
  }
  return;
};

module.exports = {
  replicate
};
