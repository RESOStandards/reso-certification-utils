'use strict';

const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const chalk = require('chalk');
const { getReferenceMetadata } = require('@reso/reso-certification-etl');
const ajvErrors = require('ajv-errors');
const _ = require('lodash');

const ajv = new Ajv({ allErrors: true, coerceTypes: false, strict: true });
addFormats(ajv);
ajvErrors(ajv);

const addPayloadError = (resource, fileName, message, payloadErrors) => {
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

function validatePayload(payloads = {}, schema) {
  /**
   * Step 1 - Analyze the payload and parse out the relevant data like the version, resourceName, etc.
   *
   * Using this additional info we can improve our generated schema by providing a resource against which
   * the payload should be validated.
   */
  const payloadErrors = {};
  const errorReport = [];
  const cache = {};
  const errorCache = {};
  const warningsCache = {};
  const stats = {
    totalErrors: 0,
    totalWarnings: 0
  };

  const origSchema = _.cloneDeep(schema);

  Object.entries(payloads).forEach(([fileName, payload]) => {
    let resourceName, ddVersion;
    try {
      //TODO: 1. Not all payloads will contain this property - it will either by @reso.context or have at least one top-level @odata. property...
      //         but in the OData case the version needs to be passed in from the command line and the resource name passed as well
      //      2. We also need to be able to take a passed-in version
      if (!payload['@reso.context']) {
        throw new Error('The required field "@reso.context" was not present in the payload');
      }
      const { resource, version } = parseResoUrn(payload['@reso.context']);
      resourceName = resource;

      if (!isValidDdVersion(version)) {
        console.log(chalk.redBright(`Found invalid DD version ${version} - Supported versions are ${getValidDdVersions()}`));
        addPayloadError(`${resource[0].toUpperCase()}${resource.slice(1)}`, fileName, 'Invalid version', payloadErrors);
      }

      ddVersion = isValidDdVersion(version) ? version : DEFAULT_DD_VERSION;

      const referenceMetadata = getReferenceMetadata(ddVersion);
      if (!referenceMetadata?.resources?.find(r => r.resourceName.toLowerCase() === resource.toLocaleLowerCase())) {
        console.log(chalk.redBright(`Found invalid resource: ${resource}`));
        addPayloadError(resource, fileName, 'Invalid resource', payloadErrors);
      }

      const { definitions } = schema;
      const singleValueSchema = schema?.oneOf?.find(s => !s.properties.value);
      const multiValueSchema = schema?.oneOf?.find(s => s.properties.value);

      const formattedResourceName = Object.keys(definitions ?? {}).find(r => r.toLowerCase() === resource.toLowerCase());
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
      addPayloadError(resourceName.toLowerCase(), fileName, error.message, payloadErrors);
    }

    // Step 2 - Validate with AJV and generate error report
    const [selectedSchema] = schema.oneOf;
    const additionalPropertiesAllowed = selectedSchema.properties.value
      ? schema.definitions[Object.keys(schema.definitions)[0]].additionalProperties
      : selectedSchema.additionalProperties;
    const validate = ajv.compile(schema);
    const valid = validate(payload);
    if (!valid) {
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
    schema = origSchema;
  });
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
                  fileName: fname
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
                  fileName: fname
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
            occurrences: [
              {
                fileName: message[k],
                count: 1
              }
            ]
          }
        ]
      });
      stats.totalErrors++;
    });
  });

  if (errorReport?.length) {
    return {
      errors: {
        description: 'RESO Common Format Schema Validation Summary',
        generatedOn: new Date().toISOString(),
        /** TODO: inferred version - this should probably just be passed in? **/
        totalErrors: stats.totalErrors,
        totalWarnings: stats.totalWarnings,
        items: errorReport
      }
    };
  }
  return true;
}

function generateErrorReport({
  validate,
  json,
  additionalPropertiesAllowed,
  resourceName,
  cache,
  errorCache,
  warningsCache,
  stats,
  fileName
}) {
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
    // find corresponding value in the payload
    let failedItemValue = nestedPayloadProperties.reduce((acc, curr) => {
      if (!acc && json[curr]) return json[curr];
      return acc[curr];
    }, null);

    if (failedItemValue?.['constructor'] === Object && resolvedKeyword === 'additionalProperties') {
      failedItemValue = 'additionalProperties';
    }

    if (!cache[resourceName]) {
      cache[resourceName] = {};
    }

    if (!cache[resourceName][failedItemName]) {
      cache[resourceName][failedItemName] = {};
    }

    // needs to be generic to accommodate failures that need to be changed to warnings when -a is passed.
    if (resolvedKeyword === 'maxLength' && additionalPropertiesAllowed) {
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
      return acc;
    }

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
    return acc;
  }, {});
}

function parseResoUrn(urn = '') {
  const parts = urn?.split?.(':') || '';

  if (parts.length < 6 || parts[0] !== 'urn' || parts[1] !== 'reso' || parts[2] !== 'metadata') {
    throw new Error('Invalid URN');
  }

  return {
    version: parts[3],
    resource: parts.slice(5)[0]
  };
}

module.exports = {
  validatePayload
};
