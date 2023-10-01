'use strict';

const queryString = require('node:querystring');
const { processHttpErrorResponse } = require('./utils');
const humanizeDuration = require('humanize-duration');

const MAX_RECORD_COUNT_DEFAULT = 100000,
  DEFAULT_PAGE_SIZE = 100,
  ODATA_VALUE_PROPERTY_NAME = 'value',
  ODATA_NEXT_LINK_PROPERTY_NAME = '@odata.nextLink';
  
// See: https://docs.oasis-open.org/odata/odata/v4.01/odata-v4.01-part1-protocol.html#sec_HeaderPrefer
// The value of the Prefer header is a comma-separated list of preferences.
const ODATA_PREFER_HEADER_NAME = 'Prefer', ODATA_MAX_PAGE_SIZE_HEADER_NAME = 'odata.maxpagesize';

// See: https://docs.oasis-open.org/odata/odata/v4.01/odata-v4.01-part1-protocol.html#_Toc31358888
// The value of the Preference-Applied header is a comma-separated list of preferences applied in the response. 
const ODATA_PREFERENCE_APPLIED_HEADER_NAME = 'Preference-Applied';

const REPLICATION_STRATEGIES = Object.freeze({
  TOP_AND_SKIP: 'TopAndSkip',
  TIMESTAMP_ASC: 'TimestampAsc',
  TIMESTAMP_DESC: 'TimestampDesc',
  NEXT_LINK: 'NextLink'
});

const getBearerTokenAuthHeader = (token = '') => (token?.length ? { Authorization: `Bearer ${token}` } : {});

const buildRequestUri = ({ requestUri, strategy, totalRecordsFetched = 0, pageSize, lastIsoTimestamp, nextLink }) => {
  const [baseUri = null, query = null] = requestUri.split('?');

  const queryParams = query !== null ? queryString.parse(query) : {};

  if (strategy === REPLICATION_STRATEGIES.TOP_AND_SKIP) {
    const { $top = pageSize ?? DEFAULT_PAGE_SIZE, ...remainingParams } = queryParams;

    //$skip param from queryParams is always ignored
    delete remainingParams.$skip;
    const remainingQueryString = queryString.stringify(remainingParams) ?? '';

    return `${baseUri}?$top=${$top}&$skip=${totalRecordsFetched}${remainingQueryString?.length ? `&${remainingQueryString}` : ''}`;
  } else if (strategy === REPLICATION_STRATEGIES.TIMESTAMP_ASC) {
    throw new Error(`Unsupported replication strategy '${strategy}'!`);
  } else if (strategy === REPLICATION_STRATEGIES.TIMESTAMP_DESC) {
    throw new Error(`Unsupported replication strategy '${strategy}'!`);
  } else if (strategy === REPLICATION_STRATEGIES.NEXT_LINK) {
    return nextLink ? nextLink : requestUri;
  } else {
    throw new Error(`Unsupported replication strategy '${strategy}'!`);
  }
};

async function* replicationIterator(config = {}) {
  const { requestUri: initialRequestUri = '', maxErrorCount = 3, authInfo = {}, strategy } = config;

  const { bearerToken, clientCredentials } = authInfo;

  let
    pageSize = DEFAULT_PAGE_SIZE,
    pagesFetched = 0,
    numErrors = 0,
    totalRecordsFetched = 0;
    
  //GET https://api.reso.org/Property
  let requestUri = initialRequestUri,
    lastRequestUri = null,
    lastIsoTimestamp = null,
    nextLink = null;

  // TODO: handle client credentials auth
  const headers = {
    ...getBearerTokenAuthHeader(bearerToken)
  };

  if (strategy === REPLICATION_STRATEGIES.NEXT_LINK) {
    headers[ODATA_PREFER_HEADER_NAME] = `${ODATA_MAX_PAGE_SIZE_HEADER_NAME}=${pageSize}`;
  }

  console.log(`Initial request uri: ${requestUri}\n`);

  do {
    let responseJson = null,
      responseStatus = 0,
      error = null;

    requestUri = buildRequestUri({
      requestUri,
      strategy,
      totalRecordsFetched,
      pageSize,
      lastIsoTimestamp,
      nextLink
    });

    if (requestUri === lastRequestUri) {
      //same request shouldn't be made twice
      console.log('No more requests. Exiting...');
      return;
    }

    let responseTimeMs = 0,
      startTime, stopTime;

    try {

      //request records
      console.log(`Fetching records from '${requestUri}'...`);

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
      responseJson = await response.json();

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
        stopTime = new Date().toISOString;
        error = {
          errorType: 'http',
          ...processHttpErrorResponse(response)
        };
        numErrors++;
      }
    } catch (err) {
      console.error(err);
      numErrors++;
      error = {
        errorType: 'general',
        ...err
      };
    }

    yield {
      requestUri,
      responseStatus,
      responseTimeMs,
      startTime,
      stopTime,
      response: responseJson,
      hasResults: pageSize > 0,
      pageSize,
      totalRecordsFetched,
      pagesFetched,
      numErrors,
      error,
      hasError: !!error
    };
  } while (pageSize > 0 && totalRecordsFetched < MAX_RECORD_COUNT_DEFAULT && numErrors < maxErrorCount);
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
