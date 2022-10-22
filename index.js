#! /usr/bin/env node
const { program } = require('commander');
const { restore } = require('./utils/restore-utils');
const { runTests } = require('./utils/batch-test-runner');

program
  .name('reso-certification-utils')
  .description('Command line batch-testing and restore utils')
  .version('0.0.2');

program
  .command('restore')
  .option('-p, --pathToResults <string>', 'Path to test results')
  .option('-u, --url <string>', 'URL of Certification API')
  .option('-o, --overwrite', 'Flag to overwrite existing passed files')
  .description('Restores local or S3 results to a RESO Certification API instance')
  .action(restore);

program
  .command('runDDTests')
  .requiredOption('-p, --pathToConfigFile <string>', 'Path to config file')
  .option('-a, --runAvailability', 'Flag to run data availability tests, otherwise only metadata tests are run')
  .description('Runs Data Dictionary tests')
  .action(runTests);

program.parse();
