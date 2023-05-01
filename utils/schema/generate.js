function createDefinitions(resources, lookups) {
  const typeMappings = {
    'Edm.String': 'string',
    'Edm.Boolean': 'boolean',
    'Edm.Int16': 'integer',
    'Edm.Int32': 'integer',
    'Edm.Int64': 'integer',
    'Edm.Decimal': 'number',
    'Edm.Single': 'number',
    'Edm.Double': 'number',
    'Edm.DateTimeOffset': 'string',
    'Edm.Date': 'string'
  };

  // Preprocess the lookups data to create a hashmap
  const lookupsMap = {};
  lookups.forEach(lookup => {
    if (!lookupsMap[lookup.lookupName]) {
      lookupsMap[lookup.lookupName] = new Set();
    }
    lookupsMap[lookup.lookupName].add(lookup.lookupValue);
  });

  function getPossibleValuesForNamespacedType(lookupName) {
    const possibleValues = lookupsMap[lookupName];
    return possibleValues ? [...possibleValues] : [];
  }

  const definitions = {};

  for (const [resourceName, resourceFields] of Object.entries(resources)) {
    const properties = {};

    resourceFields.forEach(field => {
      const { fieldName } = field;
      let schema = {};
      if (field.isExpansion || field.isCollection) {
        const itemTypeSchema = {};

        if (field.isExpansion) {
          itemTypeSchema['$ref'] = `#/definitions/${field.typeName}`;
        } else {
          const mappedType = typeMappings[field.type] || 'object';
          itemTypeSchema['type'] = mappedType;
          if (field.maxLength) itemTypeSchema['maxLength'] = field.maxLength;
          if (field.type === 'Edm.DateTimeOffset') itemTypeSchema['format'] = 'date-time';
          if (field.type === 'Edm.Date') itemTypeSchema['format'] = 'date';

          // probably needs to be another condition?
          if (field.type.startsWith('org.reso.metadata')) {
            const possibleValues = getPossibleValuesForNamespacedType(field.type);
            if (possibleValues.length > 0) {
              itemTypeSchema['enum'] = possibleValues;
              itemTypeSchema['type'] = 'string';
            }
          }
        }

        if (field.isCollection) {
          schema['type'] = 'array';
          schema['items'] = itemTypeSchema;
        } else {
          schema = itemTypeSchema;
        }

        if (field.nullable) schema['nullable'] = field.nullable;
      } else {
        const fieldType = typeMappings[field.type] || 'object';
        schema['type'] = fieldType;

        if (field.nullable) schema['nullable'] = field.nullable;
        if (field.maxLength) schema['maxLength'] = field.maxLength;
        // do we need any special treatment for dates?
        if (field.type === 'Edm.DateTimeOffset') schema['format'] = 'date-time';
        if (field.type === 'Edm.Date') schema['format'] = 'date';

        if (field.type.startsWith('org.reso.metadata')) {
          const possibleValues = getPossibleValuesForNamespacedType(field.type);
          if (possibleValues.length > 0) {
            schema['enum'] = possibleValues;
            schema['type'] = 'string';
          }
        }
      }
      properties[fieldName] = schema;
    });

    definitions[resourceName] = {
      type: 'object',
      properties,
      additionalProperties: false
    };
  }

  return definitions;
}

function createSchema(resources, lookups) {
  const definitions = createDefinitions(resources, lookups);
  const rootResources = [...new Set(Object.keys(resources))];

  const anyOfResources = rootResources.map(resource => {
    return {
      $ref: `#/definitions/${resource}`
    };
  });

  const schema = {
    $schema: 'http://json-schema.org/draft-07/schema#',
    type: 'object',
    properties: {
      '@reso.context': {
        type: 'string'
      },
      value: {
        type: 'array',
        items: {
          anyOf: anyOfResources
        }
      }
    },
    additionalProperties: false,
    definitions: definitions
  };

  return schema;
}

function getResourcesFromMetadata(metadata) {
  const resources = {};

  metadata.fields.forEach(field => {
    const { resourceName } = field;

    if (!resources[resourceName]) {
      resources[resourceName] = [];
    }

    resources[resourceName].push(field);
  });

  return resources;
}

function generateSchema(metadataJson) {
  try {
    const resources = getResourcesFromMetadata(metadataJson);
    const schema = createSchema(resources, metadataJson?.lookups);
    return schema;
  } catch (err) {
    console.log(err);
    return null;
  }
}

module.exports = {
  generateSchema
};
