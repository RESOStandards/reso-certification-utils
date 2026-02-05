'use strict';

const { getReferenceMetadata } = require('@reso/reso-certification-etl');
const { generateJsonSchema, validate, combineErrors, generateReports } = require('../../schema');
const fs = require('fs/promises');
const { DEFAULT_DD_VERSION, parseResoUrn } = require('../../../common');
const { getFormattedResourceName, writeFile, processFiles } = require('../../schema/utils');
const { join, resolve } = require('path');
const { generateDDReport } = require('../../schema/create-report');
const { findVariations } = require('../../variations');
const { existsSync } = require('fs');
const chalk = require('chalk');

const RCF_RESULT_TYPE = {
  SCHEMA_VALIDATION_ERRORS: 'schema_validation_errors',
  NO_DATA_AVAILABILITY_REPORT: 'no_data_availability_report',
  NO_METADATA_REPORT: 'no_metadata_report',
  VARIATIONS_ERROR: 'variations_error',
  TEST_SUCCESS: 'test_success',
  TEST_FAILURE_UNKNOWN: 'test_failure_unknown'
};

const runRcfTests = async ({
  pathToRcfResults = null,
  additionalProperties = false,
  version = DEFAULT_DD_VERSION,
  metadataReportJson = null,
  outputPath = '.',
  fromCli = false,
  strictMode = true
} = {}) => {
  const isS3Path = path => (path && path?.startsWith('s3://')) ?? false;

  // 1. If pathToResults is S3, load from there. Otherwise load from local path
  if (!!pathToRcfResults && isS3Path(pathToRcfResults)) {
    // TODO S3
    throw new Error('S3 not supported yet! Local files only.');
  }

  const fileContentsMap = {};
  await processFiles({ inputPath: pathToRcfResults, fileContentsMap });
  const payloads = Object.values(fileContentsMap ?? {});
  if (payloads.length === 0) {
    console.log(chalk.redBright('No RCF files found to process. Exiting.'));
    return;
  }

  const rcfResultsPath = resolve(join(outputPath, 'results', `rcf-${version}`, 'local'));
  if (!existsSync(rcfResultsPath)) {
    await fs.mkdir(rcfResultsPath, { recursive: true });
  }

  try {
    //TODO: before starting the tests, check for existing files in the results directory and move them to archive

    // generate
    const schema = await generateJsonSchema({
      additionalProperties,
      metadataReportJson: metadataReportJson ?? getReferenceMetadata(version)
    });

    // 1 - validate
    let errorMap = {};
    for (const [, payload] of Object.entries(fileContentsMap)) {
      const { resource } = parseResoUrn(payload['@reso.context'] || '');
      const resourceName = getFormattedResourceName(resource, version);

      errorMap = validate({
        version,
        jsonPayload: payload,
        errorMap,
        jsonSchema: schema,
        resourceName: resourceName,
        disableKeys: true,
        chunk: true
      });
    }
    const errorReport = combineErrors(errorMap);
    if (errorReport?.totalErrors > 0) {
      const errorPath = resolve(join(rcfResultsPath, 'data-availability-schema-validation-errors.json'));
      await writeFile(errorPath, JSON.stringify(errorReport, null, 2));
      console.log(chalk.redBright(`Schema Validation failed. The error report has been saved at ${errorPath}`));
      return RCF_RESULT_TYPE.SCHEMA_VALIDATION_ERRORS;
    }

    console.log(chalk.cyanBright('\n- Schema Validation passed successfully!\n'));

    // 2 - generate data availability report
    const { daReport, ...rest } = await generateReports(payloads, true);

    if (Object.keys(daReport ?? {}).length === 0) {
      console.log(chalk.redBright('No Data Availability report generated. Exiting.'));
      return RCF_RESULT_TYPE.NO_DATA_AVAILABILITY_REPORT;
    }
    const daReportPath = resolve(join(rcfResultsPath, 'data-availability-report.json'));
    await writeFile(daReportPath, JSON.stringify(daReport, null, 2));
    console.log(chalk.cyan(`- Data Availability report has been saved at ${daReportPath}\n`));

    // 3 - generate data dictionary report
    const ddReport = generateDDReport({ daReport, ...rest });
    if (Object.keys(ddReport ?? {}).length === 0) {
      console.log(chalk.redBright('No Data Dictionary report generated. Exiting.'));
      return RCF_RESULT_TYPE.NO_METADATA_REPORT;
    }
    const ddReportPath = resolve(join(rcfResultsPath, 'metadata-report.json'));
    await writeFile(ddReportPath, JSON.stringify(ddReport, null, 2));
    console.log(chalk.cyan(`- Data Dictionary report has been saved at ${ddReportPath}\n`));

    // 4 - run variations check
    const { variations } = await findVariations({
      pathToMetadataReportJson: ddReportPath,
      fromCli,
      strictMode: false,
      outputPath: rcfResultsPath
    });
    if (strictMode && Object.values(variations).some(variation => variation?.length)) {
      console.log(
        chalk.redBright(
          `Variations found! Please check the variations report for details: ${resolve(
            join(rcfResultsPath, 'data-dictionary-variations.json')
          )}`
        )
      );
      return RCF_RESULT_TYPE.VARIATIONS_ERROR;
    }
    console.log('Testing completed successfully!!');
    return RCF_RESULT_TYPE.TEST_SUCCESS;
  } catch (err) {
    console.error(err);
    return RCF_RESULT_TYPE.TEST_FAILURE_UNKNOWN;
  }

  // 2. Process RCF files with schema validation

  // 3. Generate data availability report

  // 4. Generate metadata report

  // 5. Run variations check - if it fails, post to Cert API with failed status and variations report

  // 6. If variations check passes, save metadata and availability reports to S3, then push to Cert API

  // 7. For any path that is from S3, delete the raw data from S3 after the request is finished,
  // whether it completed successfully or not
};

module.exports = {
  runRcfTests,
  RCF_RESULT_TYPE
};
