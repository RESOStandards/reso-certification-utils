'use strict';

const queryString = require('node:querystring');

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

const buildRequestUri = ({ requestUri, strategy, recordsFetched = 0, pageSize, lastIsoTimestamp, nextLink }) => {
  const [baseUri = null, query = null] = requestUri.split('?');

  const queryParams = query !== null ? queryString.parse(query) : {};

  if (strategy === REPLICATION_STRATEGIES.TOP_AND_SKIP) {
    const { $top = pageSize ?? DEFAULT_PAGE_SIZE, ...remainingParams } = queryParams;

    //$skip param from queryParams is always ignored
    delete remainingParams.$skip;
    const remainingQueryString = queryString.stringify(remainingParams) ?? '';

    return `${baseUri}?$top=${top}&$skip=${recordsFetched}${remainingQueryString?.length ? `&${remainingQueryString}` : ''}`;
  } else if (strategy === REPLICATION_STRATEGIES.TIMESTAMP_ASC) {
    throw new Error(`Unsupported replication strategy '${strategy}'!`);
  } else if (strategy === REPLICATION_STRATEGIES.TIMESTAMP_DESC) {
    throw new Error(`Unsupported replication strategy '${strategy}'!`);
  } else if (strategy === REPLICATION_STRATEGIES.NEXT_LINK) {
    return !!nextLink ? nextLink : requestUri;
  } else {
    throw new Error(`Unsupported replication strategy '${strategy}'!`);
  }
};

async function* replicationIterator(config = {}) {
  const { requestUri: initialRequestUri = '', maxErrorCount = 3, authInfo = {}, strategy } = config;

  const { bearerToken, clientCredentials } = authInfo;

  let successfulRequestCount = 0,
    errorRequestCount = 0,
    recordsFetched = 0,
    pageSize = DEFAULT_PAGE_SIZE;

  //GET https://api.reso.org/Property
  let requestUri = initialRequestUri,
    lastRequestUri = null,
    lastIsoTimestamp = null,
    nextLink = null;

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
      recordsFetched,
      pageSize,
      lastIsoTimestamp,
      nextLink
    });

    if (requestUri === lastRequestUri) {
      console.error(`Same URL found for consecutive requests: ${requestUri}\nExiting...`);
      return;
    }

    let responseTimeMs = 0,
      startTime;

    try {

      //request records
      console.log(`Fetching records from '${requestUri}'...`);
      startTime = Date.now();
      const response = await fetch(requestUri, { headers });
      responseTimeMs = Date.now() - startTime;

      //set state
      lastRequestUri = requestUri;
      responseStatus = response.status;
      responseJson = await response.json();

      //process records
      if (response.ok) {
        pageSize = responseJson[ODATA_VALUE_PROPERTY_NAME]?.length ?? 0;
        nextLink = responseJson[ODATA_NEXT_LINK_PROPERTY_NAME] ?? null;
        recordsFetched += pageSize;

        if (pageSize) {
          console.log(
            `Request succeeded! Time taken: ${responseTimeMs}ms. Records fetched: ${pageSize}. ` +
              `Total records fetched: ${recordsFetched}\n`
          );
        } else {
          console.log('No records to fetch!');
        }

        //if the response was OK, the request was successful even if no records
        successfulRequestCount++;
      } else {
        //TODO: when there's an unsuccessful request, sometimes the error message is in the response body
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
      hasResults: pageSize > 0,
      pageSize,
      recordsFetched,
      successfulRequestCount,
      errorRequestCount,
      error
    };
  } while (pageSize > 0 && recordsFetched < MAX_RECORD_COUNT_DEFAULT && errorRequestCount < maxErrorCount);
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
