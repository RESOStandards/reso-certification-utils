const { faker } = require('@faker-js/faker');

const { TOP_LEVEL_RESOURCE_MAP, RESO_KEY_DEPENDENCY_MAP, ALTERNATE_KEY_SUFFIXES, PRIMARY_KEY_MAP } = require('./constants');

const getKeyValue = ({ keyLength = 32 } = {}) => faker.string.alpha(keyLength);

/**
 * Adds key and expansion metadata necessary for referential integrity
 *
 * @param {Object} baseMetadataMap a metadata map built using common library function
 * @returns extended metadata map
 */
const extendMetadataMap = (
  baseMetadataMap = null,
  topLevelResourceMap = TOP_LEVEL_RESOURCE_MAP,
  resoKeyDependencyMap = RESO_KEY_DEPENDENCY_MAP,
  alternateKeySuffixes = ALTERNATE_KEY_SUFFIXES,
  primaryKeyMap = PRIMARY_KEY_MAP
) => {
  if (!baseMetadataMap) {
    return {};
  }

  const extendedMetadataMap = {};

  // TODO: Sorting here is unnecessary
  // Sort resources based on TOP_LEVEL_RESOURCE_MAP, as the order ensures related data is available
  const sortedResources = [
    ...Object.keys(topLevelResourceMap).filter(resource => resource in baseMetadataMap),
    ...Object.keys(baseMetadataMap).filter(resource => !(resource in topLevelResourceMap))
  ];

  sortedResources.forEach(resourceName => {
    const resourceFields = baseMetadataMap[resourceName];
    const extendedFields = {};

    Object.entries(resourceFields).forEach(([fieldName, field]) => {
      // Clone to avoid mutating original
      const extendedField = { ...field };

      // Add relationship medadata to Key fields
      if (fieldName.endsWith('Key')) {
        const isPrimaryKey = primaryKeyMap[resourceName] === fieldName || fieldName === `${resourceName}Key`;

        if (isPrimaryKey) {
          extendedField.isPrimaryKey = true;
        } else {
          extendedField.isForeignKey = true;

          // Check for dependency chain in RESO_KEY_DEPENDENCY_MAP, otherwise set dynamically
          if (resoKeyDependencyMap[resourceName]?.[fieldName]) {
            extendedField.dependencyChain = resoKeyDependencyMap[resourceName][fieldName];
          } else {
            const expansionFieldName = fieldName.replace(/Key$/, '');
            const expansionField = resourceFields[expansionFieldName];

            const foreignResource = expansionField?.isExpansion ? expansionField.typeName : expansionFieldName;

            const foreignResourcePrimaryKey = primaryKeyMap[foreignResource] || `${foreignResource}Key`;

            extendedField.dependencyChain = `${foreignResource}.${foreignResourcePrimaryKey}`;
          }
        }
      }

      // Add metadata to alternate keys (e.g. ListingKeyNumeric is copy of ListingKey)
      const alternateKeySuffix = alternateKeySuffixes.find(suffix => fieldName.endsWith(suffix));
      if (alternateKeySuffix) {
        const primaryKeyFieldName = fieldName.replace(new RegExp(`${alternateKeySuffix}$`), 'Key');

        if (resourceFields[primaryKeyFieldName]) {
          extendedField.copyOf = primaryKeyFieldName;
        }
      }

      // Add metadata to expansion fields
      if (field.isExpansion) {
        const isTopLevel = topLevelResourceMap[field.type] || false;
        extendedField.fromExisting = isTopLevel;

        if (isTopLevel) {
          const sourceKeyFieldName = `${fieldName}Key`;
          extendedField.sourceKey = resourceFields[sourceKeyFieldName] ? sourceKeyFieldName : null;
        }
      }

      extendedFields[fieldName] = extendedField;
    });

    extendedMetadataMap[resourceName] = extendedFields;
  });

  return extendedMetadataMap;
};

const mergeArraysInObjects = (...objects) => {
  return objects.reduce((result, current) => {
    for (const [key, value] of Object.entries(current)) {
      if (Array.isArray(value)) {
        result[key] = [...(result[key] || []), ...value];
      } else {
        result[key] = value;
      }
    }
    return result;
  }, {});
};

const resolveDependencyChain = ({ dependencyChain, record, fields, dataGeneratorStateService, localResource }) => {
  const parseChain = chain => {
    // Parse our dependency chain strings into a structured format
    const match = chain.match(/^(\w+)(?:\((\w+)(?::(\w+))?\))?\.(\w+)$/);
    if (!match) throw new Error(`Invalid dependency chain format: ${chain}`);

    const [_, resource, localField, foreignKey, targetField] = match;
    return { resource, localField, foreignKey, targetField };
  };

  const resolveChainRecursively = chain => {
    const { resource, localField, foreignKey, targetField } = parseChain(chain);

    // Resolve local value (field in the current record)
    let localValue = null;
    if (localField) {
      if (!record[localField]) {
        // If local field hasn't been created, resolve it using its dependency chain
        const dependentField = fields[localField];

        if (dependentField?.dependencyChain) {
          record[localField] = resolveChainRecursively(dependentField.dependencyChain);
        } else {
          if (PRIMARY_KEY_MAP[localResource] === localField || `${localResource}Key` === localField) {
            record[localField] = getKeyValue();
          } else {
            throw new Error(`Missing value for local field "${localField}" in dependency chain`);
          }
        }
      }
      localValue = record[localField];
    }

    // Query the recently generated entities of the required resource
    const recentEntities = dataGeneratorStateService.getTrackedEntities(resource);
    if (!recentEntities.length) {
      return null;
      // throw new Error(`No recently generated entities found for resource "${resource}"`);
    }

    // Find the matching record in the foreign resource
    let matchingRecord = null;
    if (foreignKey) {
      matchingRecord = recentEntities.find(entity => entity[foreignKey] === localValue);
    } else {
      matchingRecord = faker.helpers.arrayElement(recentEntities);
    }

    if (!matchingRecord) {
      return null;

      // TODO: Fix this issue, example: sometimes a Team has no Team Members and thus no agents available for ListTeamKey
      // throw new Error(`No matching record found in "${resource}" for dependency chain "${chain}"`);
    }

    return matchingRecord[targetField];
  };

  return resolveChainRecursively(dependencyChain);
};

const setForeignKeyValue = ({ fieldName, dependencyChain, record, fields, dataGeneratorStateService, resourceName }) => {
  try {
    record[fieldName] = resolveDependencyChain({
      dependencyChain,
      record,
      fields,
      dataGeneratorStateService,
      localResource: resourceName
    });
  } catch (err) {
    console.error(`Failed to resolve foreign key for field "${fieldName}": ${err.message}`);
    record[fieldName] = null;
  }
};

module.exports = {
  extendMetadataMap,
  mergeArraysInObjects,
  setForeignKeyValue,
  getKeyValue
};
