'use strict';

const { writeFile } = require('fs/promises');

const scorePayload = ({
  requestUri = '',
  records = [],
  resourceAvailabilityMap,
  resourceName = '',
  isExpansion = false,
  expansions = [],
  startTime,
  stopTime
}) => {
  // init if the resource doesn't exist
  if (!resourceAvailabilityMap?.[resourceName]) {
    resourceAvailabilityMap[resourceName] = {
      resourceName,
      recordCount: 0,
      pageSize: records?.length ?? 0,
      requests: [],
      dateLow: null,
      dateHigh: null,
      isExpansion: false,
      parentResourceName: null,
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
          fieldName,
          frequency: 0
        };
      }

      // if there's a value, it can either be a primitive, or array/object
      if (!!value && (typeof value !== 'object' || Object.values(value)?.length)) {
        // increment usage
        resourceAvailabilityMap[resourceName].fieldAvailabilityMap[fieldName].frequency++;

        // Update resource max and min dates
        if (fieldName === resourceAvailabilityMap?.[resourceName]?.dateField) {
          const dateValue = new Date(value),
            currentDateLowValue = resourceAvailabilityMap[resourceName].dateLow,
            currentDateHighValue = resourceAvailabilityMap[resourceName].dateHigh;

          if (!!currentDateLowValue) {
            resourceAvailabilityMap[resourceName].dateLow = new Date(Math.min(new Date(currentDateLowValue), dateValue)).toISOString();
          }

          if (!!currentDateHighValue) {
            resourceAvailabilityMap[resourceName].dateLow = new Date(Math.max(new Date(currentDateHighValue), dateValue)).toISOString();
          }
        }

        // process expansions, if present
        if (expansions?.includes[fieldName]) {
          // TODO: look up the resource name for the expanded field and determine whether it's a collection or not
          // for now, just use Media
          const resourceName = 'Media',
            isCollection = true;

          // TODO: implement without recursion
          resourceAvailabilityMap = scorePayload({
            requestUri,
            records: value,
            resourceAvailabilityMap,
            parentResourceName: resourceName,
            resourceName,
            isExpansion: true,
            isCollection,
            expansions
          });
        }
      }

      if (isExpansion) {
        //resourceAvailabilityMap[resourceName][fieldName]
        console.log('Is Expansion! ' + resourceName + ', ' + fieldName);
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

module.exports = {
  scorePayload,
  writeDataAvailabilityReport
};
