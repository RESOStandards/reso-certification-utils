const { getMetadata } = require('@reso/reso-certification-etl/lib/common');
const { createReplicationStateServiceInstance, parseResoUrn, isValidValue } = require('../../common');
const { generateJsonSchema } = require('./generate');
const { getFormattedResourceName } = require('./utils');

const CUSTOM_TYPE = 'Custom Type';

const analyzeNumber = num => {
  const result = {};

  if (Number.isInteger(num)) {
    if (num >= -32768 && num <= 32767) {
      result.type = 'Edm.Int16';
    } else if (num >= -2147483648 && num <= 2147483647) {
      result.type = 'Edm.Int32';
    } else {
      result.type = 'Edm.Int64';
    }
  } else {
    result.type = 'Edm.Decimal';

    const [, decimal] = num.toString().split('.');
    result.scale = decimal ? decimal.length : 0;
    result.precision = num.toString().replace('.', '').length;
  }

  return result;
};
const inferType = value => {
  if (Array.isArray(value)) {
    const types = [];
    value.forEach(v => types.push(inferType(v)));
    const isExpansion = types.some(t => t.isExpansion);
    return { types, isCollection: true, isExpansion };
  }

  if (typeof value === 'boolean') {
    return { type: 'Edm.Boolean' };
  }

  if (typeof value === 'number') {
    return analyzeNumber(value);
  }

  if (typeof value === 'string') {
    return { type: 'Edm.String' };
  }

  if (value === null) {
    return { type: 'null', nullable: true };
  }

  if (typeof value === 'object') {
    return { type: 'object', isExpansion: true };
  }

  // unreachable
  throw Error('Unreachable code: Invalid Type');
};

const buildPayloadCache = (payload, cache, resourceName, metadataMap) => {
  payload = Array.isArray(payload?.value) ? payload.value : [payload].filter(Boolean);
  payload.forEach(v => {
    Object.entries(v).forEach(([key, value]) => {
      const metadata = metadataMap?.[resourceName]?.[key];
      const { isExpansion: isLocalExpansion } = inferType(value);
      if (metadata?.isExpansion) {
        buildPayloadCache(Array.isArray(value) ? { value } : value, cache, metadata?.typeName, metadataMap);
      } else if (isLocalExpansion) {
        buildPayloadCache(Array.isArray(value) ? { value } : value, cache, key, metadataMap);
      } else {
        if (!cache[resourceName]) {
          cache[resourceName] = {};
        }
        if (key.startsWith('@')) return;
        if (!cache[resourceName][key]) {
          cache[resourceName][key] = [];
        }
        if (isValidValue(value)) {
          cache[resourceName][key].push(value);
        }
      }
    });
  });
};

const generateDDReport = ({ daReport, schema, payloadCache }) => {
  const { MetadataMap } = schema.definitions || {};
  const { fields = [], lookupValues } = daReport || {};
  const ddFields = [],
    ddLookups = [];
  const localFields = [],
    localLookups = [];
  const lookupMap = {};
  lookupValues.forEach(l => {
    const { resourceName, fieldName, lookupValue } = l;
    const lookup =
      MetadataMap?.[resourceName]?.[fieldName]?.lookupValues?.[lookupValue] ??
      MetadataMap?.[resourceName]?.[fieldName]?.legacyODataValues?.[lookupValue] ??
      {};
    const { type: localLookupName } = MetadataMap?.[resourceName]?.[fieldName] ?? {};
    const isReso = Object.keys(lookup).length > 0;
    const { ddWikiUrl, type } = lookup;
    if (isReso && !lookupMap[`${type}-${lookupValue}`]) {
      const lookupObj = {
        lookupName: type,
        lookupValue,
        type: 'Edm.String',
        annotations: [
          {
            term: 'RESO.DDWikiUrl',
            value: ddWikiUrl
          }
        ]
      };
      lookupMap[`${type}-${lookupValue}`] = 1;
      ddLookups.push(lookupObj);
    } else {
      if (!lookupMap[`${localLookupName}-${lookupValue}`]) {
        localLookups.push({
          lookupName: localLookupName,
          lookupValue,
          type: 'Edm.String'
        });
        lookupMap[`${localLookupName}-${lookupValue}`] = 1;
      }
    }
  });
  fields.forEach(f => {
    const { resourceName, fieldName } = f;
    const isReso = !!MetadataMap?.[resourceName]?.[fieldName];
    const { ddWikiUrl, legacyODataValues, isLookupField, lookupValues, ...fieldMetadata } = MetadataMap?.[resourceName]?.[fieldName] ?? {};
    if (isReso) {
      const fieldObject = {
        fieldName,
        resourceName,
        ...fieldMetadata
      };
      ddFields.push(fieldObject);
    } else {
      if (!fieldName.startsWith('@')) localFields.push({ fieldName, resourceName });
    }
  });
  localFields.forEach(({ fieldName, resourceName }) => {
    const inferredMetadata = {
      resourceName,
      fieldName
    };
    payloadCache[resourceName]?.[fieldName]?.forEach(v => {
      const { type, types, isCollection, nullable, scale, precision, isExpansion } = inferType(v);
      if (isCollection) {
        inferredMetadata.isCollection = true;
        const typeNames = [...new Set(types.map(t => t.type))];
        if (typeNames.length > 2) {
          throw new Error('Impossible condition found');
        }
        if (typeNames.includes('null') || nullable) {
          inferredMetadata.nullable = true;
        }
        const nonNullTypes = typeNames.filter(x => x !== 'null');
        if (nonNullTypes.includes('object')) {
          inferredMetadata.isExpansion = true;
        }
        // eslint-disable-next-line prefer-destructuring
        inferredMetadata.type = nonNullTypes[0];
      } else {
        if (type === 'null') return;
        if (type?.startsWith('Edm.Int')) {
          if (!inferredMetadata.type || inferredMetadata.type < type) {
            inferredMetadata.type = type;
          }
        } else {
          inferredMetadata.type = type;
        }
        if (isExpansion) {
          inferredMetadata.isExpansion = true;
          inferredMetadata.type = CUSTOM_TYPE;
        }
        if (nullable) {
          inferredMetadata.nullable = nullable;
        }
        if (scale) {
          if (!inferredMetadata.scale || inferredMetadata.scale < scale) {
            inferredMetadata.scale = scale;
          }
        }
        if (precision) {
          if (!inferredMetadata.precision || inferredMetadata.precision < precision) {
            inferredMetadata.precision = precision;
          }
        }
        if (type === 'Edm.String') {
          const { length } = v;
          if (!inferredMetadata.maxLength || inferredMetadata.maxLength < length) {
            inferredMetadata.maxLength = length;
          }
        }
      }
    });
    if (payloadCache[resourceName]?.[fieldName]) {
      ddFields.push(inferredMetadata);
    }
  });
  return {
    description: 'RESO Data Dictionary Metadata Report',
    generatedOn: new Date().toISOString(),
    version: daReport.version,
    fields: ddFields,
    lookups: [...ddLookups, ...localLookups]
  };
};

const expansionInfoFromPayload = ({ payload, resourceName, metadataMap }) => {
  const expansionInfoMap = {};
  payload = Array.isArray(payload.value) ? payload.value : [payload];
  payload.forEach(p => {
    Object.entries(p).forEach(([fieldName, value]) => {
      const metadata = metadataMap?.[resourceName]?.[fieldName];
      const { isExpansion: isLocalExpansion, isCollection } = inferType(value);
      if (metadata?.isExpansion) {
        const modelName = metadata?.typeName;
        if (!expansionInfoMap[modelName]) {
          expansionInfoMap[modelName] = {};
        }
        if (!expansionInfoMap[modelName][fieldName]) {
          expansionInfoMap[modelName][fieldName] = { isCollection: metadata?.isCollection, type: metadata?.type };
        }
      } else if (isLocalExpansion) {
        const modelName = fieldName;
        if (!expansionInfoMap[modelName]) {
          expansionInfoMap[modelName] = {};
        }
        if (!expansionInfoMap[modelName][fieldName]) {
          expansionInfoMap[modelName][fieldName] = { isCollection: isCollection, type: CUSTOM_TYPE };
        }
      }
    });
  });
  return Object.entries(expansionInfoMap).flatMap(([modelName, value]) =>
    Object.entries(value).map(([fieldName, { isCollection, type }]) => ({ fieldName, modelName, isCollection, type }))
  );
};

const generateRcfReports = async ({ payloadMap }) => {
  const { scorePayload, consolidateResults } = require('../replication/utils');

  const { version } = parseResoUrn(Object.keys(payloadMap)[0]);
  const replicationInstance = createReplicationStateServiceInstance();

  const metadataReport = getMetadata(version);
  replicationInstance.setMetadataMap(metadataReport);
  const schema = await generateJsonSchema({
    metadataReportJson: metadataReport
  });
  const expansionFields = [];
  const payloadCache = {};
  Object.entries(payloadMap).forEach(([context, payload]) => {
    const { resource } = parseResoUrn(context);
    const formattedResourceName = getFormattedResourceName(resource, version);
    const expansionInfo = expansionInfoFromPayload({
      payload,
      resourceName: formattedResourceName,
      metadataMap: schema.definitions.MetadataMap
    });
    expansionInfo.forEach(({ fieldName, isCollection, modelName, type }) => {
      expansionFields.push({
        resourceName: formattedResourceName,
        fieldName,
        typeName: modelName,
        isCollection,
        isExpansion: true,
        type
      });
    });
    scorePayload({
      expansionInfo: expansionInfo,
      jsonData: payload,
      replicationStateServiceInstance: replicationInstance,
      resourceName: formattedResourceName
    });
    buildPayloadCache(payload, payloadCache, formattedResourceName, schema.definitions.MetadataMap);
  });

  const daReport = {
    description: 'RESO Data Availability Report',
    version,
    generatedOn: new Date().toISOString(),
    ...consolidateResults({
      resourceAvailabilityMap: replicationInstance.getResourceAvailabilityMap(),
      responses: replicationInstance.getResponses(),
      topLevelResourceCounts: replicationInstance.getTopLevelResourceCounts()
    })
  };

  const { daFields, daMap } = daReport.fields.reduce(
    (acc, field) => {
      const { resourceName, fieldName } = field;
      if (!acc.daMap[`${resourceName}-${fieldName}`] && !fieldName?.startsWith('@')) {
        acc.daMap[`${resourceName}-${fieldName}`] = 1;
        acc.daFields.push(field);
      }
      return acc;
    },
    { daMap: {}, daFields: [] }
  );
  daReport.fields = daFields;

  const ddReport = generateDDReport({ daReport, schema, payloadCache });

  expansionFields.forEach(f => {
    const { resourceName, fieldName } = f;
    if (daReport?.fields?.length && !daMap[`${resourceName}-${fieldName}`]) {
      daReport.fields.push({
        resourceName,
        fieldName,
        frequency: 1
      });
    }

    ddReport.fields.push(f);
  });

  return { ddReport, daReport };
};

module.exports = {
  generateRcfReports
};
