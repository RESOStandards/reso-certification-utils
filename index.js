#! /usr/bin/env node

const { program } = require("commander");
const { schema } = require("./lib/schema");
const { restore } = require("./lib/restore-utils");
const { runTests } = require("./lib/batch-test-runner");
const {
  findVariations,
  computeVariations,
} = require("./lib/find-variations/index.js");

if (require?.main === module) {
  const { program } = require("commander");

  program
    .name("reso-certification-utils")
    .description("Command line batch-testing and restore utils")
    .version("0.0.3");

  program
    .command("runDDTests")
    .requiredOption("-p, --pathToConfigFile <string>", "Path to config file")
    .option(
      "-a, --runAvailability",
      "Flag to run data availability tests, otherwise only metadata tests are run"
    )
    .description("Runs Data Dictionary tests")
    .action(runTests);

  program
    .command("schema")
    .option("-g, --generate", "Generate JSON schema from a metadata report")
    .option("-v, --validate", "Validate a payload against a generated schema")
    .option(
      "-m, --metadataPath <string>",
      "Path to the metadata report JSON file"
    )
    .option(
      "-o, --outputPath <string>",
      "Path tho the directory to store the generated schema"
    )
    .option(
      "-p, --payloadPath <string>",
      "Path to the payload that needs to be validated"
    )
    .option("-s, --schemaPath <string>", "Path to the generated JSON schema")
    .option(
      "-e, --errorPath <string>",
      'Path to save error reports in case of failed validation. Defaults to "./errors"'
    )
    .option(
      "-a, --additionalProperties",
      "Pass this flag to allow additional properties in the schema"
    )
    .option(
      "-z, --zipFilePath <string>",
      "Path to a zip file containing JSON payloads"
    )
    .description("Generate a schema or validate a payload against a schema")
    .action(schema);

  program
    .command("restore")
    .option("-p, --pathToResults <string>", "Path to test results")
    .option("-u, --url <string>", "URL of Certification API")
    .option("-c, --console <boolean>", "Show output to console", true)
    .description(
      "Restores local or S3 results to a RESO Certification API instance"
    )
    .action(restore);

  program
    .command("runDDTests")
    .requiredOption("-p, --pathToConfigFile <string>", "Path to config file")
    .option(
      "-a, --runAvailability",
      "Flag to run data availability tests, otherwise only metadata tests are run"
    )
    .option("-c, --console <boolean>", "Show output to console", true)
    .description("Runs Data Dictionary tests")
    .action(runTests);

  program
    .command("findVariations")
    .requiredOption(
      "-p, --pathToMetadataReportJson <string>",
      "Path to metadata-report.json file"
    )
    .option(
      "-f, --fuzziness <float>",
      "Set fuzziness to something besides the default"
    )
    .option(
      "-v, --version <string>",
      "Data Dictionary version to compare to, i.e. 1.7 or 2.0"
    )
    .option("-c, --console <boolean>", "Show output to console", true)
    .description(
      "Finds possible variations in metadata using a number of methods."
    )
    .action(findVariations);

  program.parse();
}

module.exports = {
  restore,
  runTests,
  findVariations,
  computeVariations,
};
