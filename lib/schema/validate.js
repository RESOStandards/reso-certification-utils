'use strict';

const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const chalk = require('chalk');
const ajvErrors = require('ajv-errors');
const { DEFAULT_DD_VERSION } = require('../../common');
const {
  parseNestedPropertyForResourceAndField,
  addCustomValidationForEnum,
  addPayloadError,
  determineType,
  normalizeAtField,
  getValidDataDictionaryVersions,
  isValidDataDictionaryVersion,
  combineErrors,
  parseSchemaPath,
  checkMapParams,
  updateCache,
  getResourceAndVersion,
  getMaxLengthMessage,
  VALIDATION_ERROR_MESSAGES,
  SCHEMA_ERROR_KEYWORDS
} = require('./utils');
const { validationContext } = require('./context');

/**
 * @typedef {import('ajv').ValidateFunction} ValidateFunction
 */

const ajv = new Ajv({ allErrors: true, coerceTypes: false, strict: true });

// support types like date
addFormats(ajv);
// better structure for errors
ajvErrors(ajv);

// add custom handling for enums
addCustomValidationForEnum(ajv);

// cache of schemas
const schemaCache = new Map();
const ORIGINAL_SCHEMA = 'original_schema';

/**
 *
 * @param {Object} obj
 * @param {string} obj.resourceName
 * @param {string} obj.fileName
 * @param {string} obj.version
 * @param {{}} obj.jsonSchema
 * @param {{}} obj.jsonPayload
 * @param {{}} obj.errorMap
 * @param {Boolean?} obj.isResoDataDictionarySchema
 * @param {Object} obj.validationConfig
 *
 * @returns Intermediate error and warning caches along with stats. Can be combined later using `combineErrors`
 */
const validate = ({
  jsonSchema = {},
  resourceName = 'Property',
  jsonPayload,
  errorMap = {},
  fileName = '',
  version,
  isResoDataDictionarySchema = false /*CLI only */,
  validationConfig = {}
} = {}) => {
  const { stats = { totalErrors: 0, totalWarnings: 0 }, cache = {}, errorCache = {}, warningsCache = {}, payloadErrors = {} } = errorMap;
  const schema = jsonSchema;
  const oldOneOf = structuredClone(schema.oneOf);
  const payload = jsonPayload;
  let schemaId;

  validationContext.setValidationConfig(validationConfig);
  validationContext.setSchema(schema);
  validationContext.setPayloadType(payload.value ? 'MULTI' : 'SINGLE');

  const contextData = getResourceAndVersion({
    payload,
    resource: resourceName,
    version
  });

  const formattedResourceName = Object.keys(schema?.definitions ?? {}).find(r => r.toLowerCase() === contextData?.resource?.toLowerCase());

  validationContext.setActiveResource(formattedResourceName || contextData?.resource);
  validationContext.setVersion(version || contextData.version);
  validationContext.setRCF(!!payload['@reso.context']);

  const ddVersion = validationContext.getVersion();

  /**
   * Step 1 - Analyze the payload and parse out the relevant data like the version, resourceName, etc.
   *
   * Using this additional info we can improve our generated schema by providing a resource against which
   * the payload should be validated.
   */
  let validPayload = true;
  if (!payload['@reso.context']) {
    if (!version) {
      validPayload = false;
      throw new Error('Version is required for payloads without "@reso.context" property');
    }
  }

  try {
    if (!isValidDataDictionaryVersion(ddVersion)) {
      throw new Error(`Found invalid DD version ${ddVersion}. Supported versions: ${getValidDataDictionaryVersions()}`);
    }

    const { definitions } = schema;
    const singleValueSchema = schema?.oneOf?.find(s => !s.properties.value);
    const multiValueSchema = schema?.oneOf?.find(s => s.properties.value);

    if (!formattedResourceName) {
      console.log(chalk.redBright(`Found invalid resource: ${formattedResourceName}`));
      addPayloadError(formattedResourceName, fileName, 'Invalid resource', payloadErrors);
      return errorMap;
    }
    resourceName = formattedResourceName;
    if (!payload.value) {
      schema.oneOf = [singleValueSchema];
      schemaId = `single-${formattedResourceName}`;
      // extend the generated schema with new info from the specific payload
      Object.assign(singleValueSchema.properties, definitions[formattedResourceName].properties);
    } else {
      schema.oneOf = [multiValueSchema];
      multiValueSchema.properties.value.items = {
        $ref: `#/definitions/${formattedResourceName}`
      };
      schemaId = `multi-${formattedResourceName}`;
    }
  } catch (error) {
    console.error(chalk.redBright.bold('ERROR: ' + error.message));
    addPayloadError(resourceName, fileName, error.message, payloadErrors);
  }

  if (!validPayload)
    return {
      stats,
      cache,
      errorCache,
      warningsCache,
      payloadErrors
    };

  // Step 2 - Validate with AJV and generate error report
  const [selectedSchema] = schema.oneOf;
  const additionalPropertiesAllowed = selectedSchema.properties.value
    ? schema.definitions[Object.keys(schema.definitions)[0]].additionalProperties
    : selectedSchema.additionalProperties;

  const originalSchema = schemaCache.get(ORIGINAL_SCHEMA);
  if (originalSchema !== schema) {
    schemaCache.clear();
    schemaCache.set(ORIGINAL_SCHEMA, schema);
  }

  let cachedSchema = schemaCache.get(schemaId);
  if (!cachedSchema) {
    cachedSchema = { ...schema };
    schemaCache.set(schemaId, cachedSchema);
  }
  const validate = ajv.compile(cachedSchema);
  const valid = validate(payload);

  // Update the error message in case of type mismatch
  if (!valid) {
    for (const error of validate.errors) {
      if (error.keyword === SCHEMA_ERROR_KEYWORDS.TYPE) {
        const nestedPayloadProperties = error?.instancePath?.split('/')?.slice(1) || [];

        let resolvedKeyword = error.keyword;
        if (error.keyword === SCHEMA_ERROR_KEYWORDS.ERROR_MESSAGE) {
          resolvedKeyword = error?.params?.errors?.[0]?.keyword || resolvedKeyword;
        }
        // find corresponding value in the payload
        let failedItemValue = nestedPayloadProperties.reduce((acc, curr) => {
          if (!acc && payload[curr] !== undefined) return payload[curr];
          return acc?.[curr] !== undefined ? acc?.[curr] : acc;
        }, null);

        // additional property errors need to be transformed in or else they will pollute the final error output.
        if (failedItemValue?.['constructor'] === Object && resolvedKeyword === SCHEMA_ERROR_KEYWORDS.ADDITIONAL_PROPERTIES) {
          failedItemValue = SCHEMA_ERROR_KEYWORDS.ADDITIONAL_PROPERTIES;
        }
        const schemaType = error?.params?.type;
        const schemaTypeFormatted = Array.isArray(error?.params?.type) ? schemaType.join(' or ') : schemaType;
        error.message = `MUST be ${schemaTypeFormatted} but found ${determineType(failedItemValue)}`;
        error.transformedValue = determineType(failedItemValue);
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
      fileName,
      isResoDataDictionarySchema,
      version,
      isRCF: validationContext.isRCF(),
      metadataMap: schema?.definitions?.MetadataMap || {}
    });
  }

  schema.oneOf = oldOneOf;
  validationContext.reset();
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
 * @param {Object} obj.validationConfig
 *
 * @returns The processed error report
 */
const validatePayload = ({ payloads = {}, schema, resourceNameFromArgs = '', versionFromArgs, validationConfig = {} }) => {
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

  const isResoDataDictionarySchema = schema instanceof Map;

  Object.entries(payloads).forEach(([fileName, payload]) => {
    const { version } = getResourceAndVersion({ payload, version: DEFAULT_DD_VERSION });
    errorMap = validate({
      version: versionFromArgs,
      jsonPayload: payload,
      fileName,
      errorMap,
      jsonSchema: isResoDataDictionarySchema ? schema.get(version) : schema,
      resourceName: resourceNameFromArgs,
      isResoDataDictionarySchema,
      validationConfig
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
 * @param {boolean} obj.isRCF
 * @param {string} obj.resourceName
 * @param {string} obj.fileName
 * @param {string} obj.version
 * @param {Boolean} obj.isResoDataDictionarySchema
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
  resourceName,
  cache,
  errorCache,
  warningsCache,
  stats,
  fileName,
  version,
  isResoDataDictionarySchema,
  isRCF,
  metadataMap
}) => {
  validate.errors.reduce(
    (acc, { instancePath, message, keyword, params, failedItemValue: value, isWarning, schemaPath, transformedValue }) => {
      let rName = resourceName;
      if (!instancePath && keyword !== SCHEMA_ERROR_KEYWORDS.ADDITIONAL_PROPERTIES) return acc;
      const nestedPayloadProperties = instancePath?.split('/')?.slice(1) || [];

      let failedItemValue;

      if (value !== undefined && value !== null) {
        failedItemValue = value;
      } else {
        if (keyword === SCHEMA_ERROR_KEYWORDS.ENUM) {
          failedItemValue = nestedPayloadProperties.reduce((val, curr) => {
            if (!val && json[curr] !== undefined) return json[curr];
            return val?.[curr] || val;
          }, null);
        } else {
          failedItemValue = '';
        }
      }

      const { fieldName, resourceName: resource } = parseNestedPropertyForResourceAndField({
        arr: nestedPayloadProperties,
        isValueArray: !!json.value
      });
      if (
        keyword === SCHEMA_ERROR_KEYWORDS.TYPE &&
        params?.type === SCHEMA_ERROR_KEYWORDS.OBJECT &&
        metadataMap?.[rName]?.[fieldName]?.nullable &&
        transformedValue === SCHEMA_ERROR_KEYWORDS.NULL
      ) {
        return acc;
      }

      let failedItemName = fieldName;
      if (resource) {
        rName = resource;
      }

      let resourceNameFromSchemaPath = parseSchemaPath(schemaPath);
      if (!resourceNameFromSchemaPath && metadataMap?.[rName]?.[fieldName]?.isExpansion) {
        resourceNameFromSchemaPath = metadataMap[rName][fieldName].typeName;
      }
      // this means the validation error was for an expansion
      if (resourceNameFromSchemaPath && resourceNameFromSchemaPath !== resource) {
        if (params?.additionalProperty) {
          failedItemName = params?.additionalProperty;
        }
        if (resourceNameFromSchemaPath !== failedItemName) {
          rName = resourceNameFromSchemaPath;
        }
      }

      if (keyword === SCHEMA_ERROR_KEYWORDS.ADDITIONAL_PROPERTIES) {
        message = isResoDataDictionarySchema
          ? `Additional fields found that are not part of Data Dictionary ${version}`
          : 'Fields MUST be advertised in the metadata';
      }

      if (!failedItemName) {
        if (keyword === SCHEMA_ERROR_KEYWORDS.ADDITIONAL_PROPERTIES) {
          failedItemName = params?.additionalProperty;
          message = isResoDataDictionarySchema
            ? `Additional fields found that are not part of Data Dictionary ${version}`
            : 'Fields MUST be advertised in the metadata';
        }
      }

      if (['@odata', '@reso'].some(c => failedItemName.startsWith(c))) {
        // we don't want to error out on these fields
        return acc;
      }

      // ignore fields with '@' in the middle of the string
      const normalizedField = normalizeAtField(failedItemName);
      if (normalizedField !== failedItemName) {
        return acc;
      }

      let resolvedKeyword = keyword;
      if (keyword === SCHEMA_ERROR_KEYWORDS.ERROR_MESSAGE) {
        resolvedKeyword = params?.errors?.[0]?.keyword || keyword;
      }

      if (failedItemValue?.['constructor'] === Object && resolvedKeyword === SCHEMA_ERROR_KEYWORDS.ADDITIONAL_PROPERTIES) {
        failedItemValue = SCHEMA_ERROR_KEYWORDS.ADDITIONAL_PROPERTIES;
      }

      //sanitize params
      [rName, failedItemName].forEach(checkMapParams);

      if (!cache[rName]) {
        cache[rName] = {};
      }

      if (!cache[rName][failedItemName]) {
        cache[rName][failedItemName] = {};
      }

      if (resolvedKeyword === SCHEMA_ERROR_KEYWORDS.MAX_LENGTH) {
        if (isRCF) {
          isWarning = true;
        } else {
          message = getMaxLengthMessage(
            params?.errors?.find(e => e?.params?.limit),
            isRCF
          );
        }
      }
      if (isWarning) {
        updateCache({ cache: warningsCache, resourceName: rName, failedItemName, message, fileName, stats, failedItemValue, isWarning });
        return acc;
      }

      updateCache({ cache: errorCache, resourceName: rName, failedItemName, message, fileName, stats, failedItemValue });
      return acc;
    },
    {}
  );
};

module.exports = {
  validatePayload,
  isValidDataDictionaryVersion,
  validate,
  combineErrors,
  VALIDATION_ERROR_MESSAGES
};
