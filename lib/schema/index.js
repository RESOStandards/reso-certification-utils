'use strict';

const chalk = require('chalk');
const { promises: fs } = require('fs');
const { generateSchema } = require('./generate');
const path = require('path');
const { validatePayload } = require('./validate');
const { extractFilesFromZip } = require('../../common');
const { readDirectory } = require('../restore-utils');
const { getReferenceMetadata } = require('reso-certification-etl');

const OUTPUT_DIR = 'output';

const readFile = async filePath => {
  try {
    return await fs.readFile(filePath);
  } catch (err) {
    console.error(`Could not read file from path '${filePath}'! Error: ${err}`);
    return null;
  }
};

const createDirectoryIfNotPresent = async dirName => {
  try {
    await fs.stat(dirName);
  } catch (error) {
    try {
      await fs.mkdir(dirName);
    } catch (error) {
      return null;
    }
  }
  return true;
};

const writeFile = async (path, data) => {
  try {
    await fs.writeFile(path, data);
    return true;
  } catch (error) {
    console.log(error);
    return false;
  }
};

const generate = async ({ metadataPath = '', outputPath = '', additionalProperties = false }) => {
  try {
    const metadataReportJson = JSON.parse((await readFile(metadataPath)) || null);
    if (!metadataReportJson) {
      console.log(chalk.redBright.bold('Invalid metadata file'));
      return;
    }
    const schema = generateSchema(metadataReportJson, additionalProperties);
    if (!schema) {
      console.log(chalk.redBright.bold('Error generating JSON schema from the given metadata report'));
      return;
    }
    // write schema to the output path
    const fileName = 'schema-' + (metadataPath?.split('/')?.at(-1) || '');
    const success = await writeFile(path.join(outputPath, fileName), JSON.stringify(schema));
    if (!success) {
      console.log(chalk.redBright.bold('Error writing generated schema to the given location'));
      return;
    }
    console.log(chalk.greenBright.bold(`Schema successfully generated and saved in ${outputPath}/${fileName}`));
  } catch (error) {
    console.log(error);
    console.log(chalk.redBright.bold('Something went wrong while generating the schema'));
  }
};

const validate = async ({
  metadataPath = '',
  payloadPath = '',
  schemaPath = '',
  errorPath = 'errors',
  additionalProperties = false,
  zipFilePath = '',
  version = '1.7'
}) => {
  if (zipFilePath) {
    try {
      await fs.rm(OUTPUT_DIR, { recursive: true, force: true });
    } catch {
      /**ignore */
    }
    const outputPathExists = await createDirectoryIfNotPresent(OUTPUT_DIR);
    if (!outputPathExists) {
      throw new Error('Unable to create output directory for extracted files');
    }
    //TODO: make this be independent of CLI usage.
    await extractFilesFromZip({ outputPath: OUTPUT_DIR, zipPath: zipFilePath });
    const files = await readDirectory(OUTPUT_DIR);

    if (!files.length) throw new Error(`No JSON files found in the archive at ${zipFilePath}`);

    await validatePayloadAndGenerateResults({
      errorPath,
      schemaPath,
      payloadPaths: files.map(f => path.join(OUTPUT_DIR, f)),
      version,
      metadataPath,
      additionalProperties
    });
  } else {
    await validatePayloadAndGenerateResults({
      errorPath,
      payloadPaths: [payloadPath],
      schemaPath,
      version,
      metadataPath,
      additionalProperties
    });
  }
};

async function validatePayloadAndGenerateResults({ schemaPath, payloadPaths, errorPath, version, metadataPath, additionalProperties }) {
  try {
    let schemaJson = schemaPath ? JSON.parse((await readFile(schemaPath)) || null) : null;
    if (!schemaJson) {
      let metadataJson = metadataPath ? JSON.parse((await readFile(metadataPath)) || null) : null;
      if (!metadataJson) {
        // use RESO metadata report instead
        metadataJson = getReferenceMetadata(version);
        schemaJson = generateSchema(metadataJson, true);
      } else {
        schemaJson = generateSchema(metadataJson, additionalProperties);
      }
      if (!schemaJson) {
        console.log(
          chalk.bgRed.bold(
            'Unable to generate a schema file. Pass the schema/metadata file in the options or check for invalid DD version.'
          )
        );
        return;
      }
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
    const result = validatePayload(payloadsJson, schemaJson);
    if (result.errors) {
      const errorDirectoryExists = await createDirectoryIfNotPresent(errorPath);
      if (!errorDirectoryExists) throw new Error('Unable to create error directory');

      const success = await writeFile(
        path.join(errorPath, 'error-report.json'),
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
}

module.exports = {
  validate,
  generate
};
