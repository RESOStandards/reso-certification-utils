'use strict';

const { writeFile } = require('fs/promises');

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
const scorePayload = (records = [], availabilityMap = {}, resourceName, expansions = []) => {
  records.forEach(record => {
    Object.entries(record).forEach(([fieldName, value]) => {
      if (!availabilityMap?.[fieldName]) {
        availabilityMap[fieldName] = 0;
      }

      if (!!value && (typeof value !== 'object' || Object.values(value)?.length)) {
        availabilityMap[fieldName]++;
      }
    });
  });

  return availabilityMap;
};

const consolidateResults = (resourceName, availabilityMap = {}, numRecordsFetched) => {
  return {
    resources: [{ resourceName, numRecordsFetched }],
    fields: Object.entries(availabilityMap ?? {}).map(([fieldName, frequency]) => {
      return { resourceName, fieldName, frequency };
    })
  };
};

const writeDataAvailabilityReport = async (resourceName, availabilityMap = {}, totalRecordCount = 0) => {
  const AVAILABILITY_REPORT_FILENAME = 'data-availability-report.json';

  try {
    await writeFile(
      AVAILABILITY_REPORT_FILENAME,
      JSON.stringify(
        {
          description: 'RESO Data Availability Report',
          version: '1.7',
          generatedOn: new Date().toISOString(),
          ...consolidateResults(resourceName, availabilityMap, totalRecordCount)
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
