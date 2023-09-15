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
const VALID_DD_VERSIONS = ['1.7', '2.0'];

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
    let resourceName, validVersion;
    try {
      if (!payload['@reso.context']) {
        throw new Error('The required field "@reso.context" was not present in the payload');
      }
      const { resource, version } = parseResoUrn(payload['@reso.context']);
      resourceName = resource;
      const isValidVersion = VALID_DD_VERSIONS.includes(version);
      validVersion = isValidVersion ? version : '1.7';
      if (!isValidVersion) {
        console.log(chalk.redBright(`Found invalid DD version ${version} - Supported versions are ${VALID_DD_VERSIONS}`));
        addPayloadError(resource.toLowerCase(), fileName, 'Invalid version', payloadErrors);
      }
      const referenceMetadata = getReferenceMetadata(isValidVersion ? version : '1.7');
      if (!referenceMetadata?.resources.find(r => r.resourceName.toLowerCase() === resource.toLocaleLowerCase())) {
        console.log(chalk.redBright(`Found invalid resource: ${resource}`));
        addPayloadError(resource.toLowerCase(), fileName, 'Invalid resource', payloadErrors);
      }

      // ddVersion = version;
      const { definitions } = schema;
      const singleValueSchema = schema?.oneOf?.find(s => !s.properties.value);
      const multiValueSchema = schema?.oneOf?.find(s => s.properties.value);

      const formattedResourceName = Object.keys(definitions).find(r => r.toLowerCase() === resource.toLowerCase());
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
        version: validVersion,
        errorReport,
        errorCache,
        warningsCache,
        cache,
        stats,
        fileName
      });
    }
    schema = origSchema;
  });
  Object.entries(cache).forEach(([resource, field]) => {
    Object.entries(field).forEach(([f]) => {
      Object.entries(errorCache[resource][f] || {}).forEach(([, files]) => {
        const fileNames = Object.keys(files);
        const { message, value } = files[fileNames[0]];
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
                value,
                occurrences: fileNames.map(fname => ({
                  count: files[fname].occurrences,
                  fileName: fname
                }))
              }
            ]
          });
        }
      });
      Object.entries(warningsCache[resource][f] || {}).forEach(([, files]) => {
        const fileNames = Object.keys(files);
        const { message, value } = files[fileNames[0]];
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
                value,
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
  if (Object.keys(payloadErrors).length) {
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
      });
    });
  }
  if (errorReport.length) {
    return {
      errors: {
        description: 'RESO Common Format Schema Validation Summary',
        generatedOn: new Date().toISOString(),
        // version: validVersion,
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
    // find corresponding value in the payload
    let failedItemValue = nestedPayloadProperties.reduce((acc, curr) => {
      if (!acc && json[curr]) return json[curr];
      return acc[curr];
    }, null);

    if (failedItemValue?.['constructor'] === Object && keyword === 'additionalProperties') {
      failedItemValue = 'additionalProperties';
    }

    if (!cache[resourceName]) {
      cache[resourceName] = {};
    }

    if (!cache[resourceName][failedItemName]) {
      cache[resourceName][failedItemName] = {};
    }

    // needs to be generic to accomodate failures that need to be changed to warnings when -a is passed.
    if (keyword === 'maxLength' && additionalPropertiesAllowed) {
      if (!warningsCache[resourceName]) {
        warningsCache[resourceName] = {};
      }

      if (!warningsCache[resourceName][failedItemName]) {
        warningsCache[resourceName][failedItemName] = {};
      }

      if (!warningsCache[resourceName][failedItemName][`${failedItemValue}__${message}`]) {
        warningsCache[resourceName][failedItemName][`${failedItemValue}__${message}`] = {};
      }
      if (!warningsCache[resourceName][failedItemName][`${failedItemValue}__${message}`][fileName]) {
        warningsCache[resourceName][failedItemName][`${failedItemValue}__${message}`][fileName] = {
          value: failedItemValue,
          message: message.slice(0, message.indexOf(' ')).toUpperCase() + message.slice(message.indexOf(' '), message.length),
          occurrences: 1
        };
      } else {
        warningsCache[resourceName][failedItemName][`${failedItemValue}__${message}`][fileName].occurrences++;
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

    if (!errorCache[resourceName][failedItemName][`${failedItemValue}__${message}`]) {
      errorCache[resourceName][failedItemName][`${failedItemValue}__${message}`] = {};
    }
    if (!errorCache[resourceName][failedItemName][`${failedItemValue}__${message}`][fileName]) {
      errorCache[resourceName][failedItemName][`${failedItemValue}__${message}`][fileName] = {
        value: failedItemValue,
        message: message.slice(0, message.indexOf(' ')).toUpperCase() + message.slice(message.indexOf(' '), message.length),
        occurrences: 1
      };
    } else {
      errorCache[resourceName][failedItemName][`${failedItemValue}__${message}`][fileName].occurrences++;
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
