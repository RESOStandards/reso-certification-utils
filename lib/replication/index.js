'use strict';

const { readFile, writeFile, mkdir } = require('fs/promises');
const { join } = require('path');

const { REPLICATION_STRATEGIES, fetchTopLevelResourceCount } = require('./utils');
const { replicationIterator } = require('./replication-iterator');
const REPLICATION_STATE_SERVICE = require('./services/replication-state');

const authService = require('./services/auth/oauth2');

const {
  DEFAULT_DD_VERSION,
  handleError,
  scorePayload,
  writeDataAvailabilityReport,
  displayRuntimeInfo,
  prepareRequests,
  buildOutputFilePath,
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
  shouldGenerateReports = true,
  jsonSchemaValidation = false,
  fromCli = false
}) => {

  try {
    // error if unknown strategy is specified
    if (!Object.values(REPLICATION_STRATEGIES).includes(strategy)) {
      throw new Error(`Unknown strategy: '${strategy}'!`);
    }

    //initialize items
    REPLICATION_STATE_SERVICE.init();
    await authService.init({ bearerToken, clientCredentials });
    
    // expansions will be a comma-separated list if passed from the command line and array if called from a library
    // TODO: clean up
    const expansionsArray = Array.isArray(expansionArrayOrCommaSeparatedString)
      ? expansionArrayOrCommaSeparatedString
      : expansionArrayOrCommaSeparatedString?.split(',').map(x => x?.trim()) || [];

    const metadataReport =
      !pathToMetadataReportJson && !!metadataReportJson
        ? metadataReportJson
        : JSON.parse(await readFile(pathToMetadataReportJson, { encoding: 'utf8' }));

    REPLICATION_STATE_SERVICE.setMetadataMap(metadataReport);

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

    const startTime = new Date(),
      startTimeIsoTimestamp = startTime.toISOString(),
      shouldSaveResults = !!outputPath;

    // TODO - add support for multiple strategies

    // Each resource and expansion will have its separate set of requests
    for await (const request of requests) {
      const { requestUri: initialRequestUri, resourceName } = request;

      // each item queried has its own set of requests
      try {

        // get top-level resource count if needed
        if (!REPLICATION_STATE_SERVICE.checkIfTopLevelResourceCountExists(resourceName)) {
          REPLICATION_STATE_SERVICE.setTopLevelResourceCount(resourceName,
            await fetchTopLevelResourceCount({ resourceName, serviceRootUri, filter, authService }));
        }

        for await (const {
          hasResults = false,
          hasError = false,
          responseJson = {},
          totalRecordsFetched = 0,
          requestUri,
          ...otherIteratorInfo
        } of replicationIterator({
            initialRequestUri,
            strategy,
            limit,
            secondsDelayBetweenRequests,
            authService
          })) {
          try {
            //handle errors
            if (hasError) {
              const { error } = otherIteratorInfo;
              // some errors, like HTTP 429, might be able to be handled
              await handleError({ error, rateLimitedWaitTimeMinutes });
            }

            //process results
            if (hasResults) {
              
              if (jsonSchemaValidation) {
                console.log('TODO: call schema validator if flag is set');
              }

              if (shouldGenerateReports) {
                scorePayload({
                  ...request,
                  requestUri,
                  jsonData: responseJson,
                  hasError,
                  ...otherIteratorInfo,
                  replicationStateServiceInstance: REPLICATION_STATE_SERVICE
                });
              }

              if (shouldSaveResults) {
                REPLICATION_STATE_SERVICE.incrementResourcePageCount(resourceName);

                const resultsPath = buildOutputFilePath({ outputPath, isoTimestamp: startTimeIsoTimestamp, resourceName });
                await mkdir(resultsPath, { recursive: true });
                await writeFile(join(resultsPath, `page-${REPLICATION_STATE_SERVICE.getResourcePageCount(resourceName)}.json`), JSON.stringify(responseJson));
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
        }
      } catch (err) {
        //TODO: add logic to allow fast fail, in which case we'd return here
        console.error(err);
        return;
      }
    }

    if (shouldGenerateReports) {
      try {
        await writeDataAvailabilityReport({ version: DEFAULT_DD_VERSION, serviceRootUri, replicationStateService: REPLICATION_STATE_SERVICE });
      } catch (err) {
        console.error(`Could not write data availability report! ${err}`);
      }
    }

    if (fromCli) {
      displayRuntimeInfo({ version: DEFAULT_DD_VERSION, startTime, resourceAvailabilityMap: REPLICATION_STATE_SERVICE.getResourceAvailabilityMap() });
    }
  } catch (err) {
    console.log(err);
  }

  return;
};

module.exports = {
  replicate
};
