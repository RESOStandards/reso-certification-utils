const { getMetadata } = require('@reso/reso-certification-etl/lib/common');
const { createReplicationStateServiceInstance, parseResoUrn, isValidValue, buildMetadataMap } = require('../../common');
const { getFormattedResourceName, isValidIsoDateTimeOffset, isValidIsoDate } = require('./utils');

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
    if (isValidIsoDate(value)) {
      return { type: 'Edm.Date' };
    }
    if (isValidIsoDateTimeOffset(value)) {
      return { type: 'Edm.DateTimeOffset' };
    }
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

function areEnumsStringType(enums) {
  // If at least one enumerated value in the field doesn't
  // match the identifier regex, classify the field as
  // Edm.String (return true).
  //
  // "[\p{L}\p{Nl}_][\p{L}\p{Nl}\p{Nd}\p{Mn}\p{Mc}\p{Pc}\p{Cf}]{0,}"
  const identifierRegex = new RegExp('^[\\p{L}\\p{Nl}_][\\p{L}\\p{Nl}\\p{Nd}\\p{Mn}\\p{Mc}\\p{Pc}\\p{Cf}]{0,}$', 'u');

  const hasNonMatching = enums.some(enm => !identifierRegex.test(enm));

  return hasNonMatching;
}

const generateDDReport = ({ daReport, metadataMap, payloadCache, expansionFields }) => {
  const { fields = [], lookupValues } = daReport || {};
  const ddFields = [],
    ddLookups = [];
  const localFields = [],
    localLookups = [];
  const localFieldLookups = [];
  const lookupMap = {};
  const stringOrLegacyOdataClassificationMap = Object.entries(payloadCache).reduce((acc, [resourceName, fieldMap]) => {
    Object.entries(fieldMap).forEach(([fieldName, values]) => {
      const isEnumType = values.length > 0 && values.filter(Boolean).every(v => typeof v === 'string');
      const isStringType = isEnumType && areEnumsStringType(values.filter(Boolean).filter(v => typeof v === 'string'));
      if (isStringType) {
        acc[`${resourceName}-${fieldName}`] = 'Edm.String';
      } else {
        acc[`${resourceName}-${fieldName}`] = 'Edm.Int64';
      }
    });
    return acc;
  }, {});
  lookupValues.forEach(l => {
    const { resourceName, fieldName, lookupValue } = l;
    const lookup =
      metadataMap?.[resourceName]?.[fieldName]?.lookupValues?.[lookupValue] ??
      metadataMap?.[resourceName]?.[fieldName]?.legacyODataValues?.[lookupValue] ??
      {};
    const { type: localLookupName } = metadataMap?.[resourceName]?.[fieldName] ?? {};
    const isReso = Object.keys(lookup).length > 0;
    const { ddWikiUrl, type } = lookup;
    const inferredType = stringOrLegacyOdataClassificationMap[`${resourceName}-${fieldName}`];
    if (isReso && !lookupMap[`${type}-${lookupValue}`]) {
      const lookupObj = {
        lookupName: type,
        lookupValue,
        type: inferredType,
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
      if (!!localLookupName && !lookupMap[`${localLookupName}-${lookupValue}`]) {
        localLookups.push({
          lookupName: localLookupName,
          lookupValue,
          type: inferredType
        });
        lookupMap[`${localLookupName}-${lookupValue}`] = 1;
      }
    }
  });
  fields.forEach(f => {
    const { resourceName, fieldName } = f;
    const isReso = !!metadataMap?.[resourceName]?.[fieldName];
    const { ddWikiUrl, legacyODataValues, isLookupField, lookupValues, ...fieldMetadata } = metadataMap?.[resourceName]?.[fieldName] ?? {};
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
    const payloadValues = payloadCache[resourceName]?.[fieldName] || [];
    let inferredLocalEnumType;

    // If this is a local field with repeated non-null values,
    // treat it as a local enumeration and set type to
    // `${resourceName}.${fieldName}`.
    const uniqueNonNullValues = [
      ...new Set(payloadValues.filter(v => typeof v === 'string' && Number.isNaN(Number(v)) && isValidValue(v)))
    ];
    const shouldTreatAsLocalEnum =
      uniqueNonNullValues.length > 1 &&
      payloadValues.length > uniqueNonNullValues.length &&
      uniqueNonNullValues.every(v => inferType(v)?.type === 'Edm.String');
    if (shouldTreatAsLocalEnum) {
      const lookupName = `${resourceName}.${fieldName}`;
      inferredLocalEnumType = lookupName;
      inferredMetadata.type = lookupName;

      const inferredType = stringOrLegacyOdataClassificationMap[`${resourceName}-${fieldName}`];
      uniqueNonNullValues.forEach(lookupValue => {
        if (!lookupMap[`${lookupName}-${lookupValue}`]) {
          localFieldLookups.push({
            lookupName,
            lookupValue,
            type: inferredType
          });
          lookupMap[`${lookupName}-${lookupValue}`] = 1;
        }
      });
    }

    payloadValues.forEach(v => {
      const { type, types, isCollection, nullable, scale, precision, isExpansion } = inferType(v);
      if (isCollection) {
        inferredMetadata.isCollection = true;
        const typeNames = [...new Set(types.map(t => t.type))];
        if (typeNames.length > 2) {
          return;
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
          if (!(inferredLocalEnumType && type === 'Edm.String')) {
            inferredMetadata.type = type;
          }
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
  const ddReport = {
    description: 'RESO Data Dictionary Metadata Report',
    generatedOn: new Date().toISOString(),
    version: daReport.version,
    fields: ddFields,
    lookups: [...ddLookups, ...localLookups, ...localFieldLookups]
  };

  addExpansionFieldsToDDReport(ddReport, expansionFields);
  return ddReport;
};

const addExpansionFieldsToDAReport = ({ daReport, expansionFields, daMap }) => {
  daReport = {
    ...daReport,
    fields: [...daReport.fields]
  };
  expansionFields.forEach(f => {
    const { resourceName, fieldName } = f;
    if (daReport?.fields?.length && !daMap[`${resourceName}-${fieldName}`]) {
      daReport.fields.push({
        resourceName,
        fieldName,
        frequency: 1
      });
    }
  });
  return daReport;
};

const addExpansionFieldsToDDReport = (ddReport, expansionFields) => {
  expansionFields.forEach(f => {
    ddReport.fields.push(f);
  });
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

const generateDAReport = payloadMap => {
  const { scorePayload, consolidateResults } = require('../replication/utils');

  const { version } = parseResoUrn(Object.keys(payloadMap)[0]);
  const replicationInstance = createReplicationStateServiceInstance();

  const metadataReport = getMetadata(version);
  replicationInstance.setMetadataMap(metadataReport);
  const { metadataMap = {} } = buildMetadataMap(metadataReport);
  const expansionFields = [];
  const payloadCache = {};
  Object.entries(payloadMap).forEach(([context, payload]) => {
    const { resource } = parseResoUrn(context);
    const formattedResourceName = getFormattedResourceName(resource, version);
    const expansionInfo = expansionInfoFromPayload({
      payload,
      resourceName: formattedResourceName,
      metadataMap
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
    buildPayloadCache(payload, payloadCache, formattedResourceName, metadataMap);
  });

  const localEnumLookupValues = Object.entries(payloadCache).flatMap(([resourceName, fieldMap]) =>
    Object.entries(fieldMap).flatMap(([fieldName, payloadValues]) => {
      if (metadataMap?.[resourceName]?.[fieldName]?.type?.startsWith('Edm.')) return [];

      const uniqueNonNullValues = [
        ...new Set(payloadValues.filter(v => typeof v === 'string' && Number.isNaN(Number(v)) && isValidValue(v)))
      ];
      const shouldTreatAsLocalEnum =
        uniqueNonNullValues.length > 1 &&
        payloadValues.length > uniqueNonNullValues.length &&
        uniqueNonNullValues.every(v => inferType(v)?.type === 'Edm.String');
      if (!shouldTreatAsLocalEnum) return [];

      return uniqueNonNullValues.map(lookupValue => ({
        resourceName,
        fieldName,
        lookupValue,
        frequency: payloadValues.filter(v => v === lookupValue).length
      }));
    })
  );

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

  const { daLookups } = daReport.lookupValues.reduce(
    (acc, field) => {
      const { resourceName, fieldName, lookupValue } = field;
      const { type } = metadataMap[resourceName]?.[fieldName] ?? {};
      if (!acc.daMap[`${type}-${lookupValue}`]) {
        acc.daMap[`${type}-${lookupValue}`] = 1;
        acc.daLookups.push(field);
      }
      return acc;
    },
    { daMap: {}, daLookups: [] }
  );
  daReport.lookupValues = daLookups;

  if (localEnumLookupValues.length) {
    const existing = new Set(daReport.lookupValues.map(l => `${l.resourceName}-${l.fieldName}-${l.lookupValue}`));
    localEnumLookupValues.forEach(l => {
      const key = `${l.resourceName}-${l.fieldName}-${l.lookupValue}`;
      if (!existing.has(key)) {
        daReport.lookupValues.push(l);
        existing.add(key);
      }
    });
  }

  const daReportWithExpansions = addExpansionFieldsToDAReport({ daReport, expansionFields, daMap });
  return { daReport: daReportWithExpansions, expansionFields, payloadCache, daMap, metadataMap, daReportWithoutExpansions: daReport };
};

const generateRcfReports = async payloadMap => {
  const { daReport, payloadCache, metadataMap, expansionFields, daReportWithoutExpansions } = generateDAReport(payloadMap);
  const ddReport = generateDDReport({ daReport: daReportWithoutExpansions, metadataMap, payloadCache, expansionFields });

  return { ddReport, daReport };
};

module.exports = {
  generateRcfReports,
  generateDAReport,
  generateDDReport
};
