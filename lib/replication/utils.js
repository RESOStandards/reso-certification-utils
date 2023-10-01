'use strict';

const { writeFile } = require('fs/promises');

const scorePayload = ({
  requestUri = '',
  records = [],
  // TODO: consider not mutating
  resourceAvailabilityMap = {},
  resourceName = '',
  parentResourceName,
  isExpansion = false,
  expansions = [],
  startTime,
  stopTime
}) => {
  // init if the resource doesn't exist
  if (!resourceAvailabilityMap?.[resourceName]) {
    resourceAvailabilityMap[resourceName] = {
      resourceName,
      parentResourceName,
      isExpansion,
      recordCount: 0,
      pageSize: records?.length ?? 0,
      requests: [],
      dateLow: null,
      dateHigh: null,
      // TODO: allow passing the date field name
      dateField: 'ModificationTimestamp',
      // field availability map is fieldName and frequency
      fieldAvailabilityMap: {}
    };

    // TODO: need to deal with average response time ms and record count fields
    resourceAvailabilityMap[resourceName].requests.push({ requestUri, startTime, stopTime, recordCount: records?.length ?? 0 });
  }

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

      // functions aren't allowed here, so this covers everything
      const isObject = typeof value === 'object',
        isArray = Array.isArray(value),
        isPrimitive = value === null || (!isObject && !isArray);

      // if there's a value, it can either be a primitive, or array/object
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
            expansions
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

const consolidateResults = (resourceAvailabilityMap = {}) =>
  Object.values(resourceAvailabilityMap ?? {}).reduce(
    (acc, resourceData) => {
      const { fieldAvailabilityMap = {}, ...remainingResourceData } = resourceData;

      if (Object.values(remainingResourceData)) {
        acc.resources.push(remainingResourceData);
        acc.fields.push(Object.values(fieldAvailabilityMap));
      }

      return acc;
    },
    {
      resources: [],
      fields: [],
      lookups: []
    }
  );

/*
  {
    "description": "RESO Data Availability Report",
    "version": "1.7",
    "generatedOn": "2023-09-11T17:37:06.066Z",
    "resources": [
      {
        "resourceName": "Office",
        "recordCount": 1751,
        "numRecordsFetched": 1709,
        "numSamples": 18,
        "pageSize": 100,
        "averageResponseBytes": 106953,
        "averageResponseTimeMs": 547,
        "dateField": "ModificationTimestamp",
        "dateLow": "2019-08-14T13:59:06Z",
        "dateHigh": "2023-08-28T13:46:24Z",
        "keyFields": [
          "OfficeKey"  //TODO: key fields needs to be in the metadata report instead
        ]
      },
    "fields": [

    ], 
    "lookups": [],
    "lookupValues": []
  }
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

/* 

  //Sample response

  Response {
    [Symbol(realm)]: null,
    [Symbol(state)]: {
      aborted: false,
      rangeRequested: false,
      timingAllowPassed: true,
      requestIncludesCredentials: true,
      type: 'default',
      status: 400,
      timingInfo: {
        startTime: 323.6762090921402,
        redirectStartTime: 0,
        redirectEndTime: 0,
        postRedirectStartTime: 323.6762090921402,
        finalServiceWorkerStartTime: 0,
        finalNetworkResponseStartTime: 0,
        finalNetworkRequestStartTime: 0,
        endTime: 0,
        encodedBodySize: 0,
        decodedBodySize: 0,
        finalConnectionTimingInfo: null
      },
      cacheState: '',
      statusText: 'Bad Request',
      headersList: HeadersList {
        cookies: null,
        [Symbol(headers map)]: [Map],
        [Symbol(headers map sorted)]: null
      },
      urlList: [ [URL] ],
      body: { stream: undefined }
    },
    [Symbol(headers)]: HeadersList {
      cookies: null,
      [Symbol(headers map)]: Map(17) {
        'date' => [Object],
        'server' => [Object],
        'cache-control' => [Object],
        'x-api-key' => [Object],
        'referrer-policy' => [Object],
        'x-permitted-cross-domain-policies' => [Object],
        'x-xss-protection' => [Object],
        'x-download-options' => [Object],
        'x-runtime' => [Object],
        'x-content-type-options' => [Object],
        'odata-version' => [Object],
        'x-powered-by' => [Object],
        'status' => [Object],
        'webserver' => [Object],
        'transfer-encoding' => [Object],
        'content-type' => [Object],
        'x-request-id' => [Object]
      },
      [Symbol(headers map sorted)]: null
    }
  }

*/
const processHttpErrorResponse = ({ status, statusText }) => {
  return {
    statusCode: status,
    message: statusText,
  };
};

module.exports = {
  scorePayload,
  writeDataAvailabilityReport,
  processHttpErrorResponse
};