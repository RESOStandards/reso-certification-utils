'use strict';

const fs = require('fs/promises');
const fsPromises = fs;
const path = require('path');
const { readZipFileContents, DATA_DICTIONARY_VERSIONS, parseResoUrn } = require('../../common');
const { validationContext } = require('./context');

const IGNORE_ENUMS = 'ignoreEnumerations';

/**
 * @param {Object} obj
 * @param {string} obj.inputPath
 * @param {{}} obj.fileContentsMap
 *
 * @description Takes an input path as a JSON file, directory, or zip file. Flattens all nested JSON files into the output directory.
 */
const processFiles = async ({ inputPath, fileContentsMap }) => {
  const stats = await fsPromises.stat(inputPath);

  if (stats.isFile()) {
    const fileName = inputPath.slice(inputPath.lastIndexOf('/') + 1, inputPath.length);
    const contents = await processFile({ filePath: inputPath });
    if (fileName.endsWith('.zip')) {
      Object.keys(contents).forEach(file => {
        contents[file] = JSON.parse(contents[file]);
      });
      Object.assign(fileContentsMap, contents);
    } else {
      fileContentsMap[fileName] = contents;
    }
  } else if (stats.isDirectory()) {
    const files = await fsPromises.readdir(inputPath);
    for (const file of files) {
      const fileName = file.slice(file.lastIndexOf('/') + 1, file.length);
      const content = await processFile({
        filePath: path.join(inputPath, file)
      });
      if (fileName.endsWith('.zip')) {
        Object.keys(content).forEach(file => {
          content[file] = JSON.parse(content[file]);
        });
        Object.assign(fileContentsMap, content);
      } else {
        fileContentsMap[fileName] = content;
      }
    }
  } else {
    console.error(`Unsupported file type: ${inputPath}`);
  }
};

/**
 * @param {Object} obj
 * @param {string} obj.filePath
 *
 * @description Process JSON and zip files and copy them to the output path
 */
const processFile = async ({ filePath }) => {
  const ext = path.extname(filePath);

  if (ext === '.json') {
    return JSON.parse((await readFile(filePath)).toString());
  } else if (ext === '.zip') {
    return readZipFileContents(filePath);
  } else {
    console.error(`Unsupported file type: ${filePath}`);
  }
};

/**
 *
 * TODO: this already exists elsewhere - move to common
 *
 * @param {string} filePath
 * @returns Contents read from the file. Returns null if file isn't present.
 */
const readFile = async filePath => {
  try {
    return await fs.readFile(filePath);
  } catch (err) {
    console.error(`Could not read file from path '${filePath}'! Error: ${err}`);
    return null;
  }
};

/**
 * @param {string} dirName
 *
 * @description Checks if a directory exists. If not it creates the directory. If there was an error creating the directory, it returns null otherwise a truthy value.
 */
const createDirectoryIfNotPresent = async dirName => {
  try {
    await fs.stat(dirName);
  } catch (err) {
    try {
      await fs.mkdir(dirName);
    } catch (err) {
      return null;
    }
  }
  return true;
};

/**
 * @param {string} path
 * @param {string} data
 *
 * @description Attempts to write data intp a given file path. Returns tru on success and false in case of a failure.
 */
const writeFile = async (path, data) => {
  await fs.writeFile(path, data);
  return true;
};

/**
 *
 * @param {Object} obj
 * @param {string[]} obj.arr
 * @param {boolean} obj.isValueArray
 * @returns
 */
const parseNestedPropertyForResourceAndField = ({ arr, isValueArray }) => {
  if (isValueArray) {
    let arrIndexCount = 0;
    arr.forEach(a => {
      if (typeof Number(a) === 'number' && !isNaN(Number(a))) arrIndexCount++;
    });
    if (arrIndexCount >= 2) {
      const lastElement = arr.at(-1);
      if (typeof Number(lastElement) === 'number' && !isNaN(Number(lastElement))) {
        return {
          fieldName: arr[2]
        };
      }
      return {
        resourceName: arr[2],
        fieldName: arr[4]
      };
    } else {
      return {
        fieldName: arr[2]
      };
    }
  } else {
    if (arr.length === 3) {
      return {
        resourceName: arr[0],
        fieldName: arr[2]
      };
    } else {
      return {
        fieldName: arr[0]
      };
    }
  }
};

/**
 *
 * @param {Object} obj
 * @param {string} obj.string
 * @param {string} obj.enums
 * @param {string} obj.resourceName
 * @param {string} obj.fieldName
 * @param {Object} obj.schema
 *
 * @returns {string[]}
 */
const resolveStringList = ({ string, enums, schema, resourceName, fieldName }) => {
  // if enum is of string type, no need to split
  if (schema?.definitions?.MetadataMap?.[resourceName]?.[fieldName]?.lookupValues?.[string]?.isStringEnumeration) {
    return [string];
  }
  if (enums.includes(string)) return [string];

  // if type is anything other than Edm.String, we can split on commas
  return string.split(',');
};

const addCustomValidationForEnum = ajv => {
  ajv.removeKeyword('enum');

  ajv.addKeyword({
    keyword: 'enum',
    validate: function validate(schema, data, _, ctx) {
      const valid = [];
      const nestedPayloadProperties = ctx?.instancePath?.split('/')?.slice(1) || [];

      const resourceName = validationContext.getActiveResource();
      const version = validationContext.getVersion();
      const validationConfig = validationContext.getValidationConfig();
      const activeSchema = validationContext.getSchema();
      const isValueArray = validationContext.getPayloadType() === 'MULTI';

      const { fieldName } = parseNestedPropertyForResourceAndField({
        arr: nestedPayloadProperties,
        isValueArray
      });

      if (typeof data === 'string') {
        // Process the string to convert it into an array based on the enum definitions.
        const parsedEnumValues = resolveStringList({
          string: data,
          enums: schema,
          resourceName,
          fieldName,
          schema: activeSchema
        });

        // Validate each item against the schema's enum
        for (const enumValue of parsedEnumValues) {
          if (schema.includes(enumValue)) {
            valid.push(true);
          } else {
            // Collect the needed error data if validation fails
            valid.push(false);
            let errorMessage;
            if (validationConfig?.[version]?.[resourceName]?.[fieldName]?.[IGNORE_ENUMS]) {
              // convert to warning is the failed field is ingored in the validation config
              errorMessage = {
                keyword: 'enum',
                failedItemValue: enumValue,
                params: {
                  allowedValues: schema
                },
                message: `The following enumerations in the ${fieldName} Field were not advertised. This will fail in Data Dictionary 2.1`,
                isWarning: true
              };
            } else {
              errorMessage = {
                keyword: 'enum',
                failedItemValue: enumValue,
                params: {
                  allowedValues: schema
                },
                message: 'must be equal to one of the allowed values'
              };
            }
            validate.errors = validate.errors || [];
            validate.errors.push(errorMessage);
          }
        }
      } else {
        // Non-string data should not be validated here; let other validations handle that.
        return true;
      }
      return valid.every(Boolean); // Only return true if all validations passed
    },
    errors: true // This option tells AJV to use custom errors collected in validate.errors
  });
};

const VALIDATION_ERROR_MESSAGES = Object.freeze({
  NO_CONTEXT_PROPERTY: 'No properties were found in the payload that match "@reso.context"'
});

const SCHEMA_ERROR_KEYWORDS = {
  MAX_LENGTH: 'maxLength',
  ERROR_MESSAGE: 'errorMessage',
  ENUM: 'enum',
  ADDITIONAL_PROPERTIES: 'additionalProperties',
  TYPE: 'type',
  OBJECT: 'object',
  NULL: 'null'
};

/**
 * TODO
 * @param {*} value
 * @returns {'string'|'number'|'boolean'|'undefined'|'object'|'function'|'symbol'|'bigint'|'null'|'integer'|'array'|'decimal'} The type of the value.
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

const getValidDataDictionaryVersions = () => Object.values(DATA_DICTIONARY_VERSIONS ?? {});
const isValidDataDictionaryVersion = (version = '') => getValidDataDictionaryVersions()?.includes(version);

/**
 * Combines results from one or more validations into one object.
 *
 * @param {Object} obj
 * @param {{}} obj.errorCache
 * @param {{}} obj.warningsCache
 * @param {{}} obj.payloadErrors
 * @param {{totalWarnings: number, totalErrors: number}} obj.stats
 * @returns {Object} Consolidated error and warning report
 */
const combineErrors = ({ errorCache, warningsCache, payloadErrors, stats }) => {
  const errorReport = [];

  // Helper function to process either errors or warnings from cache
  const processCache = (cache, type) => {
    Object.entries(cache).forEach(([resource, fields]) => {
      Object.entries(fields).forEach(([fieldName, errors]) => {
        Object.entries(errors).forEach(([, details]) => {
          if (!details) return;

          const occurrences = Object.entries(details).map(([fileKey, fileDetails]) => ({
            count: fileDetails.occurrences,
            ...parseFileName(fileKey),
            message: details?.[fileKey]?.message
          }));
          const message = occurrences[0]?.message || '';
          addReport(
            errorReport,
            resource,
            fieldName,
            type,
            message,
            occurrences.map(({ message: _, ...rest }) => rest)
          );
        });
      });
    });
  };

  // Helper function to parse the filename for any given key pattern like '<file>__<lookup>'
  const parseFileName = fileKeyName => {
    const [fileName, lookupValue] = fileKeyName.split('__');
    return {
      ...(fileName && { fileName }),
      ...(lookupValue && { lookupValue })
    };
  };

  // Helper function to add error/warning data to errorReport
  const addReport = (report, resource, fieldName, type, message, occurrences) => {
    let fieldData = report.find(x => x.resourceName === resource && x.fieldName === fieldName);
    if (!fieldData) {
      fieldData = { resourceName: resource, fieldName: fieldName, errors: [], warnings: [] };
      report.push(fieldData);
    }
    fieldData[type].push({ message, occurrences });
  };

  // Process errors and warnings
  processCache(errorCache, 'errors');
  processCache(warningsCache, 'warnings');

  // Process payload errors
  Object.entries(payloadErrors).forEach(([resource, messages]) => {
    Object.entries(messages).forEach(([message, files]) => {
      const occurrences = files.map(fileName => ({
        count: 1, // Static count since payload errors are listed individually
        fileName
      }));
      addReport(errorReport, resource, '', 'errors', message, occurrences);
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

const parseSchemaPath = (path = '') => {
  const schemaPathParts = path.split('/');
  if (schemaPathParts?.[1] === 'definitions') {
    return schemaPathParts[2];
  }
  return null;
};

const checkMapParams = (paramName = '') => {
  if (paramName === '__proto__' || paramName === 'constructor' || paramName === 'prototype') {
    throw new Error(`Invalid property value: '${paramName}'`);
  }
};

/**
 *
 * @param {Object} obj
 * @param {{}} obj.cache
 * @param {String} obj.resourceName
 * @param {String} obj.failedItemName
 * @param {String} obj.failedItemValue
 * @param {String} obj.message
 * @param {String} obj.fileName
 * @param {{totalErrors: Number, totalWarnings: Number}} obj.stats
 * @param {boolean} obj.isWarning
 *
 * @description Updates the cache with a new error message
 */
const updateCache = ({ cache, resourceName, failedItemName, message, fileName, stats, failedItemValue, isWarning }) => {
  if (!cache[resourceName]) {
    cache[resourceName] = {};
  }

  if (!cache[resourceName][failedItemName]) {
    cache[resourceName][failedItemName] = {};
  }

  if (!cache[resourceName][failedItemName][`__${message}`]) {
    cache[resourceName][failedItemName][`__${message}`] = {};
  }
  if (!cache[resourceName][failedItemName][`__${message}`][`${fileName}__${failedItemValue}`]) {
    cache[resourceName][failedItemName][`__${message}`][`${fileName}__${failedItemValue}`] = {
      // capitalize first word like MUST, SHOULD etc
      message: !message.startsWith(isWarning ? 'The' : 'Fields')
        ? message.slice(0, message.indexOf(' ')).toUpperCase() + message.slice(message.indexOf(' '), message.length)
        : message,
      occurrences: 1
    };
  } else {
    cache[resourceName][failedItemName][`__${message}`][`${fileName}__${failedItemValue}`].occurrences++;
  }
  isWarning ? stats.totalWarnings++ : stats.totalErrors++;
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
 * @param {{params?: {limit?: number}}} limitObject The AJV limit object
 * @param {*} isRCF Boolean Value specifying RCF or DD testing mode
 */
const getMaxLengthMessage = (limitObject, isRCF) => {
  const limit = limitObject?.params?.limit || 0;
  if (isRCF) {
    return `SHOULD have a maximum suggested length of ${limit} characters`;
  } else {
    return `MUST have a maximum advertised length of ${limit} characters`;
  }
};

module.exports = {
  processFiles,
  readFile,
  createDirectoryIfNotPresent,
  writeFile,
  parseNestedPropertyForResourceAndField,
  addCustomValidationForEnum,
  VALIDATION_ERROR_MESSAGES,
  SCHEMA_ERROR_KEYWORDS,
  determineType,
  addPayloadError,
  normalizeAtField,
  getValidDataDictionaryVersions,
  isValidDataDictionaryVersion,
  combineErrors,
  parseSchemaPath,
  checkMapParams,
  updateCache,
  getResourceAndVersion,
  getMaxLengthMessage
};
