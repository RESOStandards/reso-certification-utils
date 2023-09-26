'use strict';

const queryString = require('node:querystring');

const MAX_RECORD_COUNT_DEFAULT = 100000,
  DEFAULT_PAGE_SIZE = 1000,
  ODATA_VALUE_PROPERTY_NAME = 'value';

const REPLICATION_STRATEGIES = Object.freeze({
  TOP_AND_SKIP: 'TopAndSkip',
  TIMESTAMP_ASC: 'TimestampAsc',
  TIMESTAMP_DESC: 'TimestampDesc',
  NEXT_LINK: 'NextLink'
});

const getBearerTokenAuthHeader = (token = '') => (token?.length ? { Authorization: `Bearer ${token}` } : {});

const buildRequestUri = ({ requestUri, strategy, currentRecordCount = 0, lastPageCount, /* lastIsoTimestamp, nextLink */ }) => {
  const [baseUri = null, query = null] = requestUri.split('?');

  const queryParams = query !== null ? queryString.parse(query) : {};

  if (strategy === REPLICATION_STRATEGIES.TOP_AND_SKIP) {
    const { $top: top = lastPageCount ?? DEFAULT_PAGE_SIZE, ...remainingParams } = queryParams;

    //$skip param from queryParams is always ignored
    delete remainingParams.$skip;
    const remainingQueryString = queryString.stringify(remainingParams) ?? '';

    return `${baseUri}?$top=${top}&$skip=${currentRecordCount}${remainingQueryString?.length ? `&${remainingQueryString}` : ''}`;
  } else if (strategy === REPLICATION_STRATEGIES.TIMESTAMP_ASC) {
    throw new Error(`Unsupported replication strategy '${strategy}'!`);
  } else if (strategy === REPLICATION_STRATEGIES.TIMESTAMP_DESC) {
    throw new Error(`Unsupported replication strategy '${strategy}'!`);
  } else if (strategy === REPLICATION_STRATEGIES.NEXT_LINK) {
    throw new Error(`Unsupported replication strategy '${strategy}'!`);
  } else {
    throw new Error(`Unsupported replication strategy '${strategy}'!`);
  }
};

async function* replicationIterator(config = {}) {
  const {
    requestUri: initialRequestUri = '',
    maxErrorCount = 3,
    authInfo = {},
    strategyInfo = { strategy: 'TopAndSkip', pageSize: DEFAULT_PAGE_SIZE }
  } = config;

  const { bearerToken, /* clientCredentials */ } = authInfo;

  const headers = {
    ...getBearerTokenAuthHeader(bearerToken)
  };

  let successfulRequestCount = 0,
    errorRequestCount = 0,
    currentRecordCount = 0,
    lastPageCount = DEFAULT_PAGE_SIZE;

  //GET https://api.reso.org/Property
  let requestUri = initialRequestUri,
    lastRequestUri = null;

  console.log('Request uri is: ' + requestUri);

  do {
    let responseJson = null,
      responseStatus = 0,
      error = null;
      //lastIsoTimestamp = null,
      //nextLink = null;

    requestUri = buildRequestUri({
      requestUri,
      strategy: strategyInfo.strategy,
      currentRecordCount,
      lastPageCount,
      //lastIsoTimestamp,
      //nextLink
    });

    if (requestUri === lastRequestUri) {
      throw new Error(`Same URLs found for consecutive requests!\n\tRequestUri: ${requestUri}\n\tLastRequestUri: ${lastRequestUri}`);
    }

    let responseTimeMs = 0, startTime;
    try {
      console.log(`Fetching records from '${requestUri}'...`);
      startTime = Date.now();
      const response = await fetch(requestUri, { headers });
      responseTimeMs = Date.now() - startTime;
      
      lastRequestUri = requestUri;
      responseStatus = response.status;
      responseJson = await response.json();
      
      if (response.ok) {
        lastPageCount = responseJson[`${ODATA_VALUE_PROPERTY_NAME}`]?.length ?? 0;
        currentRecordCount += lastPageCount;

        if (lastPageCount) {
          console.log(
            `Request succeeded! Time taken: ${responseTimeMs} ms. Records fetched: ${lastPageCount}. ` +
              `Total records fetched: ${currentRecordCount}\n`
          );
        } else {
          console.log('No records to fetch!');
        }
        successfulRequestCount++;
      } else {
        console.error(`${JSON.stringify(responseJson)}\n`);
        errorRequestCount++;
        error = response?.statusText ?? null;
      }
    } catch (err) {
      console.error(`${JSON.stringify(err)}\n`);
      errorRequestCount++;
      error = err;
    }

    yield {
      requestUri,
      responseStatus,
      responseTimeMs,
      response: responseJson,
      hasResults: lastPageCount > 0,
      error,
      successfulRequestCount,
      errorRequestCount
    };
  } while (lastPageCount > 0 && currentRecordCount < MAX_RECORD_COUNT_DEFAULT && errorRequestCount < maxErrorCount);
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
