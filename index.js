#! /usr/bin/env node
const { program } = require('commander');
const { restore } = require('./utils/restore-utils');
const { runTests } = require('./utils/batch-test-runner');
const { transform } = require('./utils/transform');
const { backup } = require('./utils/backup');

program
  .name('reso-certification-utils')
  .description('Command line batch-testing and restore utils')
  .version('0.0.2');

program
  .command('restore')
  .option('-p, --pathToResults <string>', 'Path to test results')
  .option('-u, --url <string>', 'URL of Certification API')
  .option('-r, --restoreFromBackup', 'Flag to restore from a backup of a Cert API server.')
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
  .command('transform')
  .option('-u, --url <string>', 'URL of Certification API')
  .option('-r, --rescore', 'Flag to rescore the reports by re-running them through the ETL process.')
  .option('-b, --backup', 'Flag to create backup of a Cert API server in a specified path.')
  .option('-p, --pathToBackup <string>', 'Path where to store the backup of the reports.')
  .description('Error corrects the frequency count of fields and rescored the results')
  .action(transform);

program
  .command('backup')
  .option('-u, --url <string>', 'URL of Certification API')
  .option('-p, --pathToBackup <string>', 'Path where to store the backup of the reports.')
  .option('-d, --dataDictionary', 'Flag to only backup the data dictionary and data availability reports.')
  .option('-w, --webApi', 'Flag to only backup the web api reports.')
  .description('Backs up the reports from a Cert API server to a specified path.')
  .action(backup);

program.parse();
