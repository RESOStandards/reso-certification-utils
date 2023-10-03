'use strict';

const { writeFile } = require('fs/promises');
const { join } = require('path');

const REPLICATION_DIRECTORY_NAME = 'reso-replication-output';

const ERROR_TYPES = {
  HTTP: 'http',
  GENERAL: 'general'
};

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
  responseBytes = 0
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
      dateLow: null,
      dateHigh: null,
      // TODO: allow passing the date field name
      dateField: 'ModificationTimestamp',
      // field availability map is fieldName and frequency
      fieldAvailabilityMap: {}
    };
  }

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
        if (fieldName === resourceAvailabilityMap?.[resourceName]?.dateField) {
          const dateValue = new Date(value),
            currentDateLowValue = resourceAvailabilityMap[resourceName].dateLow,
            currentDateHighValue = resourceAvailabilityMap[resourceName].dateHigh;

          if (currentDateLowValue) {
            resourceAvailabilityMap[resourceName].dateLow = new Date(Math.min(new Date(currentDateLowValue), dateValue)).toISOString();
          }

          if (currentDateHighValue) {
            resourceAvailabilityMap[resourceName].dateLow = new Date(Math.max(new Date(currentDateHighValue), dateValue)).toISOString();
          }
        }

        // process expansions, if present
        if (expansions?.includes(fieldName)) {
          // TODO: look up the resource name for the expanded field and determine whether it's a collection or not
          // for now, just use Media

          // TODO: implement without recursion
          scorePayload({
            requestUri,
            // record can either be an array or single value - detect and process accordingly
            records: isArray ? value : [value],
            resourceAvailabilityMap,
            parentResourceName: resourceName,
            resourceName: 'Media',
            isExpansion: true,
            isCollection: isArray,
            expansions,
            // need to calculate the response size for expansions separately from parent
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

        const { isExpansion = false, responses = [], recordCount = 0, ...rest } = remainingResourceData;
        if (isExpansion) {
          const { numRecordsFetched = 0, medianBytes = 0, stdDevBytes = 0, averageResponseBytes = 0 } = resourceStats;
          // do not include time-based stats for expansions since it's that of their parent resource
          acc.resources.push({
            ...rest,
            isExpansion,
            numRecordsFetched,
            medianBytes,
            stdDevBytes,
            averageResponseBytes
          });
        } else {
          acc.resources.push({
            ...rest,
            ...resourceStats,
            // only add responses for non-expanded items
            responses,
            recordCount
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

module.exports = {
  scorePayload,
  writeDataAvailabilityReport,
  processHttpErrorResponse,
  ERROR_TYPES,
  REPLICATION_DIRECTORY_NAME,
  parseResourceNameFromODataRequestUri,
  buildOutputFilePath,
  calculateJsonSize
};
