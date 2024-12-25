'use strict';

const { getReferenceMetadata } = require('@reso/reso-certification-etl');
const { writeFile, mkdir } = require('node:fs/promises');
const { join, resolve } = require('node:path');
const { getFileSafeIso8601Timestamp } = require('../../common');
const { faker } = require('@faker-js/faker');
const { sleep } = require('../../common');

const LOOKUP_NAME_MAP = {
  StandardStatus: ['Active', 'Pending', 'Active Under Contract'],
  InteriorFeatures: ['Bar', 'Dry Bar', 'Pantry', 'Soaking Tub']
};

const ENUMERATION_TYPES = Object.freeze({
  StringSingle: 'StringSingle',
  StringMulti: 'StringMulti',
  ODataSingle: 'ODataSingle',
  ODataMulti: 'ODataMulti',
  IsFlags: 'IsFlags'
});

const getEnumerationValues = ({ lookupName, count = 1, enumerationType = ENUMERATION_TYPES.StringSingle } = {}) => {
  switch (enumerationType) {
  case ENUMERATION_TYPES.StringSingle:
    return faker.helpers.arrayElements(LOOKUP_NAME_MAP?.[lookupName], count)?.[0];
  case ENUMERATION_TYPES.StringMulti:
    return faker.helpers.arrayElements(LOOKUP_NAME_MAP?.[lookupName], count);
  default:
    throw new Error(`Enumeration type of '${enumerationType}' is not supported`);
  }
};

const getKeyValue = ({ keyLength = 32 } = {}) => faker.string.alpha(keyLength);

const getDateValue = ({} = {}) => faker.date.recent().toISOString().split('T')?.[0];

const getTimestampValue = ({} = {}) => faker.date.recent().toISOString();

const getNumericValue = ({ resourceName, fieldName, max, scale = 2, precision = 0 } = {}) => {
  const getRandomInteger = (max = 100) => Math.floor(Math.random() * max);

  if (!precision || precision === 0) {
    if (!max && resourceName === 'Property' && fieldName === 'ListPrice') {
      max = 10000000;
    }
    return getRandomInteger(scale);
  } else {
    return parseFloat(`${getRandomInteger(Math.pow(10, scale))}.${getRandomInteger(Math.pow(10, precision)) - 1}`);
  }
};

const getExpandedValues = ({ modelName = 'Media', resourceName, resourceRecordKey, sourceResourceKey, count = 1 } = {}) => {
  if (resourceName && resourceRecordKey) {
    //belongs-to relationship

    if (modelName === 'Media') {
      return [
        {
          MediaKey: getKeyValue(),
          ResourceName: resourceName,
          ResourceRecordKey: resourceRecordKey,
          MediaCategory: 'Branded Virtual Tour',
          MediaType: 'mov',
          MediaURL: 'https://example.com/vJVDL415WZ7GE1/',
          ShortDescription: 'Example'
        },
        {
          MediaKey: getKeyValue(),
          ResourceName: resourceName,
          ResourceRecordKey: resourceRecordKey,
          MediaType: 'pdf',
          MediaURL: 'https://example.com/vJVDL415WZ7GE1/doc/floorplan_imperial.pdf',
          ShortDescription: 'imperial'
        }
      ].slice(0, count);
    }

    if (modelName === 'PropertyRooms') {
      return [
        {
          RoomKey: getKeyValue(),
          ListingKey: resourceRecordKey,
          ListingId: resourceRecordKey,
          RoomType: 'Dining',
          RoomName: 'Breakfast',
          RoomWidth: 4.409,
          RoomLength: 2.977,
          RoomLengthWidthUnits: 'Meters',
          RoomLengthWidthSource: 'LocalProvider'
        },
        {
          RoomKey: getKeyValue(),
          ListingKey: resourceRecordKey,
          ListingId: resourceRecordKey,
          RoomType: 'Dining',
          RoomName: 'Dining',
          RoomWidth: 4.3,
          RoomLength: 5.998,
          RoomLengthWidthUnits: 'Meters',
          RoomLengthWidthSource: 'LocalProvider'
        }
      ].slice(0, count);
    }
  } else if (sourceResourceKey) {
    //has-one or has-many depending on count
  }
};

async function* rcfGeneratorIterator({
  //modelName,
  dataGeneratorStateService = {},
  metadataReportJson = getReferenceMetadata(),
  relatedRecordCounts = {
    Media: 10,
    Rooms: 2,
    ListAgent: 1
  },
  useExpansions = false
}) {
  const ListingKey = getKeyValue();

  if (!dataGeneratorStateService) {
    throw new Error('Data generator service instance is required!');
  }

  if ((metadataReportJson && !metadataReportJson?.fields?.length) || (false && !metadataReportJson?.lookups?.length)) {
    throw new Error('Invalid metadataReportJson passed to RCF data generator!');
  }

  if (useExpansions) {
    console.debug('useExpansions was passed, expanded data will be nested within each record.');
  }

  // TODO: generate records for the resource names and counts that were passed
  const records = Object.freeze({
    Property: [
      {
        ListingKey,
        StandardStatus: getEnumerationValues({ lookupName: 'StandardStatus' }),
        InteriorFeatures: getEnumerationValues({ lookupName: 'InteriorFeatures', count: 2, enumerationType: ENUMERATION_TYPES.StringMulti }),
        BedroomsTotal: getNumericValue({ max: 10 }),
        ListPrice: getNumericValue({ scale: 8, precision: 2 }),
        ListingContractDate: getDateValue(),
        ModificationTimestamp: getTimestampValue()
      }
    ],
    Media: [
      ...getExpandedValues({
        modelName: 'Media',
        resourceName: 'Property',
        resourceRecordKey: ListingKey,
        count: relatedRecordCounts.Media
      })
    ]
  });

  yield {
    ...records
  };
}

// TODO: fix relatedRecordCounts
const generateRcfData = async ({
  resourceNames = [],
  metadataReportJson,
  relatedRecordCounts = {
    Media: 10,
    Rooms: 10,
    ListAgent: 1
  },
  outputPath = null,
  fromCli = false
} = {}) => {
  try {
    if (fromCli && !(outputPath && outputPath?.length)) {
      throw new Error('outputPath is required when calling this function from the command line');
    }

    // map of resourceName, array of RCF values
    const results = {};

    const WRITE_RESULTS = !!(outputPath && outputPath?.length);

    if (WRITE_RESULTS) {
      await mkdir(outputPath, { recursive: true });
    }

    for await (const resourceName of resourceNames) {
      for await (const resourceNameRecordMap of rcfGeneratorIterator({
        modelName: resourceName,
        metadataReportJson,
        relatedRecordCounts
      })) {
        if (WRITE_RESULTS) {
          await writeFile(
            resolve(
              join(
                outputPath && outputPath?.length ? outputPath : 'reso-data-generator',
                `${resourceName}.${getFileSafeIso8601Timestamp()}.json`
              )
            ),
            JSON.stringify({
              '@reso.context': `urn:reso:metadata:2.0:${resourceName.toLocaleLowerCase()}`,
              value: resourceNameRecordMap?.[resourceName] ?? []
            })
          );

          //wait 1ms to ensure no file collisions
          await sleep(1);
        } else {
          if (!results?.[resourceName]) {
            results[resourceName] = [];
          }
          results[resourceName].push(...(records?.[resourceName] ?? []));
        }
      }
    }

    if (!outputPath || !fromCli) return results;
  } catch (err) {
    console.error(err);
  }
};

module.exports = {
  generateRcfData
};
