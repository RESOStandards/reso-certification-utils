'use strict';

const { replicationIterator, REPLICATION_STRATEGIES } = require('./replication-iterator');
const { writeFile, mkdir } = require('fs/promises');
const { join } = require('path');

const {
  DEFAULT_DD_VERSION,
  handleError,
  scorePayload,
  writeDataAvailabilityReport,
  displayRuntimeInfo,
  prepareRequests,
  buildOutputFilePath
} = require('./utils');

/**
 * Replicates data from the given OData request URL using the given strategy, credentials, and options
 *
 * @param {Object} args this function takes multiple parameters
 * @returns this function has no return value, but will produce side effects if outputPath is used (will write files)
 */
const replicate = async ({
  serviceRootUri,
  strategy,
  bearerToken,
  clientCredentials = {},
  outputPath,
  limit,
  resourceName,
  expansions,
  metadataReportJson = {},
  pathToMetadataReportJson = '',
  filter,
  top,
  orderby
}) => {
  if (!Object.values(REPLICATION_STRATEGIES).includes(strategy)) {
    throw new Error(`Unknown strategy: '${strategy}'!`);
  }

  // expansions will be a comma-separated list for now, if passed
  const expansionsArray = expansions?.split(',').map(x => x?.trim()) || [];

  const requests = await prepareRequests({
    serviceRootUri,
    metadataReportJson,
    pathToMetadataReportJson,
    resourceName,
    expansions: expansionsArray,
    filter,
    top,
    orderby
  });
  
  const startTime = Date.now(),
    shouldSaveResults = !!outputPath,
    resourceAvailabilityMap = {};

  for await (const request of requests) {
    const { requestUri: initialRequestUri } = request;

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
        responseBytes = 0
      } of replicationIterator({ initialRequestUri, strategy, authInfo: { bearerToken, clientCredentials }, limit })) {
        try {
          //handle errors
          if (hasError) {
            handleError(error);
          }

          //process results
          if (hasResults) {
            //TODO: call schema validator if flag is set

            scorePayload({
              ...request,
              records: response.value,
              resourceAvailabilityMap, // mutated on each call
              responseTimeMs,
              startTime,
              stopTime,
              responseBytes
            });

            if (shouldSaveResults) {
              const resultsPath = buildOutputFilePath(outputPath, request?.resourceName);
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
          return;
        }
      }
    } catch (err) {
      //TODO: add logic to allow fast fail, in which case we'd return here
      console.error(err);
      return;
    }
  }

  try {
    await writeDataAvailabilityReport({ version: DEFAULT_DD_VERSION, resourceAvailabilityMap });
  } catch (err) {
    console.error(`Could not write data availability report! ${err}`);
  }

  displayRuntimeInfo({ version: DEFAULT_DD_VERSION, startTime, resourceAvailabilityMap });

  return;
};

module.exports = {
  replicate
};
