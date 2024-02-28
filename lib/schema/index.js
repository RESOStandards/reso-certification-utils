'use strict';

const { promises: fs } = require('fs');
const { generateSchema, generateJsonSchema } = require('./generate');
const path = require('path');
const { validatePayload, isValidDataDictionaryVersion, validate, combineErrors, VALIDATION_ERROR_MESSAGES } = require('./validate');
const { CURRENT_DATA_DICTIONARY_VERSION, getErrorHandler } = require('../../common');
const { readDirectory } = require('../restore');
const { getReferenceMetadata } = require('@reso/reso-certification-etl');
const { processFiles, createDirectoryIfNotPresent, writeFile, readFile } = require('./utils');

const OUTPUT_DIR = 'reso-schema-validation-temp';
const ERROR_REPORT = 'schema-validation-report.json';

/**
 * @param {Object} obj
 * @param {boolean} obj.additionalProperties
 * @param {boolean} obj.generate
 * @param {boolean} obj.validate
 * @param {string} obj.metadataPath
 * @param {string} obj.outputPath
 * @param {string} obj.version
 * @param {string} obj.payloadPath
 * @param {string} obj.resourceName
 *
 * @description Action handler for the commander CLI `schema` command.
 */
const schema = async ({
  metadataPath = '',
  outputPath = '.',
  additionalProperties = false,
  generate,
  validate,
  version = CURRENT_DATA_DICTIONARY_VERSION,
  payloadPath,
  resourceName,
  fromCli = false
}) => {

  const handleError = getErrorHandler(fromCli);

  try {
    if (fromCli) {
      if ((!generate && !validate) || (generate && validate)) {
        handleError('Only one of --generate (-G) or --validate (-V) should be passed');
      }
    }

    if (!isValidDataDictionaryVersion(version)) {
      handleError(`Invalid Data Dictionary version: '${version}'`);
    }

    if (generate) {
      let metadataReport = null;
      if (!metadataPath) {
        metadataReport = getReferenceMetadata(version);
        if (!metadataReport) {
          handleError(`Invalid version ${version}`);
        }
      }

      try {
        const result = await generateSchemaFromMetadata({
          metadataPath,
          metadataReport,
          additionalProperties
        });

        if (result?.schema) {
          const { schema } = result;

          // write schema to the output path
          const fileName = 'schema-' + (metadataPath?.split('/')?.at(-1) || 'metadata.json');
          const success = await writeFile(path.join(outputPath, fileName), JSON.stringify(schema));
          if (!success) {
            handleError('Error writing generated schema to the given location');
          }

          if (fromCli) {
            console.log(`Schema successfully generated and saved in ${outputPath}/${fileName}`);
          }
        }
      } catch (err) {
        handleError(err);
      }
    } else if (validate) {
      if (!payloadPath) {
        handleError('Invalid path to payloads');
      }

      if (!(resourceName && version)) {
        handleError('Resource name (-r, --resourceName) and version (-v, --version) should be passed together');
      }

      await fs.rm(OUTPUT_DIR, { recursive: true, force: true });

      const outputPathExists = await createDirectoryIfNotPresent(OUTPUT_DIR);
      if (!outputPathExists) {
        handleError('Unable to create output directory for extracted files');
      }

      try {
        await processFiles({ inputPath: payloadPath, outputPath: OUTPUT_DIR });

        await validatePayloads({
          metadataPath,
          payloadPath: OUTPUT_DIR,
          additionalProperties,
          version,
          resourceName
        });
      } catch (err) {
        handleError(err);
      }
    }
  } catch (err) {
    handleError(`Something went wrong! Error: ${err}`);
  }
};

/**
 * Generates JSON schema from the given metadata
 * @param {Object} obj
 * @param {boolean} obj.additionalProperties
 * @param {string} obj.metadataPath
 * @param {{}} obj.metadataReport
 * @returns generated schema
 */
const generateSchemaFromMetadata = async ({ metadataPath = '', additionalProperties = false, metadataReport }) => {
  try {
    const metadataReportJson = metadataPath ? JSON.parse((await readFile(metadataPath)) || null) : metadataReport;
    if (!metadataReportJson) {
      throw new Error('Invalid metadata file!');
    }

    const schema = generateSchema(metadataReportJson, additionalProperties);
    if (!schema) {
      throw new Error('Error generating JSON schema from the given metadata report');
    }

    return { schema };
  } catch (err) {
    throw new Error(`Something went wrong while generating the schema! Error: ${err}`);
  }
};

/**
 *
 * @param {Object} obj
 * @param {boolean} obj.additionalProperties
 * @param {string} obj.metadataPath
 * @param {string} obj.payloadPath
 * @param {string} obj.version
 * @param {string} obj.resourceName
 *
 * @description Reads the directory with the flattened JSON files and sends them for validation.
 */
const validatePayloads = async ({ metadataPath = '', payloadPath = '', additionalProperties = false, version, resourceName }) => {
  const files = await readDirectory(payloadPath);

  if (!files.length) throw new Error(`No JSON files found at ${payloadPath}`);

  await validatePayloadAndGenerateResults({
    errorPath: '.',
    payloadPaths: files.map(f => path.join(OUTPUT_DIR, f)),
    version,
    metadataPath,
    additionalProperties,
    resourceName
  });
};

/**
 *
 * @param {Object} obj
 * @param {boolean} obj.additionalProperties
 * @param {string} obj.errorPath
 * @param {string} obj.version
 * @param {string} obj.metadataPath
 * @param {string} obj.resourceName
 * @param {string[]} obj.payloadPaths
 *
 * @description Processes the input from the CLI and writes the final error report into the given path.
 */
const validatePayloadAndGenerateResults = async ({
  payloadPaths,
  errorPath,
  version,
  metadataPath,
  additionalProperties,
  resourceName
}) => {
  try {
    let schemaJson = null;

    let metadataJson = metadataPath ? JSON.parse((await readFile(metadataPath)) || null) : null;
    if (!metadataJson) {
      // use RESO metadata report instead
      metadataJson = getReferenceMetadata(version);
      schemaJson = generateSchema(metadataJson, additionalProperties);
    } else {
      schemaJson = generateSchema(metadataJson, additionalProperties);
    }

    if (!schemaJson) {
      throw new Error('Unable to generate a schema file. Pass the schema/metadata file in the options or check for invalid DD version.');
    }

    const payloadsJson = {};
    for (const payloadPath of payloadPaths) {
      const payloadJson = JSON.parse((await readFile(payloadPath)) || null);
      if (!payloadJson) {
        console.log('Invalid payload file...skipping!');
        continue;
      }
      const payloadFilename = payloadPath?.slice(payloadPath?.lastIndexOf('/') + 1, payloadPath?.length) || '';
      payloadsJson[payloadFilename] = payloadJson;
    }

    if (!Object.keys(payloadsJson).length) {
      throw new Error('No payloads could be found');
    }

    const result = validatePayload({
      payloads: payloadsJson,
      schema: schemaJson,
      resourceNameFromArgs: resourceName,
      versionFromArgs: version
    });

    if (result?.errors) {
      const errorDirectoryExists = await createDirectoryIfNotPresent(errorPath);
      if (!errorDirectoryExists) throw new Error('Unable to create error directory');

      const success = await writeFile(
        path.join(errorPath, ERROR_REPORT),
        JSON.stringify({
          ...(result.errors || {})
        })
      );

      if (!success) {
        throw new Error('Error writing error data to the given location');
      } else {
        console.log(`Validation errors written to: ${errorPath}/${ERROR_REPORT}`);
      }
    } else {
      console.log('The payload was successfully validated against the provided schema');
    }
  } catch (err) {
    throw new Error(`Something went wrong while validating the payload! Error: ${err}`);
  }
};

module.exports = {
  schema,
  generateJsonSchema,
  validate,
  combineErrors,
  VALIDATION_ERROR_MESSAGES
};
