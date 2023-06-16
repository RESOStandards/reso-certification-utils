#! /usr/bin/env node
const { program } = require('commander');
const { restore } = require('./utils/restore-utils');
const { runTests } = require('./utils/batch-test-runner');
const { schema } = require('./utils/schema');

program
  .name('reso-certification-utils')
  .description('Command line batch-testing and restore utils')
  .version('0.0.2');

program
  .command('restore')
  .option('-p, --pathToResults <string>', 'Path to test results')
  .option('-u, --url <string>', 'URL of Certification API')
  .description('Restores local or S3 results to a RESO Certification API instance')
  .action(restore);

program
  .command('runDDTests')
  .requiredOption('-p, --pathToConfigFile <string>', 'Path to config file')
  .option(
    '-a, --runAvailability',
    'Flag to run data availability tests, otherwise only metadata tests are run'
  )
  .description('Runs Data Dictionary tests')
  .action(runTests);

program
  .command('schema')
  .option('-g, --generate', 'Generate JSON schema from a metadata report')
  .option('-v, --validate', 'Validate a payload against a generated schema')
  .option('-m, --metadataPath <string>', 'Path to the metadata report JSON file')
  .option('-o, --outputPath <string>', 'Path tho the directory to store the generated schema')
  .option('-p, --payloadPath <string>', 'Path to the payload that needs to be validated')
  .option('-s, --schemaPath <string>', 'Path to the generated JSON schema')
  .option('-e, --errorPath <string>', 'Path to save error reports in case of failed validation')
  .option('-a, --additionalProperties', 'Pass this flag to allow additional properties in the schema')
  .option('-r, --resource <string>', 'The resource for which to generate the schema')
  .description('Generate a schema or validate a payload against a schema')
  .action(schema);

program.parse();
