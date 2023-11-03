'use strict';

const chalk = require('chalk');
const { promises: fs } = require('fs');
const { generateSchema, generateJsonSchema } = require('./generate');
const path = require('path');
const { validatePayload, isValidDdVersion, validate, combineErrors } = require('./validate');
const { CURRENT_DATA_DICTIONARY_VERSION } = require('../../common');
const { readDirectory } = require('../restore-utils');
const { getReferenceMetadata } = require('reso-certification-etl');
const { processFiles, createDirectoryIfNotPresent, writeFile, readFile } = require('./utils');

const OUTPUT_DIR = 'reso-schema-validation-temp';
const ERROR_REPORT = 'schema-validation-report.json';

const schema = async ({
  metadataPath = '',
  outputPath = '.',
  additionalProperties = false,
  generate,
  validate,
  ddVersion,
  payloadPath,
  resourceName
}) => {
  try {
    if ((!generate && !validate) || (generate && validate)) {
      console.log(chalk.redBright('Only one of --generate (-g) or --validate (-v) should be passed'));
      return;
    }

    if (metadataPath && ddVersion) {
      console.log(chalk.redBright('Only one of --metadataPath (-m) or --ddVersion (-dv) should be present'));
      return;
    }

    const version = ddVersion ?? CURRENT_DATA_DICTIONARY_VERSION;

    if (!isValidDdVersion(version)) {
      console.log(chalk.redBright(`Invalid DD Version ${version}`));
      return;
    }

    if (generate) {
      let metadataReport = null;
      if (!metadataPath) {
        metadataReport = getReferenceMetadata(version);
        if (!metadataReport) {
          console.log(chalk.redBright(`Invalid version ${version}`));
          return;
        }
      }
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
          console.log(chalk.redBright.bold('Error writing generated schema to the given location'));
          return;
        }
        console.log(chalk.greenBright.bold(`Schema successfully generated and saved in ${outputPath}/${fileName}`));
      }

      return;
    }

    if (validate) {
      if (!payloadPath) {
        console.log(chalk.redBright('Invalid path to payloads'));
        return;
      }

      if ((ddVersion && !resourceName) || (resourceName && !ddVersion)) {
        console.log(chalk.redBright('Resource name (-r, --resourceName) and version (-dv, ddVersion) should be passed together'));
        return;
      }

      try {
        await fs.rm(OUTPUT_DIR, { recursive: true, force: true });
      } catch {
        /**ignore */
      }

      const outputPathExists = await createDirectoryIfNotPresent(OUTPUT_DIR);
      if (!outputPathExists) {
        throw new Error('Unable to create output directory for extracted files');
      }

      const { error } = (await processFiles({ inputPath: payloadPath, outputPath: OUTPUT_DIR })) || {};
      if (error) {
        console.log(chalk.redBright('Invalid payload path'));
        return;
      }

      await validatePayloads({
        metadataPath,
        payloadPath: OUTPUT_DIR,
        additionalProperties,
        version: ddVersion,
        resourceName
      });
    }
  } catch (error) {
    console.log(error);
    console.log(chalk.redBright('Something went wrong while processing'));
  }
};

const generateSchemaFromMetadata = async ({ metadataPath = '', additionalProperties = false, metadataReport }) => {
  try {
    const metadataReportJson = metadataPath ? JSON.parse((await readFile(metadataPath)) || null) : metadataReport;
    if (!metadataReportJson) {
      console.log(chalk.redBright.bold('Invalid metadata file'));
      return;
    }
    const schema = generateSchema(metadataReportJson, additionalProperties);
    if (!schema) {
      console.log(chalk.redBright.bold('Error generating JSON schema from the given metadata report'));
      return;
    }
    return { schema };
  } catch (error) {
    console.log(error);
    console.log(chalk.redBright.bold('Something went wrong while generating the schema'));
  }
};

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
      console.log(
        chalk.bgRed.bold('Unable to generate a schema file. Pass the schema/metadata file in the options or check for invalid DD version.')
      );
      return;
    }

    const payloadsJson = {};
    for (const payloadPath of payloadPaths) {
      const payloadJson = JSON.parse((await readFile(payloadPath)) || null);
      if (!payloadJson) {
        console.log(chalk.redBright.bold('Invalid payload file'));
        continue;
      }
      const payloadFilename = payloadPath?.slice(payloadPath?.lastIndexOf('/') + 1, payloadPath?.length) || '';
      payloadsJson[payloadFilename] = payloadJson;
    }
    if (!Object.keys(payloadsJson).length) {
      console.log(chalk.redBright.bold('No payloads could be found'));
      return;
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
        console.log(chalk.redBright.bold('Error writing error data to the given location'));
        return;
      } else {
        console.log(chalk.yellowBright.bold(`Written the validation errors to the file ${errorPath}/error-report.json`));
      }
    } else {
      console.log(chalk.greenBright.bold('The payload was successfully validated against the provided schema'));
    }
  } catch (error) {
    console.log(error);
    console.log(chalk.redBright.bold('Something went wrong while validating the payload'));
  }
};

module.exports = {
  schema,
  generateJsonSchema,
  validate,
  combineErrors
};
