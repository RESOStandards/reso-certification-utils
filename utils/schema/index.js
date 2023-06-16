'use strict';

const chalk = require('chalk');
const { promises: fs } = require('fs');
const { generateSchema, getResources } = require('./generate');
const path = require('path');
const { validatePayload } = require('./validate');

const readFile = async filePath => {
  try {
    return await fs.readFile(filePath);
  } catch (err) {
    console.error(`Could not read file from path '${filePath}'! Error: ${err}`);
  }
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

const schema = async (options = {}) => {
  const {
    metadataPath = '',
    outputPath = '',
    payloadPath = '',
    schemaPath = '',
    errorPath = '',
    generate = false,
    validate = false,
    additionalProperties = false,
    resource = 'property'
  } = options;
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
      const resources = getResources(metadataReportJson) || [];
      const resourceIndex = resources.map(r => r.toLowerCase()).indexOf(resource.toLowerCase());
      if (resourceIndex < 0) {
        console.log(chalk.redBright.bold(`Invalid resource: ${resource}`));
        return;
      }
      const schema = generateSchema(metadataReportJson, additionalProperties, resources[resourceIndex]);
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
      const payloadFilename =
        payloadPath?.slice(payloadPath?.lastIndexOf('/') + 1, payloadPath?.length) || '';
      const result = validatePayload(schemaJson, payloadsJson);
      if (result.errors) {
        console.log(result.errors);
        if (errorPath) {
          const success = await writeFile(
            path.join(errorPath, `ajv-error-${payloadFilename}.json`),
            JSON.stringify(result.errors)
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
            chalk.redBright.bold(
              'Errors truncated on stdout. Provide a directory to store error reports with -e'
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
};

module.exports = {
  schema
};
