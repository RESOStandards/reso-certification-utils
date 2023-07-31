'use strict';

const chalk = require('chalk');
const { promises: fs } = require('fs');
const { generateSchema } = require('./generate');
const path = require('path');
const { validatePayload } = require('./validate');
const { extractFilesFromZip } = require('../../common');
const { readDirectory } = require('../restore-utils');

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

const schema = async ({
  metadataPath = '',
  outputPath = '',
  payloadPath = '',
  schemaPath = '',
  errorPath = 'errors',
  generate = false,
  validate = false,
  additionalProperties = false,
  zipFilePath = ''
}) => {
  if ((!generate && !validate) || (generate && validate)) {
    console.log(chalk.yellowBright.bold('Invalid options'));
    return;
  }

  if (generate) {
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
      console.log(
        chalk.greenBright.bold(`Schema successfully generated and saved in ${outputPath}/${fileName}`)
      );
    } catch (error) {
      console.log(error);
      console.log(chalk.redBright.bold('Something went wrong while generating the schema'));
    }
  } else if (validate) {
    if (zipFilePath) {
      const outputPathExists = await createDirectoryIfNotPresent(OUTPUT_DIR);
      if (!outputPathExists) {
        throw new Error('Unable to create output directory for extracted files');
      }
      await extractFilesFromZip({ outputPath: OUTPUT_DIR, zipPath: zipFilePath });
      const files = await readDirectory(OUTPUT_DIR);

      if (!files.length) throw new Error(`No JSON files found in the archive at ${zipFilePath}`);

      for (const file of files) {
        const filePath = path.join(OUTPUT_DIR, file);
        await validatePayloadAndGenerateResults({
          errorPath,
          schemaPath,
          payloadPath: filePath
        });
      }
    } else {
      await validatePayloadAndGenerateResults({
        errorPath,
        payloadPath,
        schemaPath
      });
    }
  }
};

async function validatePayloadAndGenerateResults({ schemaPath, payloadPath, errorPath }) {
  try {
    const schemaJson = JSON.parse((await readFile(schemaPath)) || null);
    if (!schemaJson) {
      console.log(chalk.redBright.bold('Invalid schema file'));
      return;
    }
    const payloadsJson = JSON.parse((await readFile(payloadPath)) || null);
    if (!payloadsJson) {
      console.log(chalk.redBright.bold('Invalid payloads file'));
      return;
    }
    const payloadFilename = payloadPath?.slice(payloadPath?.lastIndexOf('/') + 1, payloadPath?.length) || '';
    const result = validatePayload(payloadsJson, schemaJson);
    if (result.errors) {
      const errorDirectoryExists = await createDirectoryIfNotPresent(errorPath);
      if (!errorDirectoryExists) throw new Error('Unable to create error directory');

      const success = await writeFile(
        path.join(errorPath, `ajv-error-${payloadFilename}.json`),
        JSON.stringify(result)
      );
      if (!success) {
        console.log(chalk.redBright.bold('Error writing error data to the given location'));
        return;
      } else {
        console.log(
          chalk.yellowBright.bold(
            `Written the validation errors to the file ${errorPath}/ajv-error-${payloadFilename}.json`
          )
        );
      }
    } else {
      console.log(
        chalk.greenBright.bold('The payload was successfully validated against the provided schema')
      );
    }
  } catch (error) {
    console.log(error);
    console.log(chalk.redBright.bold('Something went wrong while validating the payload'));
  }
}

module.exports = {
  schema
};
