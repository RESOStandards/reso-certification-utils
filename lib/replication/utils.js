'use strict';

const { readFile, writeFile } = require('fs/promises');
const { join } = require('path');
const humanizeDuration = require('humanize-duration');
const { sleep } = require('../../common');

const REPLICATION_DIRECTORY_NAME = 'reso-replication-output',
  AVAILABILITY_REPORT_FILENAME = 'data-availability-report.json';

const ERROR_TYPES = {
  HTTP: 'http',
  GENERAL: 'general'
};

const ERROR_CODES = {
  HTTP: {
    RATE_LIMITED: 429
  }
};

const UNKNOWN_ERROR_STRING = '<unknown>';

const NOT_OK = 1;

const DEFAULT_DD_VERSION = '1.7',
  POSTAL_CODE_FIELD_NAME = 'PostalCode';

/**
 * Scores a payload with the given data
 * @param {Object} data options to be extracted from the caller
 *
 * Note that this function mutates the resourceAvailabilityMap, which
 * the caller would pass in and have declared in the calling function
 */
const scorePayload = ({
  requestUri = '',
  records = [],
  // TODO: consider not mutating
  resourceAvailabilityMap = {},
  resourceName,
  responseTimeMs,
  responseBytes = 0,
  dateField = 'ModificationTimestamp',
  pagesFetched,
  ...otherParams
}) => {

  if (!Array.isArray(records)) {
    return;
  }

  const { expandedTypeInfo = [] } = otherParams;

  const isExpansion = !!((expandedTypeInfo && expandedTypeInfo?.length) || undefined),
    [{ fieldName: expandedFieldName, modelName: expandedResourceName } = {}] = expandedTypeInfo || [];

  if (!resourceAvailabilityMap?.[resourceName]) {
    resourceAvailabilityMap[resourceName] = {
      resourceName,
      numRecordsFetched: 0,
      recordCount: 0,
      pageSize: records?.length ?? 0,
      // TODO: allow passing the date field name
      dateField,
      dateHigh: null,
      dateLow: null,
      // field availability map is fieldName and frequency
      fieldAvailabilityMap: {},
      pagesFetched,
      expansionAvailabilityMap: {},
      expandedTypeInfo,
      isExpansion
    };
  }

  // init
  if (isExpansion) {
    // TODO: refactor - init parent item if it doesn't exist
    // this is possible depending on whether we're starting with a query which is an expansion or not

    resourceAvailabilityMap[resourceName].expansionAvailabilityMap[expandedResourceName] = {
      parentResourceName: resourceName,
      resourceName: expandedResourceName,
      numRecordsFetched: 0,
      recordCount: 0,
      pageSize: records?.length ?? 0,
      // TODO: allow passing the date field name
      dateField,
      dateHigh: null,
      dateLow: null,
      // field availability map is fieldName and frequency
      fieldAvailabilityMap: {},
      pagesFetched,
      expansionAvailabilityMap: {},
      expandedTypeInfo,
      isExpansion
    };
  }

  // availability map schema is the same, regardless if expansions or resource
  let availabilityMap = {};
  if (isExpansion) {
    availabilityMap = resourceAvailabilityMap[resourceName].expansionAvailabilityMap[expandedResourceName];
  } else {
    availabilityMap = resourceAvailabilityMap[resourceName];
  }

  // update legacy property for current reports
  availabilityMap.numRecordsFetched += records?.length || 0;
  availabilityMap.pagesFetched = pagesFetched;

  //init if not present
  if (!availabilityMap?.responses) {
    availabilityMap.responses = [];
  }

  availabilityMap.responses.push({
    requestUri,
    responseTimeMs,
    responseBytes
  });

  records.forEach(record => {
    Object.entries(record).forEach(([fieldName, value]) => {
      // init if the field if it doesn't exist
      if (!availabilityMap?.fieldAvailabilityMap?.[fieldName]) {
        availabilityMap.fieldAvailabilityMap[fieldName] = {
          resourceName: isExpansion ? expandedResourceName : resourceName,
          fieldName,
          frequency: 0
        };
      }

      // if there's a value, it can either be a primitive, or array/object
      const { isPrimitive, isArray } = isObjectOrArrayOrPrimitive(value);

      // functions aren't allowed here, so this covers everything
      if (!!value && (isPrimitive || Object.values(value)?.length)) {
        // increment usage
        availabilityMap.fieldAvailabilityMap[fieldName].frequency++;

        processSpecialFields({ availabilityMap, fieldName, dateField, value });

        // TODO: Enumerations

        // process expansions, if present
        if (isExpansion && fieldName === expandedFieldName) {
          // TODO: look up the resource name for the expanded field and determine whether it's a collection or not
          // for now, just use Media

          scorePayload({
            requestUri,
            records: isArray ? value : [value],
            resourceAvailabilityMap,
            resourceName,
            isCollection: isArray,
            responseBytes: calculateJsonSize(value),
            ...otherParams
          });
        }
      }
    });
  });
};

/**
 * Updates various properties in the given availabilityMap depending on whether
 * the current field is something that needs to be processed
 *
 * @param {Object} args an object containing the availabilityMap to update, as well as other related params
 *
 */
const processSpecialFields = ({ availabilityMap, fieldName, dateField, value } = {}) => {
  if (!value) return;

  // Update resource max and min dates
  if (fieldName === dateField) {
    const dateValue = new Date(value),
      currentDateLowValue = availabilityMap?.dateLow ? new Date(availabilityMap.dateLow) : null,
      currentDateHighValue = availabilityMap?.dateHigh ? new Date(availabilityMap.dateHigh) : null;

    if (dateValue) {
      if (currentDateLowValue) {
        availabilityMap.dateLow = new Date(Math.min(currentDateLowValue, dateValue)).toISOString();
      } else {
        availabilityMap.dateLow = dateValue.toISOString();
      }

      if (currentDateHighValue) {
        availabilityMap.dateHigh = new Date(Math.max(currentDateHighValue, dateValue)).toISOString();
      } else {
        availabilityMap.dateHigh = dateValue.toISOString();
      }
    }
  }

  if (fieldName === POSTAL_CODE_FIELD_NAME) {
    if (!availabilityMap?.postalCodes) {
      availabilityMap.postalCodes = new Set();
    }
    availabilityMap.postalCodes.add(value);
  }
};

/**
 * Determines whether the given value is an object, array, or primitive
 * @param {Object} value to test
 * @returns object with misc. properties set
 */
const isObjectOrArrayOrPrimitive = value => {
  const isObject = typeof value === 'object',
    isArray = Array.isArray(value),
    isPrimitive = value === null || (!isObject && !isArray);

  return {
    isObject,
    isArray,
    isPrimitive
  };
};

/**
 * Processes data, keyed by resources, fields, and enumerations, into its
 * first round of aggregation
 *
 *       Current Resource Aggregation
 *
 *       {
 *         "resourceName": "Office",
 *         "recordCount": 1751,
 *         "numRecordsFetched": 1709,
 *         "numSamples": 18,
 *         "pageSize": 100,
 *         "averageResponseBytes": 106953,
 *         "averageResponseTimeMillis": 547,
 *         "dateField": "ModificationTimestamp",
 *         "dateLow": "2019-08-14T13:59:06Z",
 *         "dateHigh": "2023-08-28T13:46:24Z",
 *         "keyFields": [
 *           "OfficeKey"
 *         ]
 *       }, ...
 *
 * @param {Map} resourceAvailabilityMap map containing availability data
 * @returns consolidated availability data set in canonical resources, fields, lookups format
 */
const consolidateResults = (resourceAvailabilityMap = {}) =>
  Object.values(resourceAvailabilityMap ?? {}).reduce(
    (
      acc,
      {
        fieldAvailabilityMap = {},
        expansionAvailabilityMap = {},
        numRecordsFetched = 0,
        /* expandedTypeInfo = [],*/ ...remainingResourceData
      }
    ) => {
      if (remainingResourceData && Object.values(remainingResourceData)?.length) {
        // need to compute the following stats from the resources requests array to support older reports
        // recordCount, averageResponseBytes, averageResponseTimeMillis, dateLow, dateHigh
        const {
          responseBytesValues = [],
          responseTimeValues = [],
          totalRecordCount = 0
        } = (remainingResourceData?.responses || []).reduce(
          (acc, { responseBytes = 0, responseTimeMs = 0, recordCount = 0 }) => {
            acc.totalResponseBytes += responseBytes;
            acc.totalResponseTimeMs += responseTimeMs;
            acc.totalRecordCount += recordCount;
            acc.responseBytesValues.push(responseBytes);
            acc.responseTimeValues.push(responseTimeMs);
            return acc;
          },
          {
            totalRecordCount: 0,
            responseBytesValues: [],
            responseTimeValues: []
          }
        );

        const resourceStats = {
          numRecordsFetched,
          medianBytes: calculateMedian(responseBytesValues) ?? 0,
          stdDevBytes: calculateStdDev(responseBytesValues) ?? 0,
          medianResponseTimeMs: calculateMedian(responseTimeValues) ?? 0,
          stdDevResponseTimeMs: calculateStdDev(responseTimeValues) ?? 0,
          averageResponseBytes: calculateMean(responseBytesValues) ?? 0,
          averageResponseTimeMillis: calculateMean(responseTimeValues) ?? 0
        };

        const {
          isExpansion = false,
          responses = [],
          /* recordCount = 0,*/
          postalCodes: postalCodesSet = new Set(),
          ...rest
        } = remainingResourceData;

        const postalCodes = postalCodesSet?.size ? Array.from(postalCodesSet) : undefined;

        let expandedResources, expandedFields;
        if (expansionAvailabilityMap && Object.values(expansionAvailabilityMap)?.length) {
          ({ resources: expandedResources = [], fields: expandedFields = [] } = consolidateResults(expansionAvailabilityMap));
          acc.expansions.push(...expandedResources);
          acc.fields.push(...expandedFields);
        }

        acc.resources.push({
          ...rest,
          ...resourceStats,
          responses,
          recordCount: totalRecordCount,
          postalCodes
        });

        if (isExpansion) {
          Object.values(resourceAvailabilityMap || {}).forEach(availabilityMap => {
            const { parentResourceName, fieldAvailabilityMap: expandedAvailabilityMap } = availabilityMap;

            //need to push expandedAvailabilityMap.values into fields along with the parent resource for each one
            if (expandedAvailabilityMap && Object.values(expandedAvailabilityMap)?.length) {
              acc.fields.push(
                ...Object.values(expandedAvailabilityMap).map(expandedField => {
                  return {
                    ...expandedField,
                    parentResourceName
                  };
                })
              );
            }
          });
        } else {
          acc.fields.push(...Object.values(fieldAvailabilityMap));
        }
      }

      return acc;
    },
    {
      resources: [],
      expansions: [],
      fields: [],
      lookups: []
    }
  );

/**
 * Creates a pleasing report when running on the command line
 * @param {Object} resourceAvailabilityMap availability stats collected during run
 * @returns high-level stats for reporting
 */
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

/**
 * Writes a data-availability-report.json file for the given version and availability data
 *
 * @param {Object} params
 */
const writeDataAvailabilityReport = async ({ version, resourceAvailabilityMap = {} }) => {
  try {
    await writeFile(
      AVAILABILITY_REPORT_FILENAME,
      JSON.stringify(
        {
          description: 'RESO Data Availability Report',
          version,
          generatedOn: new Date().toISOString(),
          ...consolidateResults(resourceAvailabilityMap)
        },
        null,
        '  '
      )
    );

    console.log(`Results written to ${AVAILABILITY_REPORT_FILENAME}`);
  } catch (err) {
    console.error(err);
  }
};

/**
 * Displays info on the console when a job is run
 * @param {Object} resourceAvailabilityMap map from availability testing run
 */
const displayRuntimeInfo = ({ startTime, version, resourceAvailabilityMap = {} }) => {
  console.log(
    `\nRESO Replication Client completed in ${humanizeDuration(Date.now() - startTime, { round: false })}! DD Version: ${version}`
  );
  const runtimeStats = createRuntimeAvailabilityStats(resourceAvailabilityMap);
  console.log(
    `Total requests: ${runtimeStats.totalRequests}, ` +
      `Average response time: ${humanizeDuration(runtimeStats.totalResponseTimeMs / (runtimeStats.totalRequests || 1))}, ` +
      `Records fetched: ${runtimeStats.totalRecordCount}${
        runtimeStats.expandedRecordCount ? `, Expanded records: ${runtimeStats.expandedRecordCount}` : ''
      }\n`
  );
};

/**
 * Processes an HTTP error response from the Fetch API
 * @param {Response} response the HTTP error response from the Fetch API
 * @returns relevant error data
 */
const processHttpErrorResponse = ({ status, statusText }) => {
  return {
    statusCode: status,
    message: statusText
  };
};

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
    // This always works, because if the property is an expansion rather
    // than a top level resource, like a navigation property: e.g. /Property/Media or /Property('123')/Media
    // then the resource name is Media
    const [resourceName = null] = new URL(requestUri).pathname.split('/').slice(-1);
    return resourceName;
  } catch (err) {
    console.error(err);
    return null;
  }
};

/**
 * Calculates the size of the given JSON Data
 * @param {Object} jsonData JSON data
 * @returns size of given JSON Data or 0 if it couldn't be processed
 */
const calculateJsonSize = jsonData => {
  try {
    return Buffer.byteLength(JSON.stringify(jsonData));
  } catch (err) {
    console.error('Could not calculate size of JSON Data');
    return 0;
  }
};

/**
 * Builds a path to use when saving results
 *
 * @param {String} outputPath the target directory in which to save results (current by default)
 * @param {String} resourceName the name of the Data Dictionary resource whose files are being saved
 * @returns an operating system dependent path to save replication data with
 */
const buildOutputFilePath = (outputPath, resourceName) => {
  if (!outputPath) {
    throw new Error('Missing outputPath!');
  }

  if (!resourceName) {
    throw new Error('Missing resourceName!');
  }

  return join(outputPath, REPLICATION_DIRECTORY_NAME, resourceName, new Date().toISOString().replaceAll(':', '-'));
};

/**
 * Calculates the mean for an array of numbers
 * @param {Array} numbers array of numbers
 * @returns the mean value
 */
const calculateMean = (numbers = []) => {
  if (!Array.isArray(numbers) || !numbers?.length) {
    return 0;
  }
  const n = numbers.length;
  return numbers.reduce((a, b) => a + b) / n;
};

/**
 * Calculates the standard deviation for an array of numbers
 * @param {Array} numbers array of numbers
 * @returns the standard deviation
 */
const calculateStdDev = (numbers = []) => {
  if (!Array.isArray(numbers) || !numbers?.length) {
    return 0;
  }

  const n = numbers.length,
    mean = calculateMean(numbers);

  return Math.sqrt(numbers.map(x => Math.pow(x - mean, 2)).reduce((a, b) => a + b) / n);
};

/**
 * Calculates median of an array of numbers
 * @param {Array} numbers array of numbers
 * @returns median value
 */
const calculateMedian = (numbers = []) => {
  if (!Array.isArray(numbers) || !numbers?.length) {
    return 0;
  }

  const sorted = Array.from(numbers).sort((a, b) => a - b),
    middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }

  return sorted[middle];
};

/**
 * Handles error objects
 * @param {Object} error the error to process
 */
const handleError = async ({ error = {}, rateLimitedWaitTimeMinutes = 60 }) => {
  const { statusCode, message, errorType, error: errorData } = error;

  const getErrorMessage = (errorType, errorString) => `${errorType} error occurred! Error: ${errorString || UNKNOWN_ERROR_STRING}`;

  if (errorType === ERROR_TYPES.HTTP) {
    // some HTTP errors can potentially be handled
    console.error(`HTTP request error! Status code: ${statusCode}, message: '${message}'`);

    if (parseInt(statusCode) === ERROR_CODES.HTTP.RATE_LIMITED) {
      console.warn(`  -> ${new Date().toISOString()} - Waiting ${rateLimitedWaitTimeMinutes}m before making the next request...`);
      await sleep(rateLimitedWaitTimeMinutes * 60 * 1000);
    }

    return { errorType, statusCode, message };
  } else {
    const UNKNOWN_ERROR_STRING = 'unknown';

    // throw an error for all other errors
    let errorString = null;
    try {
      if (errorData) {
        errorString = errorData?.length
          ? JSON.stringify(JSON.parse(errorData))
          : (errorData?.toString && errorData?.toString()) || '<unknown>';
      } else {
        errorString = UNKNOWN_ERROR_STRING;
        console.error(getErrorMessage(errorType, errorString));
      }
    } catch (err) {
      throw new Error(err);
    }
  }
};

/**
 * Creates a set of requests from a RESO metadata-report.json file
 *
 * TODO: allow resources and expansions to be passed in their own config
 *
 * @param {Object} config Service Root URL and metadata report, and some optional OData query options
 * @returns a list of requests, which consist of requestUri, resourceName, and expandedTypeInfo
 */
const createRequestsFromMetadataReport = ({ serviceRootUri, metadataReportJson = {}, filter, top, orderby }) => {
  const { fields = [] } = metadataReportJson;

  const { requests = [] } = fields.reduce(
    (acc, { resourceName, fieldName, isExpansion, typeName: modelName }) => {
      if (!acc.resources.has(resourceName)) {
        acc.resources.add(resourceName);
        acc.requests.push({ resourceName });
      }

      if (isExpansion && !acc.expansions.has(resourceName + fieldName)) {
        acc.expansions.add(resourceName + fieldName);
        acc.requests.push({ resourceName, fieldName, isExpansion, modelName });
      }

      return acc;
    },
    {
      resources: new Set(),
      expansions: new Set(),
      requests: []
    }
  );

  return requests.map(({ resourceName, fieldName, isExpansion, modelName }) => {
    // each request only queries one expansion at a time for Certification
    const expandedTypeInfo = isExpansion ? [{ fieldName, modelName }] : undefined;
    return {
      requestUri: createODataRequestUri({ serviceRootUri, resourceName, expandedTypeInfo, filter, top, orderby }),
      resourceName,
      expandedTypeInfo
    };
  });
};

/**
 * Creates a request from command-line params
 * @param {Object} params Command-line parameters such as serviceRootUri and resourceName
 * @returns a request, which consists of requestUri, resourceName, and expandedTypeInfo
 */
const createRequestFromParameters = ({ serviceRootUri, resourceName, expansions = [], filter, top, orderby }) => {
  const expandedTypeInfo =
    expansions && expansions?.length
      ? expansions.map(fieldName => {
        return {
          fieldName
          /* TODO: look up type info from reference metadata, when possible */
        };
      })
      : undefined;

  return {
    requestUri: createODataRequestUri({ serviceRootUri, resourceName, expansions, filter, top, orderby }),
    resourceName,
    expandedTypeInfo
  };
};

/**
 *  Creates an OData request url string with the given parameters
 *
 * @param {Object} args parts of the URL and query options
 * @returns an OData request URL as a string
 */
const createODataRequestUri = ({ serviceRootUri, resourceName, expandedTypeInfo = [], filter, top, orderby }) => {
  // TODO: sanitize any existing parameters
  // const { $select, $top, $filter, $orderby } = odataQueryOptions;
  try {
    const url = new URL(serviceRootUri),
      searchParams = [];

    if (url?.searchParams?.length) {
      searchParams.push(url.searchParams);
    }

    if (!!resourceName && resourceName?.length) {
      url.pathname += `${url.pathname.endsWith('/') ? '' : '/'}${resourceName}`;
    }

    if (top && parseInt(top)) {
      searchParams.push(`$top=${top}`);
    }

    if (!!expandedTypeInfo && expandedTypeInfo?.length) {
      searchParams.push(`$expand=${expandedTypeInfo.map(x => x?.fieldName?.trim()).join(',')}`);
    }

    if (!!filter && filter?.length) {
      searchParams.push(`$filter=${filter}`);
    }

    if (!!orderby && orderby?.length) {
      searchParams.push(`$filter=${filter}`);
    }

    url.search = searchParams.join('&');

    return url.toString();
  } catch (err) {
    console.error(err);
    throw new Error(err);
  }
};

/**
 * Creates requests from either a path to a metadata report, or by passing it in directly
 * in metadataReportJson
 *
 * @param {Object} options request options
 * @returns list of requests
 */
const prepareRequests = async ({
  pathToMetadataReportJson,
  metadataReportJson,
  serviceRootUri,
  resourceName,
  expansions = [],
  top,
  filter,
  orderby
}) => {
  const usePaths = !!pathToMetadataReportJson && pathToMetadataReportJson?.length,
    useConfigs = !!metadataReportJson && Object.values(metadataReportJson)?.length,
    useParams = serviceRootUri?.length && resourceName?.length && resourceName?.length;

  const requests = [];

  if (usePaths || useConfigs) {
    requests.push(
      ...createRequestsFromMetadataReport({
        serviceRootUri,
        metadataReportJson: usePaths ? JSON.parse(await readFile(pathToMetadataReportJson, { encoding: 'utf8' })) : metadataReportJson,
        filter,
        top,
        orderby
      })
    );
  } else if (useParams) {
    requests.push(createRequestFromParameters({ serviceRootUri, resourceName, expansions, filter, top, orderby }));
  } else {
    throw new Error('Invalid request. Must provide valid paths, configs, or params!');
  }
  return requests;
};

module.exports = {
  NOT_OK,
  ERROR_TYPES,
  REPLICATION_DIRECTORY_NAME,
  DEFAULT_DD_VERSION,
  scorePayload,
  writeDataAvailabilityReport,
  processHttpErrorResponse,
  parseResourceNameFromODataRequestUri,
  buildOutputFilePath,
  calculateJsonSize,
  displayRuntimeInfo,
  handleError,
  prepareRequests
};
