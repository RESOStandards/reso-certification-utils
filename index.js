#! /usr/bin/env node
const { program } = require('commander');
const { restore } = require('./utils/restore-utils');

program
  .name('reso-certification-utils')
  .description('Command line batch-testing and restore utils')
  .version('0.0.1');

program
  .command('restore')
  .option('-p, --pathToResults <string>', 'path to test results')
  .option('-u, --url <string>', 'URL of Certification API')
  .option('-o, --overwrite', 'Flag to overwrite existing passed files')
  .description('Restores local or S3 results to a RESO Certification API instance')
  .action(restore);

program.parse();
