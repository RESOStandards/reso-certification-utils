#! /usr/bin/env node
const { program } = require('commander');
const { restore } = require('./lib/restore-utils/data-dictionary');
const { runTests } = require('./lib/batch-test-runner');
const { syncWebApi } = require('./lib/restore-utils/web-api-core');

program
  .name('reso-certification-utils')
  .description('Command line batch-testing and restore utils')
  .version('0.0.2');

program
  .command('restore')
  .option('-p, --pathToResults <string>', 'Path to test results')
  .option('-u, --url <string>', 'URL of Certification API')
  .option('--deleteExistingReport', 'Flag to delete existing report')
  .description('Restores local or S3 results to a RESO Certification API instance')
  .action(restore);

program
  .command('syncWebApiResults')
  .option('-p, --pathToResults <string>', 'Path to test results')
  .option('-u, --url <string>', 'URL of Certification API')
  .option('-r, --recipients <string>', 'Comma-separated list of recipient orgs')
  .option('-i, --system <string>', 'Unique system identifier')
  .option('--deleteExistingReport', 'Flag to delete existing report')
  .description('Restores local or S3 Web API results to a RESO Certification API instance')
  .action(syncWebApi);

program
  .command('runDDTests')
  .requiredOption('-p, --pathToConfigFile <string>', 'Path to config file')
  .option(
    '-a, --runAvailability',
    'Flag to run data availability tests, otherwise only metadata tests are run'
  )
  .description('Runs Data Dictionary tests')
  .action(runTests);

program.parse();
