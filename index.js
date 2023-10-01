#! /usr/bin/env node
const { restore } = require('./lib/restore-utils');
const { runTests } = require('./lib/batch-test-runner');
const { findVariations, computeVariations } = require('./lib/find-variations');
const { replicate } = require('./lib/replication');
const { convertMetadata, convertAndSaveMetadata } = require('./lib/metadata');

//Only load commander interpreter if running from the CLI
if (require?.main === module) {
  const { program } = require('commander');

  program.name('reso-certification-utils').description('Command line batch-testing and restore utils').version('0.0.5');

  program
    .command('restore')
    .description('Restores local or S3 results to a RESO Certification API instance')
    .option('-p, --pathToResults <string>', 'Path to test results')
    .option('-u, --url <string>', 'URL of Certification API')
    .option('-c, --console <boolean>', 'Show output to console', true)
    .action(restore);

  program
    .command('runDDTests')
    .description('Runs Data Dictionary tests')
    .requiredOption('-p, --pathToConfigFile <string>', 'Path to config file')
    .option('-a, --runAvailability', 'Flag to run data availability tests, otherwise only metadata tests are run')
    .option('-c, --console <boolean>', 'Show output to console', true)
    .action(runTests);

  program
    .command('findVariations')
    .description('Finds possible variations in metadata using a number of methods.')
    .requiredOption('-p, --pathToMetadataReportJson <string>', 'Path to metadata-report.json file')
    .option('-f, --fuzziness <float>', 'Set fuzziness to something besides the default')
    .option('-v, --version <string>', 'Data Dictionary version to compare to, i.e. 1.7 or 2.0')
    .option('-c, --console <boolean>', 'Show output to console', true)
    .action(findVariations);

  program
    .command('replicate')
    .description('Replicates data from a given resource with expansions.')
    .requiredOption('-s, --strategy <string>', 'One of TopAndSkip, ModificationTimestampAsc, ModificationTimestampDesc, or NextLink')
    .option('-u, --url <string>', 'The URL to start replicating from')
    .option('-b, --bearerToken <string>', 'Bearer token to use for authorization')
    .option('-p, --pathToConfigFile', 'Path to config containing credentials')
    .option('-r, --resourceName <string>', 'Resource name to replicate data from')
    .option('-x, --expansions <items>', 'Comma-separated list of items to expand during the query process, e.g. Media,OpenHouse')
    .option('-m, --metadataReportPath <string>', 'Path to metadata report to use for replication')
    .option('-o, --outputPath <string>', 'Name of directory for results')
    .option('-l, --limit <number>', 'Limit for total number of records')
    .action(replicate);

  program
    .command('metadata')
    .description('Converts metadata from OData XML to RESO Format.')
    .requiredOption('-p, --pathToXmlMetadata <string>', 'Path to XML Metadata to parse')
    .action(convertAndSaveMetadata);

  program.parse();
}

module.exports = {
  replicate,
  restore,
  runTests,
  findVariations,
  computeVariations,
  convertMetadata
};
