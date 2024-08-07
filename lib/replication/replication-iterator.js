'use strict';

const humanizeDuration = require('humanize-duration');
const {
  DEFAULT_PAGE_SIZE,
  DEFAULT_TIMESTAMP_FIELD,
  ERROR_TYPES,
  REPLICATION_STRATEGIES,
  processHttpErrorResponse,
  calculateJsonSize,
  computeLastIsoTimestamp,
  buildRequestUrlString
} = require('./utils');

const { sleep } = require('../../common');

const ODATA_VALUE_PROPERTY_NAME = 'value',
  ODATA_NEXT_LINK_PROPERTY_NAME = '@odata.nextLink';

// See: https://docs.oasis-open.org/odata/odata/v4.01/odata-v4.01-part1-protocol.html#sec_HeaderPrefer
// The value of the Prefer header is a comma-separated list of preferences.
const ODATA_PREFER_HEADER_NAME = 'Prefer',
  ODATA_MAX_PAGE_SIZE_HEADER_NAME = 'odata.maxpagesize',
  ODATA_MAX_PAGE_SIZE_DEFAULT = 1000;

// See: https://docs.oasis-open.org/odata/odata/v4.01/odata-v4.01-part1-protocol.html#_Toc31358888
// The value of the Preference-Applied header is a comma-separated list of preferences applied in the response.
// const ODATA_PREFERENCE_APPLIED_HEADER_NAME = 'Preference-Applied';

/**
 * Replication iterator which maintains some internal state during runtime.
 *
 * Will keep iterating until there are no more records or the max number of errors has been reached.
 *
 * It's the client's responsibility to determine when to stop iterating
 *
 * @param {Object} config configuration for the replication iterator
 * @returns yields with a number of parameters relevant to replication
 */
async function* replicationIterator({
  initialRequestUri = '',
  maxErrorCount = 3,
  strategy,
  secondsDelayBetweenRequests,
  authService,
  timestampFieldName = DEFAULT_TIMESTAMP_FIELD,
  maxPageSize
} = {}) {

  let pageSize = DEFAULT_PAGE_SIZE,
    pagesFetched = 0,
    numErrors = 0,
    totalRecordsFetched = 0,
    headers = {};

  const REQUEST_DELAY_MS = secondsDelayBetweenRequests * 1000 ?? 0,
    useDelay = (!!secondsDelayBetweenRequests && parseFloat(secondsDelayBetweenRequests) > 0) ?? false;

  //GET https://api.reso.org/Property
  let requestUri = initialRequestUri,
    lastRequestUri = null,
    lastIsoTimestamp = null,
    nextLink = null;

  if (strategy === REPLICATION_STRATEGIES.NEXT_LINK) {
    headers[ODATA_PREFER_HEADER_NAME] = `${ODATA_MAX_PAGE_SIZE_HEADER_NAME}=${maxPageSize ?? ODATA_MAX_PAGE_SIZE_DEFAULT}`;
  }

  // wait once if specified
  if (useDelay) await sleep(REQUEST_DELAY_MS);

  do {
    let responseJson = null,
      responseBytes = 0,
      responseStatus = 0,
      error = null;

    requestUri = buildRequestUrlString({
      requestUri,
      strategy,
      totalRecordsFetched,
      pageSize,
      lastIsoTimestamp,
      nextLink
    });

    //same request shouldn't be made twice
    if (requestUri === lastRequestUri) {
      return;
    }

    headers = {
      ...headers,
      ...(await authService.getOAuth2BearerTokenHeader())
    };

    let responseTimeMs = 0,
      startTime,
      stopTime;

    try {
      //request records
      console.log(`\nFetching records from: ${requestUri}`);

      const startTimeMs = new Date();
      const response = await fetch(requestUri, { headers });
      const stopTimeMs = new Date();

      startTime = startTimeMs.toISOString();
      stopTime = stopTimeMs.toISOString();

      //TODO: legacy property - deprecate
      responseTimeMs = stopTimeMs - startTimeMs;

      //set state
      lastRequestUri = requestUri;
      responseStatus = response.status;

      try {
        responseJson = await response.json();

        if ([REPLICATION_STRATEGIES.TIMESTAMP_ASC, REPLICATION_STRATEGIES.TIMESTAMP_DESC].includes(strategy)) {
          lastIsoTimestamp = computeLastIsoTimestamp({ jsonData: responseJson, lastIsoTimestamp, strategy, timestampFieldName });
        }
      } catch {
        // if we can't extract JSON then empty response
        responseJson = {};
      }

      responseBytes = calculateJsonSize(responseJson);

      //process records
      if (response.ok) {
        pageSize = responseJson[ODATA_VALUE_PROPERTY_NAME]?.length ?? 0;
        nextLink = responseJson[ODATA_NEXT_LINK_PROPERTY_NAME] ?? null;
        totalRecordsFetched += pageSize;

        if (pageSize) {
          console.log(
            `Request succeeded! Time taken: ${humanizeDuration(responseTimeMs)}. Records fetched: ${pageSize}. ` +
              `Total records fetched: ${totalRecordsFetched}\n`
          );
        } else {
          console.log('No records to fetch!');
        }
        pagesFetched++;
      } else {
        stopTime = new Date().toISOString();
        error = {
          errorType: ERROR_TYPES.HTTP,
          ...processHttpErrorResponse(response)
        };
        numErrors++;
      }
    } catch (err) {
      console.error(err);
      numErrors++;
      error = {
        errorType: ERROR_TYPES.GENERAL,
        ...err
      };
    }

    yield {
      requestUri,
      responseStatus,
      responseTimeMs,
      startTime,
      stopTime,
      responseJson,
      hasResults: pageSize > 0,
      pageSize,
      totalRecordsFetched,
      pagesFetched,
      numErrors,
      error,
      hasError: !!error,
      responseBytes
    };

    // throttle requests if requested
    if (useDelay) await sleep(REQUEST_DELAY_MS);
  } while (pageSize > 0 && numErrors <= maxErrorCount);
}

/**
 * Replication Iterator service provides an interface
 * for requesting data from servers using a number of strategies:
 *  * OData Next Link
 *  * OData Top and Skip
 *  * OData Order By Timestamp (Asc/Desc)
 */

module.exports = {
  REPLICATION_STRATEGIES,
  replicationIterator
};
