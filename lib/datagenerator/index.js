'use strict';

const { getReferenceMetadata } = require('@reso/reso-certification-etl');
const { writeFile, mkdir } = require('node:fs/promises');
const { join, resolve } = require('node:path');
const { getFileSafeIso8601Timestamp } = require('../../common');
const { faker } = require('@faker-js/faker');
const { sleep, createDataGeneratorStateServiceInstance } = require('../../common');
const { TOP_LEVEL_RESOURCE_MAP, ENABLE_NESTED_EXPANSIONS, PRIMARY_KEY_MAP } = require('./constants');
const { setForeignKeyValue, getKeyValue } = require('./utils');

const ENUMERATION_TYPES = Object.freeze({
  StringSingle: 'StringSingle',
  StringMulti: 'StringMulti',
  ODataSingle: 'ODataSingle',
  ODataMulti: 'ODataMulti',
  IsFlags: 'IsFlags'
});

const getEnumerationValues = ({ lookupName, count = 1, enumerationType = ENUMERATION_TYPES.StringSingle, values }) => {
  if (!enumerationType) throw new Error(`Invalid enumeration type for lookup ${lookupName}`);
  // TODO: Handle empty lookups
  let empty = false;
  if (values?.length === 0) {
    // console.error(`No values passed for lookup ${lookupName}`);
    empty = true;
  }
  switch (enumerationType) {
    case ENUMERATION_TYPES.StringSingle:
      if (empty) return null;
      return faker.helpers.arrayElements(values, count)?.[0];
    case ENUMERATION_TYPES.StringMulti:
      if (empty) return [];
      return faker.helpers.arrayElements(values, count);
    default:
      throw new Error(`Enumeration type of '${enumerationType}' is not supported`);
  }
};

const getStringValue = ({ maxLength = 50 } = {}) => {
  // TODO: enhance string creation
  // const moreConservativeMaxLength = maxLength / 4;
  // const actualLength = Math.floor(Math.random() * moreConservativeMaxLength);
  return faker.lorem.text()?.substring(0, maxLength);
};

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

// const getExpandedValues = ({ modelName = 'Media', resourceName, resourceRecordKey, sourceResourceKey, count = 1 } = {}) => {
//   if (resourceName && resourceRecordKey) {
//     //belongs-to relationship

//     if (modelName === 'Media') {
//       return [
//         {
//           MediaKey: getKeyValue(),
//           ResourceName: resourceName,
//           ResourceRecordKey: resourceRecordKey,
//           MediaCategory: 'Branded Virtual Tour',
//           MediaType: 'mov',
//           MediaURL: 'https://example.com/vJVDL415WZ7GE1/',
//           ShortDescription: 'Example'
//         },
//         {
//           MediaKey: getKeyValue(),
//           ResourceName: resourceName,
//           ResourceRecordKey: resourceRecordKey,
//           MediaType: 'pdf',
//           MediaURL: 'https://example.com/vJVDL415WZ7GE1/doc/floorplan_imperial.pdf',
//           ShortDescription: 'imperial'
//         }
//       ].slice(0, count);
//     }

//     if (modelName === 'PropertyRooms') {
//       return [
//         {
//           RoomKey: getKeyValue(),
//           ListingKey: resourceRecordKey,
//           ListingId: resourceRecordKey,
//           RoomType: 'Dining',
//           RoomName: 'Breakfast',
//           RoomWidth: 4.409,
//           RoomLength: 2.977,
//           RoomLengthWidthUnits: 'Meters',
//           RoomLengthWidthSource: 'LocalProvider'
//         },
//         {
//           RoomKey: getKeyValue(),
//           ListingKey: resourceRecordKey,
//           ListingId: resourceRecordKey,
//           RoomType: 'Dining',
//           RoomName: 'Dining',
//           RoomWidth: 4.3,
//           RoomLength: 5.998,
//           RoomLengthWidthUnits: 'Meters',
//           RoomLengthWidthSource: 'LocalProvider'
//         }
//       ].slice(0, count);
//     }
//   } else if (sourceResourceKey) {
//     //has-one or has-many depending on count
//   }
// };

// TODO: Preserve relationships with the parent keys etc
const getExpandedValues = ({
  dataGeneratorStateService,
  relatedRecordCounts,
  useExpansions,
  totalRecordsRemaining,
  parentResourceName,
  resourceName,
  count = 1,
  parentPrimaryKey
}) => {
  let expandedEntities = [];
  if (TOP_LEVEL_RESOURCE_MAP[resourceName]) {
    let recentEntities = dataGeneratorStateService.getTrackedEntities(resourceName);
    // if (!recentEntities.length) {
    //   const resourceRecords = generateBatchOfEntities({
    //     dataGeneratorStateService,
    //     recordsToGenerate: count,
    //     fields,
    //     relatedRecordCounts,
    //     useExpansions,
    //     totalRecordsRemaining,
    //     resourceName
    //   });

    //   dataGeneratorStateService.trackGeneratedEntities(modelName, resourceRecords);

    //   totalRecordsRemaining[modelName] = (totalRecordsRemaining[modelName] || 0) + count;

    //   recentEntities = resourceRecords;
    // }
    expandedEntities = recentEntities && recentEntities?.length ? faker.helpers.arrayElements(recentEntities, count) : [];
  } else {
    const { metadataMap } = dataGeneratorStateService.getMetadataMap();

    const fields = metadataMap[resourceName];
    expandedEntities = generateBatchOfEntities({
      dataGeneratorStateService,
      recordsToGenerate: count,
      fields,
      relatedRecordCounts,
      useExpansions,
      totalRecordsRemaining,
      resourceName,
      expansionMetadata: {
        isExpansionBatch: true,
        parentPrimaryKey,
        parentResourceName
      }
    });
  }

  return expandedEntities;
};

const generateBatchOfEntities = ({
  dataGeneratorStateService,
  recordsToGenerate,
  fields,
  relatedRecordCounts,
  useExpansions,
  totalRecordsRemaining,
  resourceName,
  expansionMetadata: { isExpansionBatch = false, parentPrimaryKey = null, parentResourceName = null } = {}
}) => {
  const recordsByResource = { [resourceName]: [] };

  for (let i = 0; i < recordsToGenerate; i++) {
    const record = {};

    let recordPrimaryKey = null;
    Object.entries(fields).forEach(([fieldName, field]) => {
      const {
        type,
        typeName,
        isCollection,
        isExpansion,
        isLookupField,
        lookupValues,
        isPrimaryKey = false,
        isForeignKey = false,
        dependencyChain = null,
        copyOf = null,
        maxLength = 15,
        precision = 2
      } = field;
      if (isPrimaryKey) {
        // TODO: Numeric primary keys? Compound keys?
        const primaryKeyValue = getKeyValue();
        record[fieldName] = primaryKeyValue;
        recordPrimaryKey = primaryKeyValue;
      } else if (isForeignKey) {
        // Is this the parent key for one of the belongsTo relationships in the RESO spec
        if (
          isExpansionBatch &&
          parentPrimaryKey &&
          parentResourceName &&
          (fieldName === 'ResourceRecordKey' ||
            ((fieldName === PRIMARY_KEY_MAP[parentResourceName] || fieldName === `${parentResourceName}Key`) &&
              parentResourceName != resourceName))
        ) {
          record[fieldName] = parentPrimaryKey;
        } else if (dependencyChain) {
          if (!record[fieldName]) {
            setForeignKeyValue({
              fieldName,
              dependencyChain,
              record,
              fields,
              dataGeneratorStateService,
              resourceName
            });
          }
        } else {
          record[fieldName] = null;
        }
      } else if (isLookupField) {
        // TODO: support different enumeration types and use the legacyODataValues map when appropriate
        const values = Object.keys(lookupValues);
        record[fieldName] = getEnumerationValues({
          lookupName: type,
          count: isCollection ? 2 : 1,
          enumerationType: isCollection ? ENUMERATION_TYPES.StringMulti : ENUMERATION_TYPES.StringSingle,
          values
        });
      } else if (isExpansion) {
        const expandedValues = getExpandedValues({
          dataGeneratorStateService,
          relatedRecordCounts,
          useExpansions,
          totalRecordsRemaining,
          parentResourceName,
          resourceName: typeName,
          count: relatedRecordCounts[fieldName] || 1,
          parentPrimaryKey: recordPrimaryKey
        });

        if (expandedValues && expandedValues?.length) {
          // If these are not top-level resources, then they are not copies of existing records and must be tracked
          if (!TOP_LEVEL_RESOURCE_MAP[typeName]) {
            if (!recordsByResource[typeName]) recordsByResource[typeName] = [];
            recordsByResource[typeName].push(expandedValues);

            dataGeneratorStateService.trackGeneratedEntities(typeName, expandedValues);

            totalRecordsRemaining[typeName] -= expandedValues?.length;
          }

          if (useExpansions) {
            if (isCollection) record[fieldName] = expandedValues;
            else record[fieldName] = expandedValues[0];
          }
        }
      } else if (isExpansionBatch && parentResourceName && fieldName === 'ResourceName') {
        record[fieldName] = parentResourceName;
      } else if (copyOf) {
        const fieldToCopy = fields[copyOf];
        if (fieldToCopy && (record[copyOf] || record[copyOf] === 0)) {
          if (type === 'Edm.String') {
            record[fieldName] = record[copyOf]?.toString();
          } else if (type === 'Edm.Int32' || type === 'Edm.Int64') {
            const { type: originalType } = fieldToCopy;
            if (originalType === 'Edm.String') {
              record[fieldName] = parseInt(record[copyOf]);
            }
          }
        } else {
          console.error('Cannot copy field value.');
        }
      } else {
        // TODO: handle key, keynumeric, and string (based on maxLength)
        record[fieldName] =
          type === 'Edm.String'
            ? getStringValue({ maxLength })
            : type === 'Edm.Int32'
            ? getNumericValue({ max: precision })
            : type === 'Edm.Decimal'
            ? getNumericValue({ scale: 8, precision })
            : type === 'Edm.DateTimeOffset'
            ? getTimestampValue()
            : type === 'Edm.Date'
            ? getDateValue()
            : null;
      }
    });

    recordsByResource[resourceName].push(record);
  }

  dataGeneratorStateService.trackGeneratedEntities(resourceName, recordsByResource[resourceName]);

  totalRecordsRemaining[resourceName] -= recordsToGenerate;

  return recordsByResource;
};

const FIRST_BATCH_SIZE = 20;

async function* rcfGeneratorIterator({
  resourceNames,
  dataGeneratorStateService,
  metadataReportJson,
  resourceRecordCounts = {},
  relatedRecordCounts = {
    Media: 10,
    Rooms: 2,
    ListAgent: 1
  },
  useExpansions = false,
  batchSize = 1000
}) {
  const { metadataMap } = dataGeneratorStateService.getMetadataMap();

  const totalRecordsRemaining = { ...resourceRecordCounts };
  // const ListingKey = getKeyValue();

  if (!dataGeneratorStateService) {
    throw new Error('Data generator service instance is required!');
  }

  if ((metadataReportJson && !metadataReportJson?.fields?.length) || (false && !metadataReportJson?.lookups?.length)) {
    throw new Error('Invalid metadataReportJson passed to RCF data generator!');
  }

  if (useExpansions) {
    console.debug('useExpansions was passed, expanded data will be nested within each record.');
  }

  // Only loop through top-level resource names
  const topLevelResourceNames = resourceNames.filter(resourceName => TOP_LEVEL_RESOURCE_MAP[resourceName]);

  // Generate records until there are none left required for any resource
  while (Object.values(totalRecordsRemaining).some(count => count > 0)) {
    for (const resourceName of topLevelResourceNames) {
      const fields = metadataMap[resourceName];

      let recordsToGenerate = Math.min(batchSize, totalRecordsRemaining[resourceName] || 0);
      if (recordsToGenerate <= 0) continue;

      const resourceRecords = generateBatchOfEntities({
        dataGeneratorStateService,
        recordsToGenerate,
        fields,
        relatedRecordCounts,
        useExpansions,
        totalRecordsRemaining,
        resourceName,
        expansionMetadata: {}
      });

      yield resourceRecords;
    }
  }

  // TODO: check that generated records match these
  // const records = Object.freeze({
  //   Property: [
  //     {
  //       ListingKey,
  //       StandardStatus: getEnumerationValues({ lookupName: 'StandardStatus' }),
  //       InteriorFeatures: getEnumerationValues({
  //         lookupName: 'InteriorFeatures',
  //         count: 2,
  //         enumerationType: ENUMERATION_TYPES.StringMulti
  //       }),
  //       BedroomsTotal: getNumericValue({ max: 10 }),
  //       ListPrice: getNumericValue({ scale: 8, precision: 2 }),
  //       ListingContractDate: getDateValue(),
  //       ModificationTimestamp: getTimestampValue()
  //     }
  //   ],
  //   Media: [
  //     ...getExpandedValues({
  //       modelName: 'Media',
  //       resourceName: 'Property',
  //       resourceRecordKey: ListingKey,
  //       count: relatedRecordCounts.Media
  //     })
  //   ]
  // });
}

// TODO: fix relatedRecordCounts
const generateRcfData = async ({
  resourceNames = [],
  metadataReportJson = getReferenceMetadata(),
  useExpansions,
  resourceRecordCounts = {
    Property: 500,
    Media: 1000,
    Member: 200,
    Office: 20,
    Teams: 40,
    OUID: 1,
    TeamMembers: 200,
    Contacts: 400
  },
  relatedRecordCounts = {
    Media: 2
  },
  outputPath = null,
  fromCli = false,
  batchSize = 100
} = {}) => {
  try {
    if (fromCli && !(outputPath && outputPath?.length)) {
      throw new Error('outputPath is required when calling this function from the command line');
    }

    const dataGeneratorStateService = createDataGeneratorStateServiceInstance(metadataReportJson);
    const { metadataMap } = dataGeneratorStateService.getMetadataMap();

    // map of resourceName, array of RCF values
    const results = {};

    // Unless resourceNames is specified, generate data for all resource names
    if (!resourceNames.length) {
      resourceNames = Object.keys(metadataMap);
    }

    // TODO: determine actual use of resourceRecordCounts, and a better way to ensure all related data is available.
    // For now, this is necessary
    const necessaryResourceNames = Object.keys(resourceRecordCounts);

    // This order of generation is necessary for related data references
    const sortedResourceNames = [
      ...Object.keys(TOP_LEVEL_RESOURCE_MAP).filter(resource => necessaryResourceNames.includes(resource)),
      ...necessaryResourceNames.filter(resource => !(resource in TOP_LEVEL_RESOURCE_MAP))
    ];
    // const sortedResourceNames = [
    //   ...Object.keys(TOP_LEVEL_RESOURCE_MAP).filter(resource => resourceNames.includes(resource)),
    //   ...resourceNames.filter(resource => !(resource in TOP_LEVEL_RESOURCE_MAP))
    // ];

    const WRITE_RESULTS = !!(outputPath && outputPath?.length);

    if (WRITE_RESULTS) {
      await mkdir(outputPath, { recursive: true });
    }

    for await (const resourceData of rcfGeneratorIterator({
      resourceNames: sortedResourceNames,
      dataGeneratorStateService,
      metadataReportJson,
      resourceRecordCounts,
      relatedRecordCounts,
      useExpansions,
      batchSize
    })) {
      for (const [resourceName, data] of Object.entries(resourceData)) {
        if (!results[resourceName]) {
          results[resourceName] = [];
        }
        if (resourceNames.includes(resourceName)) {
          results[resourceName].push(...data);

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
                value: data ?? []
              })
            );
            await sleep(1);
          }
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
