'use strict';

const { writeFile } = require('fs/promises');
const { join } = require('path');
const humanizeDuration = require('humanize-duration');

const REPLICATION_DIRECTORY_NAME = 'reso-replication-output';

const ERROR_TYPES = {
  HTTP: 'http',
  GENERAL: 'general'
};

const NOT_OK = 1;

const DEFAULT_DD_VERSION = '1.7', POSTAL_CODE_FIELD_NAME = 'PostalCode';

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
  resourceName = '',
  parentResourceName,
  isExpansion = false,
  expansions = [],
  responseTimeMs,
  responseBytes = 0,
  dateField = 'ModificationTimestamp'
}) => {
  // init if the resource doesn't exist
  if (!resourceAvailabilityMap?.[resourceName]) {
    resourceAvailabilityMap[resourceName] = {
      resourceName,
      parentResourceName,
      numRecordsFetched: 0,
      isExpansion,
      recordCount: 0,
      pageSize: records?.length ?? 0,
      // TODO: allow passing the date field name
      dateField,
      dateHigh: null,
      dateLow: null,
      // field availability map is fieldName and frequency
      fieldAvailabilityMap: {}
    };
  }

  // update legacy property for current reports
  resourceAvailabilityMap[resourceName].numRecordsFetched += records?.length || 0;

  //init if not present
  if (!resourceAvailabilityMap?.[resourceName]?.responses) {
    resourceAvailabilityMap[resourceName].responses = [];
  }

  let responseInfo = {};
  // Update responses
  if (!isExpansion) {
    responseInfo = {
      requestUri,
      responseTimeMs
    };
  }
  responseInfo.responseBytes = responseBytes;
  resourceAvailabilityMap[resourceName].responses.push(responseInfo);

  records.forEach(record => {
    Object.entries(record).forEach(([fieldName, value]) => {
      // init if the field if it doesn't exist
      if (!resourceAvailabilityMap?.[resourceName]?.fieldAvailabilityMap?.[fieldName]) {
        resourceAvailabilityMap[resourceName].fieldAvailabilityMap[fieldName] = {
          resourceName,
          parentResourceName,
          fieldName,
          frequency: 0
        };
      }

      // if there's a value, it can either be a primitive, or array/object
      const { isPrimitive, isArray } = isObjectOrArrayOrPrimitive(value);

      // functions aren't allowed here, so this covers everything
      if (!!value && (isPrimitive || Object.values(value)?.length)) {
        // increment usage
        resourceAvailabilityMap[resourceName].fieldAvailabilityMap[fieldName].frequency++;

        // Update resource max and min dates
        if (fieldName === dateField) {
          const dateValue = new Date(value),
            currentDateLowValue = resourceAvailabilityMap?.[resourceName]?.dateLow
              ? new Date(resourceAvailabilityMap[resourceName].dateLow)
              : null,
            currentDateHighValue = resourceAvailabilityMap?.[resourceName]?.dateHigh
              ? new Date(resourceAvailabilityMap[resourceName].dateHigh)
              : null;

          if (dateValue) {
            if (currentDateLowValue) {
              resourceAvailabilityMap[resourceName].dateLow = new Date(Math.min(currentDateLowValue, dateValue)).toISOString();
            } else {
              resourceAvailabilityMap[resourceName].dateLow = dateValue.toISOString();
            }

            if (currentDateHighValue) {
              resourceAvailabilityMap[resourceName].dateHigh = new Date(Math.max(currentDateHighValue, dateValue)).toISOString();
            } else {
              resourceAvailabilityMap[resourceName].dateHigh = dateValue.toISOString();
            }
          }
        }

        if (fieldName === POSTAL_CODE_FIELD_NAME) {
          if (!resourceAvailabilityMap?.[resourceName]?.postalCodes) {
            resourceAvailabilityMap[resourceName].postalCodes = new Set();
          }
          resourceAvailabilityMap[resourceName].postalCodes.add(value);
        }

        // TODO: Enumerations

        // process expansions, if present
        if (expansions?.includes(fieldName)) {
          // TODO: look up the resource name for the expanded field and determine whether it's a collection or not
          // for now, just use Media

          scorePayload({
            requestUri,
            records: isArray ? value : [value],
            resourceAvailabilityMap,
            parentResourceName: resourceName,
            resourceName: 'Media',
            isExpansion: true,
            isCollection: isArray,
            expansions,
            responseBytes: calculateJsonSize(value)
          });
        }
      }

      if (isExpansion) {
        //console.log('Is Expansion! ' + resourceName + ', ' + fieldName);
        //TODO: anything else relevant to expansions (inside of recursive call)
      }
    });
  });
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
 * @param {Map} resourceAvailabilityMap map containing availability data
 * @returns consolidated availability data set in canonical resources, fields, lookups format
 */
const consolidateResults = (resourceAvailabilityMap = {}) =>
  // each responses item is { requestUri, responseTimeMs, startTime, stopTime, recordCount: records?.value?.length || 0, responseStatus }
  Object.values(resourceAvailabilityMap ?? {}).reduce(
    (acc, resourceData) => {
      const { fieldAvailabilityMap = {}, ...remainingResourceData } = resourceData;

      /*
        Current Resource Aggregation

        {
          "resourceName": "Office",
          "recordCount": 1751,
          "numRecordsFetched": 1709,
          "numSamples": 18,
          "pageSize": 100,
          "averageResponseBytes": 106953,
          "averageResponseTimeMillis": 547,
          "dateField": "ModificationTimestamp",
          "dateLow": "2019-08-14T13:59:06Z",
          "dateHigh": "2023-08-28T13:46:24Z",
          "keyFields": [
            "OfficeKey"
          ]
        },
      */

      if (Object.values(remainingResourceData)) {
        // need to compute the following stats from the resources requests array to support older reports
        // recordCount, averageResponseBytes, averageResponseTimeMillis, dateLow, dateHigh
        const { numRecordsFetched = 0 } = remainingResourceData;

        const { responseBytesValues = [], responseTimeValues = [] } = (remainingResourceData?.responses || []).reduce(
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

        const { isExpansion = false, responses = [], recordCount = 0, postalCodes: postalCodesSet = new Set(), ...rest } = remainingResourceData;
        const postalCodes = postalCodesSet?.size ? Array.from(postalCodesSet) : undefined;
        if (isExpansion) {
          // do not include time-based stats for expansions since it's that of their parent resource
          const { numRecordsFetched = 0, medianBytes = 0, stdDevBytes = 0, averageResponseBytes = 0 } = resourceStats;
          acc.resources.push({
            ...rest,
            isExpansion,
            numRecordsFetched,
            medianBytes,
            stdDevBytes,
            averageResponseBytes,
            postalCodes
          });
        } else {
          acc.resources.push({
            ...rest,
            ...resourceStats,
            // only add responses for non-expanded items
            responses,
            recordCount,
            postalCodes
          });
        }

        acc.fields.push(...Object.values(fieldAvailabilityMap));
      }

      return acc;
    },
    {
      resources: [],
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
  const AVAILABILITY_REPORT_FILENAME = 'data-availability-report.json';

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
 * @param {*} resourceName the name of the Data Dictionary resource whose files are being saved
 * @returns an operating system dependent path to save replication data with
 */
const buildOutputFilePath = (outputPath, resourceName) =>
  join(outputPath, REPLICATION_DIRECTORY_NAME, resourceName, new Date().toISOString().replaceAll(':', '-'));

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
const handleError = error => {
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
  handleError
};
