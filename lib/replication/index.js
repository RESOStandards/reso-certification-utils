'use strict';

const { readFile, writeFile, mkdir } = require('fs/promises');
const { join } = require('path');

// custom includes
const { replicationIterator, REPLICATION_STRATEGIES } = require('./replication-iterator');
const { sleep, buildMetadataMap } = require('../../common');
const {
  DEFAULT_DD_VERSION,
  handleError,
  scorePayload,
  writeDataAvailabilityReport,
  displayRuntimeInfo,
  prepareRequests,
  buildOutputFilePath
} = require('./utils');

const DEFAULT_RATE_LIMITED_WAIT_MINUTES = 60,
  DEFAULT_SECONDS_DELAY_BETWEEN_REQUEST = 1;

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
  expansions: expansionArrayOrCommaSeparatedString,
  metadataReportJson = {},
  pathToMetadataReportJson = '',
  filter,
  top,
  orderby,
  rateLimitedWaitTimeMinutes = DEFAULT_RATE_LIMITED_WAIT_MINUTES,
  secondsDelayBetweenRequests = DEFAULT_SECONDS_DELAY_BETWEEN_REQUEST,
  shouldGenerateReports = true
}) => {
  try {
    // error if unknown strategy is specified
    if (!Object.values(REPLICATION_STRATEGIES).includes(strategy)) {
      throw new Error(`Unknown strategy: '${strategy}'!`);
    }

    // tracks how many pages were fetched per resource
    const resourcePageCounts = {};

    // expansions will be a comma-separated list if passed from the command line and array if called from a library
    // TODO: clean up
    const expansionsArray = Array.isArray(expansionArrayOrCommaSeparatedString)
      ? expansionArrayOrCommaSeparatedString
      : expansionArrayOrCommaSeparatedString?.split(',').map(x => x?.trim()) || [];

    const metadataReport =
      !pathToMetadataReportJson && !!metadataReportJson
        ? metadataReportJson
        : JSON.parse(await readFile(pathToMetadataReportJson, { encoding: 'utf8' }));

    // TODO: if scoring, need to group by similar resources/expansions
    // so we only hold one set of record hashes in memory at a time
    const requests = await prepareRequests({
      serviceRootUri,
      metadataReportJson: metadataReport,
      resourceName,
      expansions: expansionsArray,
      filter,
      top,
      orderby
    });

    const { metadataMap } = buildMetadataMap(metadataReport);

    const startTime = new Date(),
      startTimeIsoTimestamp = startTime.toISOString(),
      shouldSaveResults = !!outputPath;

    // mutated on each call
    const STATE_VARIABLES = {
      resourceAvailabilityMap: {},
      // used to detect whether we've pulled the same record using different strategies
      recordHashCountMap: {},
      responses: []
    };

    // Each resource and expansion will have its separate set of requests
    for await (const request of requests) {
      const { requestUri: initialRequestUri, resourceName } = request;

      // each item queried has its own set of requests
      try {
        for await (const {
          hasResults = false,
          hasError = false,
          responseJson = {},
          totalRecordsFetched = 0,
          requestUri,
          ...otherIteratorInfo
        } of replicationIterator({ initialRequestUri, strategy, authInfo: { bearerToken, clientCredentials }, limit })) {
          try {
            //handle errors
            if (hasError) {
              const { error } = otherIteratorInfo;
              // some errors, like HTTP 429, might be able to be handled
              await handleError({ error, rateLimitedWaitTimeMinutes });
            }

            //process results
            if (hasResults) {
              //TODO: call schema validator if flag is set

              if (shouldGenerateReports) {
                scorePayload({
                  ...request,
                  requestUri,
                  jsonData: responseJson,
                  hasError,
                  metadataMap,
                  ...otherIteratorInfo,
                  ...STATE_VARIABLES
                });
              }

              if (shouldSaveResults) {
                if (!resourcePageCounts?.[resourceName]) {
                  resourcePageCounts[resourceName] = 0;
                }

                //update page counts
                const pagesFetched = ++resourcePageCounts[resourceName];

                const resultsPath = buildOutputFilePath({ outputPath, isoTimestamp: startTimeIsoTimestamp, resourceName });
                await mkdir(resultsPath, { recursive: true });
                await writeFile(join(resultsPath, `page-${pagesFetched}.json`), JSON.stringify(responseJson));
              }
            }

            if (!!limit && totalRecordsFetched >= limit) {
              console.log(`Reached specified record limit of ${limit}\n`);
              break;
            }
          } catch (err) {
            //TODO: add logic to allow fast fail, in which case we'd return here
            console.error(err);
            return;
          }

          // throttle requests if requested
          if (secondsDelayBetweenRequests) {
            await sleep(secondsDelayBetweenRequests * 1000);
          }
        }
      } catch (err) {
        //TODO: add logic to allow fast fail, in which case we'd return here
        console.error(err);
        return;
      }
    }

    if (shouldGenerateReports) {
      try {
        await writeDataAvailabilityReport({ version: DEFAULT_DD_VERSION, ...STATE_VARIABLES });
      } catch (err) {
        console.error(`Could not write data availability report! ${err}`);
      }
    }

    displayRuntimeInfo({ version: DEFAULT_DD_VERSION, startTime, ...STATE_VARIABLES });
  } catch (err) {
    console.log(err);
  }

  return;
};

module.exports = {
  replicate
};
