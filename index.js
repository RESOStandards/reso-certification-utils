#! /usr/bin/env node
const { program } = require('commander');
const { restore } = require('./utils/restore-utils');
const { runTests } = require('./utils/batch-test-runner');
const { findVariations } = require('./utils/find-variations/index.js');

program
  .name('reso-certification-utils')
  .description('Command line batch-testing and restore utils')
  .version('0.0.3');

program
  .command('restore')
  .option('-p, --pathToResults <string>', 'Path to test results')
  .option('-u, --url <string>', 'URL of Certification API')
  .description('Restores local or S3 results to a RESO Certification API instance')
  .action(restore);

program
  .command('runDDTests')
  .requiredOption('-p, --pathToConfigFile <string>', 'Path to config file')
  .option('-a, --runAvailability', 'Flag to run data availability tests, otherwise only metadata tests are run')
  .description('Runs Data Dictionary tests')
  .action(runTests);

program
  .command('findVariations')
  .requiredOption('-p, --pathToMetadataReportJson <string>', 'Path to metadata-report.json file')
  .option('-f, --fuzziness <float>', 'Set fuzziness to something besides the default')
  .option('-v, --version <string>', 'Data Dictionary version to compare to, i.e. 1.7 or 2.0')
  .option('-d, --debug', 'Pass to see extra debugging information')
  .description('Finds possible variations in metadata using a number of methods.')
  .action(findVariations);

program.parse();
