#! /usr/bin/env node

const { schema, combineErrors, generateJsonSchema, validate, VALIDATION_ERROR_MESSAGES } = require('./lib/schema');
const { restore } = require('./lib/restore-utils');
const { runDDTests } = require('./lib/batch-test-runner');
const { findVariations, computeVariations } = require('./lib/variations');
const { replicate } = require('./lib/replication');
const { convertMetadata, convertAndSaveMetadata } = require('./lib/metadata');

//Only load commander interpreter if running from the CLI
if (require?.main === module) {
  const { program } = require('commander');

  const getBoolValue = item => {
    if (!item) return false;

    if (typeof item === 'string') {
      if (item.toLowerCase() === 'true') {
        return true;
      } else if (item.toLowerCase() === 'false') {
        return false;
      }
    } else if (typeof item === 'boolean') {
      return item;
    }

    return false;
  };

  program.name('RESO Certification Utils').description('Command line batch-testing and restore utils').version('1.0.0');

  program
    .command('schema')
    .option('-g, --generate', 'Generate a schema for payload validation')
    .option('-v, --validate', 'Validate one or multiple payloads with a schema')
    .option('-m, --metadataPath <string>', 'Path to the metadata report JSON file')
    .option('-o, --outputPath <string>', 'Path tho the directory to store the generated schema. Defaults to "./"')
    .option('-a, --additionalProperties', 'Pass this flag to allow additional properties in the schema. False by default')
    .option('-dv, --ddVersion <string>', 'The DD version of the metadata report')
    .option('-p, --payloadPath <string>', 'Path to the payload file OR directory/zip containing files that need to be validated')
    .option('-r, --resourceName <string>', 'Resource name to validate against. Required if --version is passed when validating.')
    .description('Generate a schema or validate a payload against a schema')
    .action(options => schema({ fromCli: true, ...options }));

  program
    .command('restore')
    .description('Restores local or S3 results to a RESO Certification API instance')
    .option('-p, --pathToResults <string>', 'Path to test results')
    .option('-u, --url <string>', 'URL of Certification API')
    .action(options => restore({ fromCli: true, ...options }));

  program
    .command('runDDTests')
    .description('Runs Data Dictionary tests')
    .requiredOption('-p, --pathToConfigFile <string>', 'Path to config file')
    .option('-a, --runAllTests', 'Flag to run all tests')
    .option('-v, --version <string>', 'Data Dictionary version to use', '1.7')
    .action(options => runDDTests({ fromCli: true, ...options }));

  program
    .command('findVariations')
    .description('Finds possible variations in metadata using a number of methods.')
    .requiredOption('-p, --pathToMetadataReportJson <string>', 'Path to metadata-report.json file')
    .option('-f, --fuzziness <float>', 'Set fuzziness to something besides the default')
    .option('-v, --version <string>', 'Data Dictionary version to compare to, i.e. 1.7 or 2.0')
    .option('-s, --useSuggestions <boolean>', 'Use external suggestions in addition to machine-provided ones', true)
    .action(options => findVariations({ fromCli: true, ...options, useSuggestions: getBoolValue(options?.useSuggestions) }));

  program
    .command('replicate')
    .description('Replicates data from a given resource with expansions.')
    .requiredOption('-s, --strategy <string>', 'One of TopAndSkip, TimestampAsc, TimestampDesc, or NextLink')
    .option('-u, --serviceRootUri <string>', 'OData service root URI (no resource name or query)')
    .option('-b, --bearerToken <string>', 'Bearer token to use for authorization')
    .option('-i, --clientId <string>', 'OAuth2 client_id parameter, use this OR bearerToken')
    .option('-c, --clientSecret <string>', 'OAuth2 client_secret parameter, use this OR bearerToken')
    .option('-k, --tokenUri <string>', 'OAuth2 token_uri parameter, use this OR bearerToken')
    .option('-e, --scope <string>', 'Optional OAuth2 scopes for client credentials')
    .option('-p, --pathToMetadataReportJson <string>', 'Path to metadata report JSON')
    .option('-r, --resourceName <string>', 'Resource name to replicate data from')
    .option('-x, --expansions <items>', 'Comma-separated list of items to expand during the query process, e.g. Media,OpenHouse')
    .option('-f, --filter <string>', 'OData $filter expression')
    .option('-t, --top <number>', 'Optional parameter to use for OData $top')
    .option('-m, --maxPageSize <number>', 'Optional parameter for the odata.maxpagesize header')
    .option('-o, --outputPath <string>', 'Name of directory for results')
    .option('-l, --limit <number>', 'Limit total number of records at client level')
    .option('-v, --version <string>', 'Data Dictionary version to use', '2.0')
    .option('-j, --jsonSchemaValidation <boolean>', 'Sets whether to use JSON schema validation', false)
    .option('-S, --strictMode <boolean>', 'Fail immediately on schema validation errors if strict mode is true', true)
    .action(options => {
      // TODO: if run from the command line, we don't want to generate additional reports
      // until we have the ability to understand the type and expansions from the metadata
      const {
        pathToMetadataReportJson,
        bearerToken,
        clientId,
        clientSecret,
        tokenUri,
        scope,
        strictMode = true,
        jsonSchemaValidation = false,
        ...remainingOptions
      } = options;

      const appOptions = {
        ...remainingOptions,
        pathToMetadataReportJson,
        shouldGenerateReports: !!pathToMetadataReportJson,
        fromCli: true,
        jsonSchemaValidation: getBoolValue(jsonSchemaValidation),
        strictMode: getBoolValue(strictMode)
      };

      if (bearerToken) {
        appOptions.bearerToken = bearerToken;
      } else if (clientId && clientSecret && tokenUri) {
        appOptions.clientCredentials = {
          clientId,
          clientSecret,
          tokenUri,
          scope
        };
      } else {
        throw new Error('One of bearerToken or clientId, clientSecret, and tokenUri MUST be specified!');
      }

      replicate(appOptions);
    });

  program
    .command('metadata')
    .description('Converts metadata from OData XML to RESO Format.')
    .requiredOption('-p, --pathToXmlMetadata <string>', 'Path to XML Metadata to parse')
    .action(options => convertAndSaveMetadata({ fromCli: true, ...options }));

  program.parse();
}

module.exports = {
  replicate,
  restore,
  runDDTests,
  findVariations,
  computeVariations,
  convertMetadata,
  combineErrors,
  generateJsonSchema,
  validate,
  VALIDATION_ERROR_MESSAGES
};
