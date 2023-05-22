const { pascalCase } = require('pascal-case');
const { getReferenceMetadata } = require('reso-certification-etl');
const { writeFile } = require('fs/promises');

const ANNOTATION_STANDARD_NAME = 'RESO.OData.Metadata.StandardName';

const generatePascalCaseODataValuesFromReferenceMetadata = async (version = '1.7') => {
  const { resources = [], fields = [], lookups = [] } = getReferenceMetadata(version);

  const PROCESSED = {
    resources: resources.flatMap(({ resourceName }) => {
      if (!resourceName) return [];

      const processedResourceName = pascalCase(resourceName);

      if (processedResourceName !== resourceName) {
        return {
          ResourceName: resourceName,
          CorrectedResourceName: processedResourceName
        };
      } else {
        return [];
      }
    }),
    fields: fields.flatMap(({ resourceName, fieldName }) => {
      if (!(resourceName && fieldName)) return [];

      const processedResourceName = pascalCase(resourceName),
        processedFieldName = pascalCase(fieldName);

      if (processedFieldName !== fieldName) {
        return {
          ResourceName: processedResourceName,
          StandardName: fieldName,
          CorrectedStandardName: processedFieldName
        };
      } else {
        return [];
      }
    }),
    lookups: lookups.flatMap(({ lookupName, lookupValue: legacyODataValue, annotations = [] }) => {
      const { lookupValue, displayName } =
        annotations?.reduce((acc, { term, value }) => {
          if (term === ANNOTATION_STANDARD_NAME) {
            // if (false && !value.match(/^[0-9a-z]+$/)) {
            //   acc.lookupValue = value;
            // } else {
            acc.lookupValue = value
              ?.replace('(s)', 's')
              ?.replace('(S)', 's')
              ?.replace('&', 'And')
              ?.replace('$', 'Dollar')
              ?.replace('%', 'Percent');
          }

          acc.displayName = value;
          //}
          return acc;
        }, {}) || {};

      if (!(lookupName && lookupValue)) return [];

      const processedLookupName = pascalCase(lookupName?.substring(lookupName.lastIndexOf('.') + 1)),
        processedLegacyODataValue = pascalCase(lookupValue);

      if (processedLegacyODataValue !== legacyODataValue) {
        return {
          LookupName: processedLookupName,
          LegacyODataValue: legacyODataValue,
          CorrectedLegacyODataValue: processedLegacyODataValue,
          DisplayName: displayName
        };
      } else {
        return [];
      }
    })
  };
  await writeFile(`pascal-case-metadata-dd-${version}.json`, Buffer.from(JSON.stringify(PROCESSED, null, '  ')));
};

module.exports = {
  generatePascalCaseODataValuesFromReferenceMetadata
};
