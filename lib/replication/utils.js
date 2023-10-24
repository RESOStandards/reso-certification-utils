'use strict';

const humanizeDuration = require('humanize-duration');
const { writeFile } = require('fs/promises');
const { join } = require('path');
const { createHash } = require('node:crypto');

// custom libs
const { sleep } = require('../../common');

const REPLICATION_DIRECTORY_NAME = 'reso-replication-output',
  AVAILABILITY_REPORT_FILENAME = 'data-availability-report.json',
  AVAILABILITY_RESPONSES_FILENAME = 'data-availability-responses.json';

const ERROR_TYPES = {
  HTTP: 'http',
  GENERAL: 'general'
};

const ERROR_CODES = {
  HTTP: {
    RATE_LIMITED: 429,
    UNAUTHORIZED: 401
  }
};

const UNKNOWN_ERROR_STRING = '<unknown>';

const NOT_OK = 1;

const DEFAULT_DD_VERSION = '1.7',
  POSTAL_CODE_FIELD_NAME = 'PostalCode';

const hashJsonData = jsonData => {
  try {
    return createHash('sha3-256').update(JSON.stringify(jsonData)).digest('hex');
  } catch (err) {
    console.log(err);
    return null;
  }
};

const extractValues = (jsonData = {}) => {
  if (jsonData) {
    // try parsing as OData value collection with optional context properties
    const { value = [] } = jsonData;

    if (value && Array.isArray(value)) {
      return value;
    } else if (Object.values(jsonData)?.length) {
      // if data is a single item, return as array
      return [jsonData];
    } else {
      return [];
    }
  } else {
    return [];
  }
};

const getFieldTypeInfo = (fieldData = {}) => {
  return {
    isLookupField: !!fieldData?.lookupValues,
    isComplexType: !!fieldData?.isComplexType,
    isCollection: !!fieldData?.isCollection,
    type: fieldData?.type
  };
};

const ensureModelAvailabilityMapIsInitialized = ({ resourceAvailabilityMap, modelName, parentModelName, dateField }) => {
  const isExpansion = !!modelName && !!parentModelName;

  if (isExpansion) {
    if (!resourceAvailabilityMap?.[parentModelName]) {
      resourceAvailabilityMap[parentModelName] = {
        resourceName: parentModelName,
        // TODO: allow passing the date field name
        dateField,
        dateHigh: null,
        dateLow: null,
        // field availability map is fieldName and frequency
        fieldAvailabilityMap: {},
        expandedResourceMap: {}
      };
    }

    if (!resourceAvailabilityMap?.[parentModelName]?.expandedResourceMap?.[modelName]) {
      resourceAvailabilityMap[parentModelName].expandedResourceMap[modelName] = {
        resourceName: modelName,
        parentResourceName: parentModelName,
        dateField,
        dateHigh: null,
        dateLow: null,
        fieldAvailabilityMap: {}
      };
    }
  } else {
    // add item to resource availability map if not present
    if (!resourceAvailabilityMap?.[modelName]) {
      resourceAvailabilityMap[modelName] = {
        resourceName: modelName,
        // TODO: allow passing the date field name
        dateField,
        dateHigh: null,
        dateLow: null,
        // field availability map is fieldName and frequency
        fieldAvailabilityMap: {},
        expandedResourceMap: {}
      };
    }
  }
};

const incrementLookupValueFrequency = ({ availabilityMap = {}, fieldName, lookupValue }) => {
  if (availabilityMap && Object.values(availabilityMap) && !availabilityMap?.fieldAvailabilityMap?.[fieldName]?.lookupMap?.[lookupValue]) {
    availabilityMap.fieldAvailabilityMap[fieldName].lookupMap[lookupValue] = {
      lookupValue,
      frequency: 0
    };
  }

  availabilityMap.fieldAvailabilityMap[fieldName].lookupMap[lookupValue].frequency++;
};

/**
 * Normalizes records to process so that all expansions are on the same level as the main resource
 *
 * Takes a hash that allows parent resources to not be duplicated when fetched with multiple child expansions
 *
 * @param {Object} params Contains a record with potentially multiple expanded records to process
 * @returns a flattened list of all resources and expansions to process
 */
const normalizeRecords = ({ expansionInfo, record, resourceName: parentModelName, recordHashCountMap = {} }) => {
  if (!record || !parentModelName) return [];

  try {
    const recordsToProcess = [];
    if (!!expansionInfo && expansionInfo?.length) {
      // flatten expansions into main records
      recordsToProcess.push(
        ...expansionInfo.reduce((acc, { fieldName, modelName }) => {
          const { [fieldName]: expandedData, ...remainingData } = record;

          if (expandedData) {
            const expandedRecords = Array.isArray(expandedData) ? [...expandedData] : [expandedData];
            expandedRecords.map(expandedRecord =>
              acc.push({
                modelName,
                parentModelName,
                fieldName,
                isExpansion: true,
                record: expandedRecord
              })
            );
          }

          const remainingDataHash = hashJsonData(remainingData);
          if (!recordHashCountMap[remainingDataHash]) {
            // push remaining data besides the expansion if we haven't seen it already
            acc.push({
              modelName: parentModelName,
              isExpansion: false,
              record: remainingData
            });

            recordHashCountMap[remainingDataHash] = 1;
          } else {
            recordHashCountMap[remainingDataHash]++;
          }

          return acc;
        }, [])
      );
    } else {
      // if no expansions, process the entire record
      recordsToProcess.push({
        modelName: parentModelName,
        isExpansion: false,
        record
      });
    }

    return recordsToProcess;
  } catch (err) {
    console.error(err);
  }

  return [];
};

// // handle expansions
// const isExpansion = !!((expansionInfo && expansionInfo?.length) || undefined),
//   [{ modelName: expandedResourceName } = {}] = expansionInfo || [];

// if (!!expandedResourceName) {
//   availabilityMap.expansions.add(expandedResourceName);
// }

/**
 * Scores a payload with the given data
 * @param {Object} data options to be extracted from the caller
 *
 * Note that this function mutates the resourceAvailabilityMap, which
 * the caller would pass in and have declared in the calling function
 */
const scorePayload = ({
  requestUri,
  jsonData,
  resourceAvailabilityMap = {} /* TODO: consider not mutating */,
  recordHashCountMap = {} /* TODO: consider not mutating */,
  responses = [],
  resourceName,
  responseTimeMs,
  startTime,
  stopTime,
  responseBytes,
  dateField = 'ModificationTimestamp',
  expansionInfo,
  hasError,
  strategy,
  metadataMap
}) => {
  const records = extractValues(jsonData);

  // return if there's nothing to process
  if (!(records && Array.isArray(records) && records?.length)) return;

  // Score records
  records.forEach(record => {
    // process both parent record and expanded data
    (normalizeRecords({ expansionInfo, record, resourceName, recordHashCountMap }) || []).forEach(normalizedRecord => {
      const { isExpansion = false, modelName, parentModelName, record = {} } = normalizedRecord;

      ensureModelAvailabilityMapIsInitialized({
        resourceAvailabilityMap,
        modelName,
        parentModelName,
        dateField
      });

      const availabilityMap = isExpansion
        ? resourceAvailabilityMap[parentModelName].expandedResourceMap[modelName]
        : resourceAvailabilityMap[modelName];

      Object.entries(record).forEach(([fieldName, value]) => {
        // init if the field if it doesn't exist
        if (!availabilityMap?.fieldAvailabilityMap?.[fieldName]) {
          availabilityMap.fieldAvailabilityMap[fieldName] = {
            resourceName: modelName,
            fieldName,
            frequency: 0
          };
        }

        // if there's a value, it can either be a primitive, or array/object
        const { isPrimitive, isArray, isObject } = isObjectOrArrayOrPrimitive(value);
        const { isLookupField = false, type: fieldDataType } = getFieldTypeInfo(metadataMap?.[modelName]?.[fieldName]);

        if (value) {
          
          // increment parent field availability
          availabilityMap.fieldAvailabilityMap[fieldName].frequency++;

          if (isLookupField) {
            /*
              resourceName and fieldName are already contained 
              in the map, so we'll omit them at this point to save space
              and reconstitute them in the consolidateResults function

              {
                "resourceName": "Property",
                "fieldName": "FireplaceFeatures",
                "lookupValue": "Pellet Stove",
                "frequency": 206
              },
            */
            
            if (!availabilityMap?.fieldAvailabilityMap?.[fieldName]) {
              // init if the lookup map for the field if it doesn't exist yet for some reason
              availabilityMap.fieldAvailabilityMap[fieldName] = {
                resourceName: modelName,
                fieldName,
                frequency: 0,
                lookupMap: {}
              };
            } else if (!availabilityMap?.fieldAvailabilityMap?.[fieldName]?.lookupMap) {
              // otherwise just init a new lookup map
              availabilityMap.fieldAvailabilityMap[fieldName].lookupMap = {};
            }

            // lookup values can either be single items, arrays, or comma-separated strings
            // the metadata validation process will enforce the correct format in each case
            if (isArray) {
              // arrays are for collections of string or Edm.EnumType enumerations
              // which can be processed as-is
              value.forEach(lookupValue => incrementLookupValueFrequency({ availabilityMap, fieldName, lookupValue }));
            } else if (fieldDataType !== 'Edm.String' && value?.includes(',')) {
              // Process OData isFlags enumeration
              value.split(',').forEach(lookupValue => incrementLookupValueFrequency({ availabilityMap, fieldName, lookupValue }));
            } else {
              // otherwise, process single value
              incrementLookupValueFrequency({ availabilityMap, fieldName, lookupValue: value });
            }

          } else if (isArray) {
            console.debug('TODO: need to process arrays! value: ' + JSON.stringify(value));
          } else if (isPrimitive || isObject) {
            // some fields need additional treatments
            processSpecialFields({ availabilityMap, fieldName, dateField, value });

          } else {
            console.debug('Found data with a type other than primitive, object, or array!');
          }
        }
      });
    });
  });

  // handle responses
  if (!hasError) {
    responses.push({
      requestUri,
      startTime,
      stopTime,
      responseTimeMs,
      responseBytes,
      resourceName,
      expansionInfo,
      strategy,
      hasError: hasError || undefined
    });
  }
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
 * 
 *    Current format with expansions
 * 
 *    { 
 *      "Property": {
 *        "resourceName": "Property",
 *        "dateField": "ModificationTimestamp",
 *        "dateHigh": "2023-03-15T19:03:13.000Z",
 *         "dateLow": "2008-10-21T16:00:52.000Z",
 *         "fieldAvailabilityMap": {...},
 *         "expandedResourceMap": {
 *           "Media": {
 *             "resourceName": "Media",
 *             "parentResourceName": "Property",
 *             "dateField": "ModificationTimestamp",
 *             "dateHigh": null,
 *             "dateLow": null,
 *             "fieldAvailabilityMap": {...}
 *          }
 *        }
 *      }
 *    }
 * 
 *
 * @param {Map} resourceAvailabilityMap map containing availability data
 * @returns consolidated availability data set in canonical resources, fields, lookups format
 */
const consolidateResults = (resourceAvailabilityMap = {}) =>
  Object.values(resourceAvailabilityMap ?? {}).reduce(
    (
      acc,
      { fieldAvailabilityMap = {}, expansionAvailabilityMap = {}, numRecordsFetched = 0, /* expansionInfo = [],*/ ...remainingResourceData }
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
const writeDataAvailabilityReport = async ({ version, resourceAvailabilityMap = {}, responses = [] }) => {
  try {
    const generatedOn = new Date().toISOString();

    // add additional line
    console.log();

    // write responses report
    await writeFile(
      AVAILABILITY_RESPONSES_FILENAME,
      JSON.stringify(
        {
          description: 'RESO Data Availability Responses',
          version,
          generatedOn,
          responses
        },
        null,
        '  '
      )
    );

    console.log(`Response info written to ${AVAILABILITY_REPORT_FILENAME}`);

    // write DA report
    await writeFile(
      AVAILABILITY_REPORT_FILENAME,
      JSON.stringify(
        {
          description: 'RESO Data Availability Report',
          version,
          generatedOn,
          ...resourceAvailabilityMap
        },
        null,
        '  '
      )
    );

    console.log(`Availability results written to ${AVAILABILITY_REPORT_FILENAME}`);
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
const buildOutputFilePath = ({ outputPath, isoTimestamp = new Date().toISOString(), resourceName }) => {
  if (!outputPath) {
    throw new Error('Missing outputPath!');
  }

  if (!resourceName) {
    throw new Error('Missing resourceName!');
  }

  return join(outputPath, REPLICATION_DIRECTORY_NAME, resourceName, isoTimestamp.replaceAll(':', '-'));
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
    const statusCodeInt = parseInt(statusCode),
      errorMessage = `HTTP request error! Status code: ${statusCode}, message: '${message}'`;

    // some HTTP errors can potentially be handled
    console.error(errorMessage);

    if (statusCodeInt === ERROR_CODES.HTTP.UNAUTHORIZED) {
      process.exit(NOT_OK);
    }

    if (statusCodeInt === ERROR_CODES.HTTP.RATE_LIMITED) {
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
 * @returns a list of requests, which consist of requestUri, resourceName, and expansionInfo
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
    const expansionInfo = isExpansion ? [{ fieldName, modelName }] : undefined;
    return {
      requestUri: createODataRequestUri({ serviceRootUri, resourceName, expansionInfo, filter, top, orderby }),
      resourceName,
      expansionInfo
    };
  });
};

/**
 * Creates a request from command-line params
 * @param {Object} params Command-line parameters such as serviceRootUri and resourceName
 * @returns a request, which consists of requestUri, resourceName, and expansionInfo
 */
const createRequestFromParameters = ({ serviceRootUri, resourceName, expansions = [], filter, top, orderby }) => {
  const expansionInfo =
    expansions && expansions?.length
      ? expansions.map(fieldName => {
        return {
          fieldName
          /* TODO: look up type info from reference metadata, when possible */
        };
      })
      : undefined;

  return {
    requestUri: createODataRequestUri({ serviceRootUri, resourceName, expansionInfo, filter, top, orderby }),
    resourceName,
    expansionInfo
  };
};

/**
 *  Creates an OData request url string with the given parameters
 *
 * @param {Object} args parts of the URL and query options
 * @returns an OData request URL as a string
 */
const createODataRequestUri = ({ serviceRootUri, resourceName, expansionInfo = [], filter, top, orderby }) => {
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

    if (!!expansionInfo && expansionInfo?.length) {
      searchParams.push(`$expand=${expansionInfo.map(x => x?.fieldName?.trim()).join(',')}`);
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
  metadataReportJson,
  serviceRootUri,
  resourceName,
  expansions = [],
  top,
  filter,
  orderby
}) => {
  const useConfigs = !!metadataReportJson && Object.values(metadataReportJson)?.length,
    useParams = serviceRootUri?.length && resourceName?.length && resourceName?.length;

  const requests = [];

  if (useConfigs) {
    requests.push(
      ...createRequestsFromMetadataReport({
        serviceRootUri,
        metadataReportJson,
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
  prepareRequests,
  consolidateResults
};
