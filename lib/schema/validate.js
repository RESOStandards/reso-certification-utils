'use strict';

const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const chalk = require('chalk');
const ajvErrors = require('ajv-errors');

const ajv = new Ajv({ allErrors: true, coerceTypes: false, strict: true });
addFormats(ajv);
ajvErrors(ajv);

const determineType = value => {
  if (value === null) {
    return 'null';
  }

  if (Array.isArray(value)) {
    return 'array';
  }

  // Distinguishing between integers and other numbers is not strictly possible in JS as all numbers are floating point
  // But we can use a simple workaround to make the distinction
  if (typeof value === 'number') {
    if (Number.isInteger(value)) {
      return 'integer';
    } else {
      return 'decimal';
    }
  }

  // Other types (boolean and string) are covered by 'typeof'
  return typeof value;
};

const addPayloadError = (resource, fileName, message, payloadErrors) => {
  resource = resource || '_INVALID_';
  if (!payloadErrors[resource]) {
    payloadErrors[resource] = {};
  }
  if (!payloadErrors[resource][message]) {
    payloadErrors[resource][message] = [];
  }
  payloadErrors[resource][message].push(fileName);
  return payloadErrors;
};

/**
 We can maybe expose a method from ETL lib that gives us the current valid DD version.
 This would mean that we only have to update the ETL lib to support newer version of DD.
 * */

const SUPPORTED_DD_VERSIONS = {
  DD_1_7: '1.7',
  DD_2_0: '2.0'
};

const DEFAULT_DD_VERSION = SUPPORTED_DD_VERSIONS.DD_1_7;

const getValidDdVersions = () => Object.values(SUPPORTED_DD_VERSIONS ?? {});
const isValidDdVersion = (version = '') => getValidDdVersions()?.includes(version);

const validate = ({ jsonSchema = {}, resourceName = 'Property', jsonPayload, errorMap = {}, fileName = '', ddVersion }) => {
  const { stats = { totalErrors: 0, totalWarnings: 0 }, cache = {}, errorCache = {}, warningsCache = {}, payloadErrors = {} } = errorMap;
  const schema = jsonSchema;
  const oldOneOf = structuredClone(schema.oneOf);
  const payload = jsonPayload;

  let validPayload = true;
  /**
   * Step 1 - Analyze the payload and parse out the relevant data like the version, resourceName, etc.
   *
   * Using this additional info we can improve our generated schema by providing a resource against which
   * the payload should be validated.
   */
  /* */
  try {
    if (!payload['@reso.context']) {
      if (!ddVersion) {
        validPayload = false;
        throw new Error('Version is required for payloads without "@reso.context" property');
      }
      if (!Object.keys(payload).some(k => k.startsWith('@odata.'))) {
        validPayload = false;
        throw new Error('No properties were found on the payload that match "@reso.context|@odata."');
      }
    }
    const { resource, version } = getResourceAndVersion({
      payload,
      resource: resourceName,
      version: ddVersion
    });

    resourceName = resource;

    if (!isValidDdVersion(version)) {
      console.log(chalk.redBright(`Found invalid DD version ${version} - Supported versions are ${getValidDdVersions()}`));
      addPayloadError(`${resource[0].toUpperCase()}${resource.slice(1)}`, fileName, 'Invalid version', payloadErrors);
    }

    ddVersion = isValidDdVersion(version) ? version : DEFAULT_DD_VERSION;

    const { definitions } = schema;
    const singleValueSchema = schema?.oneOf?.find(s => !s.properties.value);
    const multiValueSchema = schema?.oneOf?.find(s => s.properties.value);

    const formattedResourceName = Object.keys(definitions ?? {}).find(r => r.toLowerCase() === resource.toLowerCase());
    if (!formattedResourceName) {
      console.log(chalk.redBright(`Found invalid resource: ${formattedResourceName}`));
      addPayloadError(formattedResourceName, fileName, 'Invalid resource', payloadErrors);
      return errorMap;
    }
    resourceName = formattedResourceName;
    if (!payload.value) {
      schema.oneOf = [singleValueSchema];
      // extend the generated schema with new info from the specific payload
      Object.assign(singleValueSchema.properties, definitions[formattedResourceName].properties);
    } else {
      schema.oneOf = [multiValueSchema];
      multiValueSchema.properties.value.items = {
        $ref: `#/definitions/${formattedResourceName}`
      };
    }
  } catch (error) {
    console.error(chalk.redBright.bold('ERROR: ' + error.message));
    addPayloadError(resourceName, fileName, error.message, payloadErrors);
  }

  if (!validPayload) return errorMap;

  // Step 2 - Validate with AJV and generate error report
  const [selectedSchema] = schema.oneOf;
  const additionalPropertiesAllowed = selectedSchema.properties.value
    ? schema.definitions[Object.keys(schema.definitions)[0]].additionalProperties
    : selectedSchema.additionalProperties;

  const validate = ajv.compile(schema);
  const valid = validate(payload);

  // Update the error message in case of type mismatch
  if (!valid) {
    for (const error of validate.errors) {
      if (error.keyword === 'type') {
        const nestedPayloadProperties = error?.instancePath?.split('/')?.slice(1) || [];

        let resolvedKeyword = error.keyword;
        if (error.keyword === 'errorMessage') {
          resolvedKeyword = error?.params?.errors?.[0]?.keyword || resolvedKeyword;
        }
        // find corresponding value in the payload
        let failedItemValue = nestedPayloadProperties.reduce((acc, curr) => {
          if (!acc && payload[curr]) return payload[curr];
          return acc[curr];
        }, null);

        // additional property errors need to be transformed in or else they will pollute the final error output.
        if (failedItemValue?.['constructor'] === Object && resolvedKeyword === 'additionalProperties') {
          failedItemValue = 'additionalProperties';
        }
        const schemaType = error?.params?.type;
        const schemaTypeFormatted = Array.isArray(error?.params?.type) ? schemaType.join(' or ') : schemaType;
        error.message = `MUST be ${schemaTypeFormatted} but found ${determineType(failedItemValue)}`;
      }
    }
    generateErrorReport({
      validate,
      json: payload,
      additionalPropertiesAllowed,
      resourceName,
      errorCache,
      warningsCache,
      cache,
      stats,
      fileName
    });
  }
  schema.oneOf = oldOneOf;
  return {
    ...errorMap,
    errorCache,
    warningsCache,
    cache,
    stats,
    payloadErrors
  };
};

const validatePayload = ({ payloads = {}, schema, resourceNameFromArgs = '', versionFromArgs }) => {
  const payloadErrors = {};
  const cache = {};
  const errorCache = {};
  const warningsCache = {};
  const stats = {
    totalErrors: 0,
    totalWarnings: 0
  };

  let errorMap = {
    payloadErrors,
    cache,
    errorCache,
    warningsCache,
    stats
  };

  Object.entries(payloads).forEach(([fileName, payload]) => {
    errorMap = validate({
      ddVersion: versionFromArgs,
      jsonPayload: payload,
      fileName,
      errorMap,
      jsonSchema: schema,
      resourceName: resourceNameFromArgs
    });
  });

  const errorReport = combineErrors(errorMap);

  if (errorReport.items?.length) {
    return {
      errors: errorReport
    };
  }
};

const combineErrors = ({ cache, errorCache, warningsCache, payloadErrors, stats }) => {
  const errorReport = [];
  Object.entries(cache ?? {}).forEach(([resource, field]) => {
    Object.entries(field ?? {}).forEach(([f]) => {
      Object.entries(errorCache?.[resource]?.[f] ?? {}).forEach(([, files]) => {
        const fileNames = Object.keys(files);
        const { message } = files[fileNames[0]];
        if (errorCache[resource]?.[f]) {
          if (!field[f]?.errors) {
            field[f].errors = [];
          }
          field[f]?.errors?.push({
            resourceName: resource,
            fieldName: f,
            errors: [
              {
                message,
                occurrences: fileNames.map(fname => ({
                  count: files[fname].occurrences,
                  ...(() => {
                    if (fileNames[0] !== '') {
                      return { fileName: fname };
                    } else {
                      return {};
                    }
                  })()
                }))
              }
            ]
          });
        }
      });
      Object.entries(warningsCache?.[resource]?.[f] || {}).forEach(([, files]) => {
        const fileNames = Object.keys(files);
        const { message } = files[fileNames[0]];
        if (warningsCache[resource]?.[f]) {
          if (!field[f]?.warnings) {
            field[f].warnings = [];
          }
          field[f]?.warnings?.push({
            resourceName: resource,
            fieldName: f,
            warnings: [
              {
                message,
                occurrences: fileNames.map(fname => ({
                  count: files[fname].occurrences,
                  ...(() => {
                    if (fileNames[0] !== '') {
                      return { fileName: fname };
                    } else {
                      return {};
                    }
                  })()
                }))
              }
            ]
          });
        }
      });
    });
  });
  Object.entries(cache).forEach(([resource, field]) => {
    Object.keys(field).forEach(f => {
      errorReport.push({
        resourceName: resource,
        fieldName: f,
        errors: cache[resource][f]?.errors?.flatMap(e => e.errors.map(er => ({ ...er }))),
        warnings: cache[resource][f]?.warnings?.flatMap(e => e.warnings.map(er => ({ ...er })))
      });
    });
  });

  Object.entries(payloadErrors).forEach(([resource, message]) => {
    Object.keys(message).forEach(k => {
      errorReport.push({
        resourceName: resource,
        errors: [
          {
            message: k,
            ...(() => {
              if (message[k]) {
                return {
                  occurrences: [
                    {
                      fileName: message[k],
                      count: 1
                    }
                  ]
                };
              } else {
                return {};
              }
            })()
          }
        ]
      });
      stats.totalErrors++;
    });
  });
  return {
    description: 'RESO Common Format Schema Validation Summary',
    generatedOn: new Date().toISOString(),
    /** TODO: inferred version - this should probably just be passed in? **/
    totalErrors: stats.totalErrors,
    totalWarnings: stats.totalWarnings,
    items: errorReport
  };
};

const generateErrorReport = ({
  validate,
  json,
  additionalPropertiesAllowed,
  resourceName,
  cache,
  errorCache,
  warningsCache,
  stats,
  fileName
}) => {
  const convertToWarnings = ['maxLength'];
  validate.errors.reduce((acc, { instancePath, message, keyword, params }) => {
    if (!instancePath) return acc;
    const nestedPayloadProperties = instancePath?.split('/')?.slice(1) || [];
    let failedItemName = json.value ? nestedPayloadProperties[2] : nestedPayloadProperties[0];
    if (!failedItemName) {
      if (keyword === 'additionalProperties') {
        failedItemName = params?.additionalProperty;
      }
    }
    let resolvedKeyword = keyword;
    if (keyword === 'errorMessage') {
      resolvedKeyword = params?.errors?.[0]?.keyword || keyword;
    }

    if (!cache[resourceName]) {
      cache[resourceName] = {};
    }

    if (!cache[resourceName][failedItemName]) {
      cache[resourceName][failedItemName] = {};
    }

    // needs to be generic to accommodate failures that need to be changed to warnings when -a is passed.
    if (convertToWarnings.includes(resolvedKeyword) && additionalPropertiesAllowed) {
      updateWarningsCache({ warningsCache, resourceName, failedItemName, message, fileName, stats });
      return acc;
    }

    updateErrorCache({ errorCache, resourceName, failedItemName, message, fileName, stats });
    return acc;
  }, {});
};

const parseResoUrn = (urn = '') => {
  const parts = urn?.split?.(':') || '';

  if (parts.length < 6 || parts[0] !== 'urn' || parts[1] !== 'reso' || parts[2] !== 'metadata') {
    return {
      version: '',
      resource: ''
    };
  }

  return {
    version: parts[3],
    resource: parts.slice(5)[0]
  };
};

const getResourceAndVersion = ({ payload, resource, version }) => {
  if (payload['@reso.context']) {
    const { resource: parsedResource, version: parsedVersion } = parseResoUrn(payload['@reso.context']);
    return {
      resource: parsedResource,
      version: parsedVersion
    };
  } else {
    return {
      resource,
      version
    };
  }
};

function updateErrorCache({ errorCache, resourceName, failedItemName, message, fileName, stats }) {
  if (!errorCache[resourceName]) {
    errorCache[resourceName] = {};
  }

  if (!errorCache[resourceName][failedItemName]) {
    errorCache[resourceName][failedItemName] = {};
  }

  if (!errorCache[resourceName][failedItemName][`__${message}`]) {
    errorCache[resourceName][failedItemName][`__${message}`] = {};
  }
  if (!errorCache[resourceName][failedItemName][`__${message}`][fileName]) {
    errorCache[resourceName][failedItemName][`__${message}`][fileName] = {
      message: message.slice(0, message.indexOf(' ')).toUpperCase() + message.slice(message.indexOf(' '), message.length),
      occurrences: 1
    };
  } else {
    errorCache[resourceName][failedItemName][`__${message}`][fileName].occurrences++;
  }
  stats.totalErrors++;
}

function updateWarningsCache({ warningsCache, resourceName, failedItemName, message, fileName, stats }) {
  if (!warningsCache[resourceName]) {
    warningsCache[resourceName] = {};
  }

  if (!warningsCache[resourceName][failedItemName]) {
    warningsCache[resourceName][failedItemName] = {};
  }

  if (!warningsCache[resourceName][failedItemName][`__${message}`]) {
    warningsCache[resourceName][failedItemName][`__${message}`] = {};
  }
  if (!warningsCache[resourceName][failedItemName][`__${message}`][fileName]) {
    warningsCache[resourceName][failedItemName][`__${message}`][fileName] = {
      message: message.slice(0, message.indexOf(' ')).toUpperCase() + message.slice(message.indexOf(' '), message.length),
      occurrences: 1
    };
  } else {
    warningsCache[resourceName][failedItemName][`__${message}`][fileName].occurrences++;
  }
  stats.totalWarnings++;
}

module.exports = {
  validatePayload,
  isValidDdVersion,
  validate,
  combineErrors
};
