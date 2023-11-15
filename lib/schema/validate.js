'use strict';

const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const chalk = require('chalk');
const ajvErrors = require('ajv-errors');
const { parseResoUrn } = require('../../common');
const { parseNestedPropertyForResourceAndField } = require('./utils');

const buildEnumMap = (enums = []) =>
  enums.reduce((acc, curr) => {
    acc[curr] = true;
    return acc;
  }, {});

/**
 * @typedef {import('ajv').ValidateFunction} ValidateFunction
 */

const ajv = new Ajv({ allErrors: true, coerceTypes: false, strict: true });
addFormats(ajv);
ajvErrors(ajv);

/**
 * TODO
 * @param {*} value
 * @returns
 */
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

/**
 * TODO
 * @param {*} resource
 * @param {*} fileName
 * @param {*} message
 * @param {*} payloadErrors
 * @returns
 */
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
 *
 * @param {string} f
 */
const normalizeAtField = (f = '') => {
  if (f?.startsWith('@')) return f;
  if (!f?.includes('@')) return f;

  return f?.split('@')[0];
};

/**
 *
 * @param {Object} obj
 * @param {{}} obj.payload
 * @param {{}} obj.schema
 * @param {Array} obj.nesting
 */
const processFieldNames = ({ payload = {}, nesting = [], schema = {}, results = [] }) => {
  Object.keys(payload).forEach(f => {
    const value = payload[f];

    if (Array.isArray(value)) {
      value.forEach(v => v instanceof Object && processFieldNames({ payload: v, nesting: [f, 'properties'], schema, results }));
    }

    if (value?.['constructor'] === Object) {
      processFieldNames({ payload: value, nesting, schema, results });
    }

    const normalizedField = normalizeAtField(f);

    if (normalizedField !== f) {
      payload[normalizedField] = value;
      delete payload[f];
    }

    if (f?.startsWith('@odata')) {
      delete payload[f];
    }

    const schemaTypeForField = nesting.concat(normalizedField).reduce((acc, curr) => {
      if (acc?.[curr]) return acc[curr];
      return acc;
    }, schema);

    if (schemaTypeForField?.type === 'array' && schemaTypeForField?.items?.enum) {
      if (typeof value === 'string' && value?.includes(',')) {
        payload[normalizedField] = value.split(',');
      }
    }

    if ((Array.isArray(schemaTypeForField?.type) || schemaTypeForField.type === 'string') && schemaTypeForField?.enum) {
      if (['string', 'null'].sort().toString() === schemaTypeForField.type.sort().toString() || schemaTypeForField.type === 'string') {
        results.push({ field: normalizedField, value, nesting, enums: schemaTypeForField?.enum });
        delete payload[f];
      }
    }
  });
  return results;
};

const SUPPORTED_DD_VERSIONS = {
  DD_1_7: '1.7',
  DD_2_0: '2.0'
};
const DEFAULT_DD_VERSION = SUPPORTED_DD_VERSIONS.DD_1_7;

const getValidDdVersions = () => Object.values(SUPPORTED_DD_VERSIONS ?? {});
const isValidDdVersion = (version = '') => getValidDdVersions()?.includes(version);

/**
 * TODO
 * @param {Object} obj
 * @param {string} obj.resourceName
 * @param {string} obj.fileName
 * @param {string} obj.ddVersion
 * @param {{}} obj.jsonSchema
 * @param {{}} obj.jsonPayload
 * @param {{}} obj.errorMap
 *
 * @returns Intermediate error and warning caches along with stats. Can be combined later using `combineErrors`
 */
const validate = ({ jsonSchema = {}, resourceName = 'Property', jsonPayload, errorMap = {}, fileName = '', ddVersion }) => {
  const { stats = { totalErrors: 0, totalWarnings: 0 }, cache = {}, errorCache = {}, warningsCache = {}, payloadErrors = {} } = errorMap;
  const schema = jsonSchema;
  const oldOneOf = structuredClone(schema.oneOf);
  const payload = jsonPayload;

  const [contextKey, contextValue] = Object.entries(payload).find(([k]) => k.startsWith('@')) || [];
  let stringListErrors = [];
  // adjust the payload (fieldnames, string lists etc)
  if (payload.value) {
    payload.value?.forEach(v => {
      stringListErrors = processFieldNames({
        payload: v,
        nesting: [resourceName, 'properties'],
        schema: schema.definitions,
        results: stringListErrors
      });
    });
  } else {
    stringListErrors = processFieldNames({ payload, nesting: [resourceName, 'properties'], schema: schema.definitions });
    payload[contextKey] = contextValue;
  }

  let validPayload = true;
  /**
   * Step 1 - Analyze the payload and parse out the relevant data like the version, resourceName, etc.
   *
   * Using this additional info we can improve our generated schema by providing a resource against which
   * the payload should be validated.
   */
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
  let valid = validate(payload);

  const stringListErrorsFormatted = stringListErrors
    .flatMap(r => {
      const { enums, field, nesting, value } = r;
      const enumMap = buildEnumMap(enums);
      const parsedLookupValue = typeof value === 'string' ? value.split(',') : Array.isArray(value) ? value : [value];
      const invalidEnums = parsedLookupValue.filter(v => !enumMap[v]);
      if (invalidEnums.length) {
        const [resource] = nesting;
        return invalidEnums.map(e => {
          const ajvLikeError = {
            instancePath: payload.value ? `0/value/1/${resource}/1/${field}` : `0/${resource}/0/${field}`,
            failedItemValue: e,
            message: 'MUST be equal to one of the allowed values',
            keyword: 'enum'
          };
          return ajvLikeError;
        });
      }
    })
    .filter(Boolean);

  validate.errors = validate.errors || [];
  if (stringListErrorsFormatted.length) {
    valid = false;
    stringListErrorsFormatted.forEach(e => validate.errors.push(e));
  }
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

/**
 * TODO
 * @param {Object} obj
 * @param {Record<string, {}>} obj.payloads
 * @param {{}} obj.schema
 * @param {string} obj.resourceNameFromArgs
 * @param {string} obj.versionFromArgs
 *
 * @returns The processed error report
 */
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

/**
 * @param {Object} obj
 * @param {{}} obj.cache
 * @param {{}} obj.errorCache
 * @param {{}} obj.warningsCache
 * @param {{}} obj.payloadErrors
 * @param {{totalWarnings: Number, totalErrors: Number}} obj.stats
 *
 * Combines results from one or more validations into one object
 */
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
                    const [f, l] = fname.split('__');
                    const result = {};
                    if (f !== '') {
                      result.fileName = f;
                    }
                    if (l !== '') {
                      result.lookupValue = l;
                    }
                    return result;
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
    totalErrors: stats.totalErrors,
    totalWarnings: stats.totalWarnings,
    items: errorReport
  };
};

/**
 * @param {Object} obj
 * @param {boolean} obj.additionalPropertiesAllowed
 * @param {string} obj.resourceName
 * @param {string} obj.fileName
 * @param {{}} obj.cache
 * @param {{}} obj.errorCache
 * @param {{}} obj.warningsCache
 * @param {ValidateFunction} obj.validate
 * @param {{totalWarnings: Number, totalErrors: Number}} obj.stats
 *
 * Processes the raw validation results from AJV.
 */
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
  validate.errors.reduce((acc, { instancePath, message, keyword, params, failedItemValue: value }) => {
    let rname = resourceName;
    if (!instancePath) return acc;
    const nestedPayloadProperties = instancePath?.split('/')?.slice(1) || [];

    let failedItemValue =
      value ??
      (keyword === 'enum'
        ? nestedPayloadProperties.reduce((val, curr) => {
          if (!val && json[curr]) return json[curr];
          return val[curr];
        }, null)
        : '');

    const { fieldName, resourceName: resource } = parseNestedPropertyForResourceAndField({
      arr: nestedPayloadProperties,
      isValueArray: !!json.value
    });

    if (keyword === 'additionalProperties') {
      message = 'Fields MUST be advertised in the metadata';
    }

    let failedItemName = fieldName;
    if (!failedItemName) {
      if (keyword === 'additionalProperties') {
        failedItemName = params?.additionalProperty;
        message = 'Fields MUST be advertised in the metadata';
      }
    }

    if (resource) {
      rname = resource;
    }

    let resolvedKeyword = keyword;
    if (keyword === 'errorMessage') {
      resolvedKeyword = params?.errors?.[0]?.keyword || keyword;
    }

    if (failedItemValue?.['constructor'] === Object && resolvedKeyword === 'additionalProperties') {
      failedItemValue = 'additionalProperties';
    }

    if (!cache[rname]) {
      cache[rname] = {};
    }

    if (!cache[rname][failedItemName]) {
      cache[rname][failedItemName] = {};
    }

    if (convertToWarnings.includes(resolvedKeyword) && additionalPropertiesAllowed) {
      updateWarningsCache({ warningsCache, resourceName: rname, failedItemName, message, fileName, stats });
      return acc;
    }

    updateErrorCache({ errorCache, resourceName: rname, failedItemName, message, fileName, stats, failedItemValue });
    return acc;
  }, {});
};

/**
 * TODO
 * @param {Object} obj
 * @param {{}} obj.payload
 * @param {string} obj.resource
 * @param {string} obj.version
 *
 * @returns If the urn is a RESO urn this returns the resource and version parsed from that else returns the resource and version that was passed in.
 */
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

/**
 *
 * @param {Object} obj
 * @param {{}} obj.errorCache
 * @param {String} obj.resourceName
 * @param {String} obj.failedItemName
 * @param {String} obj.failedItemValue
 * @param {String} obj.message
 * @param {String} obj.fileName
 * @param {{totalErrors: Number}} obj.stats
 *
 * Updates the cache with a new error message
 */
const updateErrorCache = ({ errorCache, resourceName, failedItemName, message, fileName, stats, failedItemValue }) => {
  if (!errorCache[resourceName]) {
    errorCache[resourceName] = {};
  }

  if (!errorCache[resourceName][failedItemName]) {
    errorCache[resourceName][failedItemName] = {};
  }

  if (!errorCache[resourceName][failedItemName][`__${message}`]) {
    errorCache[resourceName][failedItemName][`__${message}`] = {};
  }
  if (!errorCache[resourceName][failedItemName][`__${message}`][`${fileName}__${failedItemValue}`]) {
    errorCache[resourceName][failedItemName][`__${message}`][`${fileName}__${failedItemValue}`] = {
      // capitalize first word like MUST, SHOULD etc
      message: message.slice(0, message.indexOf(' ')).toUpperCase() + message.slice(message.indexOf(' '), message.length),
      occurrences: 1
    };
  } else {
    errorCache[resourceName][failedItemName][`__${message}`][`${fileName}__${failedItemValue}`].occurrences++;
  }
  stats.totalErrors++;
};

/**
 *
 * @param {Object} obj
 * @param {{}} obj.warningsCache
 * @param {String} obj.resourceName
 * @param {String} obj.failedItemName
 * @param {String} obj.message
 * @param {String} obj.fileName
 * @param {{totalWarnings: Number}} obj.stats
 *
 * Updates the cache with a new warning message
 */
const updateWarningsCache = ({ warningsCache, resourceName, failedItemName, message, fileName, stats }) => {
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
};

module.exports = {
  validatePayload,
  isValidDdVersion,
  validate,
  combineErrors
};
