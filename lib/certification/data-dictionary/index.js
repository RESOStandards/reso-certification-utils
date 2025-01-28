'use strict';

const fs = require('fs');
const fse = require('fs-extra');
const { resolve, join } = require('path');
const { spawn } = require('node:child_process');
const process = require('process');
const ora = require('ora');
const chalk = require('chalk');
const humanizeDuration = require('humanize-duration');

const { WEB_API_COMMANDER_PATH } = process.env;

const {
  buildRecipientEndorsementPath,
  isValidEndorsement,
  isValidVersion,
  createResoScriptBearerTokenConfig,
  createResoScriptClientCredentialsConfig,
  createReplicationStateServiceInstance,
  archiveEndorsement,
  ENDORSEMENTS,
  CURRENT_DATA_DICTIONARY_VERSION,
  DATA_DICTIONARY_VERSIONS,
  CERTIFICATION_FILES,
  getErrorHandler,
  getLogger
} = require('../../../common');

const { REPLICATION_STRATEGIES } = require('../../replication/utils');
const { findVariations } = require('../../variations');
const { replicate } = require('../../replication');

const { processLookupResourceMetadataFiles } = require('@reso/reso-certification-etl');

const RESULTS_PATH_NAME = 'results',
  CONFIG_FILE_NAME = 'config.xml',
  COMMANDER_LOG_FILE_NAME = 'commander.log',
  ERROR_LOG_FILE_NAME = 'error.log';

const COMMANDER_PATH_UNDEFINED_MESSAGE = 'WEB_API_COMMANDER_PATH not found in .env file! See ./sample.env for examples.';

const JOB_STATUSES = Object.freeze({
  PASSED: 'passed',
  FAILED: 'failed'
});

const DEFAULT_LIMIT = 100000,
  DEFAULT_YEARS_BACK = 3;

/**
 * Gets Commander path name
 * @returns string path to Web API Commander
 */
const getWebApiCommanderPath = () => {
  if (!WEB_API_COMMANDER_PATH) {
    throw new Error(COMMANDER_PATH_UNDEFINED_MESSAGE);
  }
  return WEB_API_COMMANDER_PATH;
};

/**
 * Gets the current Commander results path
 * @returns path to Commander certification results
 */
const getCommanderCertificationResultsPath = () => join(getWebApiCommanderPath(), 'build', 'certification');

/**
 * Creates a testing config with the given params
 * @param {Object} config object containing config items
 * @returns credentials appropriate for the given config
 */
const buildTestingConfig = (config = {}) => {
  if (isClientCredentialsConfig(config)) {
    return createResoScriptClientCredentialsConfig(config);
  } else if (isBearerTokenConfig(config)) {
    return createResoScriptBearerTokenConfig(config);
  }
  return null;
};

/**
 * Executes the Commander with the given properties
 *
 * @throws exception if the child task didn't execute correctly
 * Caller should be prepared to handle it
 *
 * @param {Object} params items needed to run commander locally
 */
const executeCommanderMetadataTest = async ({ pathToWebApiCommander, version, pathToConfigFile, fromCli = false, logger } = {}) => {
  let error;

  try {
    if (!pathToConfigFile) throw new Error('pathToConfigFile missing!');

    //run dd tests
    const commander = spawn(
      join(pathToWebApiCommander, 'gradlew'),
      ['testDataDictionary', `-Dversion=${version}`, `-DpathToRESOScript=${pathToConfigFile}`],
      {
        cwd: pathToWebApiCommander,
        shell: true
      }
    );

    await new Promise((resolve, reject) => {
      let isSkippedTest = false;
      commander.stdout.on('data', x => {
        const message = x.toString();

        if (message) {
          const processed = message.split('\n').flatMap(fragment => {
            if (!(fragment && fragment?.length)) {
              return [];
            }

            if (isSkippedTest) {
              return [];
            } else {
              if (fragment?.startsWith('org.junit.AssumptionViolatedException')) {
                isSkippedTest = true;
                return [];
              } else {
                return [fragment];
              }
            }
          });

          if (processed?.length) {
            if (fromCli) {
              processed.forEach(logger.info);
            } else {
              process.stdout.write(`\n${processed.join('\n')}`);
            }
          }
        }
      });

      commander.stderr.on('data', x => {
        if (!!spinnerInstance) {
          logger.error(x.toString());
        } else {
          process.stderr.write(x.toString());
        }
      });

      commander.on('exit', code => (code === 0 ? resolve(code) : reject(code)));
    });
  } catch (err) {
    // catch execution errors and clean up testing artifacts in finally
    error = err;
  } finally {
    if (pathToConfigFile && fs.existsSync(pathToConfigFile)) {
      fs.rmSync(pathToConfigFile);
    }
  }

  if (error) {
    throw error;
  }
};

/**
 * Determines whether a testing config is for client credentials
 * @param {Object} config object containing credentials
 * @returns true if the config is for client credentials, false otherwise
 */
const isClientCredentialsConfig = ({ clientCredentials = {} }) =>
  clientCredentials && clientCredentials?.clientId && clientCredentials?.clientSecret && clientCredentials?.tokenUri;

/**
 * Determines whether a testing config is for bearer tokens
 * @param {Object} config object containing credentials
 * @returns true if the config is for bearer tokens, false otherwise
 */
const isBearerTokenConfig = ({ token }) => !!token && token?.length;

/**
 * Runs tests for a bulk config file of the user's choosing.
 *
 * Outputs the results of the tests to standard out/error and stops immediately
 * if any errors are found.
 *
 * @param {String} pathToConfigFile the path to the json config file.
 * @see {sample-config.json} for more information
 */
const runDDTests = async ({
  pathToConfigFile = null,
  runAllTests = false,
  fromCli = false,
  version = CURRENT_DATA_DICTIONARY_VERSION,
  strictMode = true,
  limit = DEFAULT_LIMIT
} = {}) => {
  const handleError = getErrorHandler(fromCli);
  const logger = getLogger(fromCli);
  const endorsementName = ENDORSEMENTS.DATA_DICTIONARY;

  const jobResults = {
    description: 'RESO Certification Job Report',
    endorsementName,
    version,
    startTime: new Date().toISOString(),
    outcomes: []
  };

  const JOB_START_TIME = Object.freeze(new Date());

  logger.info(chalk.bold(`\n${JOB_START_TIME.toLocaleString()} - Data Dictionary testing started`));
  logger.info(chalk.bold(`Using strict mode: ${strictMode}!`));

  if (!pathToConfigFile) handleError('Missing pathToConfigFile!');
  if (!WEB_API_COMMANDER_PATH) handleError(COMMANDER_PATH_UNDEFINED_MESSAGE);

  if (!isValidEndorsement(endorsementName)) {
    handleError(`Endorsement name is not valid: '${endorsementName}'`);
  }

  if (!isValidVersion(endorsementName, version)) {
    handleError(`Endorsement version is not valid: '${version}'`);
  }

  const providerInfo = {};

  try {
    Object.assign(providerInfo, JSON.parse(fs.readFileSync(pathToConfigFile)));
  } catch (err) {
    handleError(`Could not read provider info! pathToConfigFile: ${pathToConfigFile}. Error: ${err}`);
  }

  const { providerUoi, configs } = providerInfo;

  if (!(providerUoi && providerUoi?.length)) handleError(`Error: 'providerUoi' is missing from config '${pathToConfigFile}'`);
  if (!(configs && configs?.length)) handleError(`Error: 'configs' array is missing or empty in config '${pathToConfigFile}'`);

  jobResults.providerUoi = providerUoi;

  let configIndex = 0,
    jobStatus,
    jobErrorMessage,
    recipientPath;

  for await (const config of configs) {
    const START_TIME = Object.freeze(new Date());
    const { providerUsi, recipientUoi } = config;

    // passed between test steps to share state
    const sharedTestState = {};

    try {
      cleanUpCertificationFiles();

      if (!(providerUsi && providerUsi?.length))
        throw new Error(`'providerUsi' is missing at index ${configIndex} in config '${pathToConfigFile}'`);
      if (!(recipientUoi && recipientUoi?.length))
        throw new Error(`'recipientUoi' is missing at index ${configIndex} in config '${pathToConfigFile}'`);

      recipientPath = buildRecipientEndorsementPath({
        resultsPath: RESULTS_PATH_NAME,
        providerUoi,
        providerUsi,
        recipientUoi,
        endorsementName,
        version
      });

      const CONFIG_FILE_PATH = join(recipientPath, CONFIG_FILE_NAME);
      sharedTestState.pathToConfigFile = CONFIG_FILE_PATH;

      //archive existing results if they already exist
      archiveEndorsement({ resultsPath: RESULTS_PATH_NAME, providerUoi, providerUsi, recipientUoi, endorsementName, version });

      //create recipient path for new results
      fs.mkdirSync(recipientPath, { recursive: true });
      sharedTestState.recipientPath = recipientPath;

      //build test config and write it to the appropriate path
      const testingConfig = buildTestingConfig(config);
      if (!testingConfig && Object.keys(testingConfig)?.length) {
        throw new Error(`There was a problem creating a RESOScript config for recipientUoi: ${recipientUoi}`);
      }
      fs.writeFileSync(CONFIG_FILE_PATH, testingConfig);

      logger.info(chalk.blueBright.bold(`\nRunning tests for recipient UOI: ${recipientUoi}`));

      await executeTestSteps(
        getDataDictionaryTestSteps({
          config,
          version,
          fromCli,
          strictMode,
          limit,
          runAllTests,
          sharedTestState
        }),
        fromCli
      );

      jobStatus = JOB_STATUSES.PASSED;
    } catch (err) {
      jobStatus = JOB_STATUSES.FAILED;
      const message = `Data Dictionary testing errors${recipientUoi ? ` for recipient UOI: ${config?.recipientUoi}` : ''}`;

      const commanderLogPath = join(getWebApiCommanderPath(), COMMANDER_LOG_FILE_NAME);
      if (fs.existsSync(commanderLogPath)) {
        const { size } = fs.statSync(commanderLogPath);

        if (size && fs.existsSync(recipientPath)) {
          fs.copyFileSync(resolve(commanderLogPath), resolve(join(recipientPath, ERROR_LOG_FILE_NAME)));
        }
      }

      jobErrorMessage = `\n${message}\n${err}`;
      logger.error(jobErrorMessage);
    } finally {
      const outcome = {
        status: jobStatus,
        startTime: START_TIME.toISOString(),
        endTime: new Date().toISOString(),
        recipientPath,
        configIndex,
        providerUsi,
        recipientUoi
      };

      if (jobStatus === 'failed' && jobErrorMessage && jobErrorMessage?.length) {
        outcome.errorMessage = jobErrorMessage;
      }

      jobResults.outcomes.push(outcome);

      configIndex++;
      jobErrorMessage = null;

      if (fs.existsSync(recipientPath)) {
        copyDataDictionaryTestResults(recipientPath);
      }
    }
  }

  const jobReportFilename = 'reso-job-report.json';

  logger.info(chalk.bold(`\nTesting finished at ${new Date().toLocaleString()}`));
  logger.info(chalk.yellowBright(`Runtime: ${humanizeDuration(new Date() - JOB_START_TIME, { round: true })}`));

  try {
    jobResults.endTime = new Date().toISOString();
    const jobReportPath = resolve(join(RESULTS_PATH_NAME, jobReportFilename));
    fs.writeFileSync(jobReportPath, JSON.stringify(jobResults));
    logger.info(chalk.bold(`Job report: ${jobReportPath}`));
  } catch (err) {
    logger.error(`Could not create jobs results file: '${jobReportFilename}'!\n${err}\n`);
  }

  logger.info('\n\n');
};

/**
 * Processes metadata files with the ETL lib, if needed, and returns the correct path
 * @param {String} recipientPath output path for recipient
 * @returns path to the relevant metadata file, either raw or processed
 */
const processDataDictionaryMetadataFiles = async recipientPath => {
  const pathToCommanderMetadataReport = join(
      getCommanderCertificationResultsPath(),
      RESULTS_PATH_NAME,
      CERTIFICATION_FILES.METADATA_REPORT
    ),
    pathToCommanderLookupMetadataReport = join(
      getCommanderCertificationResultsPath(),
      RESULTS_PATH_NAME,
      CERTIFICATION_FILES.LOOKUP_RESOURCE_LOOKUP_METADATA
    );

  if (fs.existsSync(pathToCommanderMetadataReport)) {
    if (fs.existsSync(pathToCommanderLookupMetadataReport)) {
      const pathToOutputFile = resolve(join(recipientPath, CERTIFICATION_FILES.PROCESSED_METADATA_REPORT));

      await processLookupResourceMetadataFiles(pathToCommanderMetadataReport, pathToCommanderLookupMetadataReport, pathToOutputFile);

      return pathToOutputFile;
    } else {
      const pathToOutputFile = resolve(join(recipientPath, CERTIFICATION_FILES.METADATA_REPORT));
      fse.copySync(pathToCommanderMetadataReport, pathToOutputFile, { overwrite: true, preserveTimestamps: true }, err => {
        if (err) {
          throw new Error(err);
        }
      });

      return join(getCommanderCertificationResultsPath(), RESULTS_PATH_NAME, CERTIFICATION_FILES.METADATA_REPORT);
    }
  } else {
    throw new Error(
      `${CERTIFICATION_FILES.METADATA_REPORT} does not exist in ${join(getCommanderCertificationResultsPath(), recipientPath)}!`
    );
  }
};

/**
 * Removes certification files
 */
const cleanUpCertificationFiles = () => {
  // remove any existing results before running job
  if (fs.existsSync(getCommanderCertificationResultsPath())) {
    fs.rmSync(getCommanderCertificationResultsPath(), { recursive: true });
  }

  // remove any existing cert files from the working directory
  Object.values(CERTIFICATION_FILES).forEach(fileName => {
    const sourcePath = join(process.cwd(), fileName);
    if (fs.existsSync(sourcePath)) {
      fs.rmSync(sourcePath, { force: true });
    }
  });
};

/**
 * Copies all Data Dictionary results (passed/failed) to the given recipient path
 * @param {String} recipientPath path to recipient directory
 */
const copyDataDictionaryTestResults = recipientPath => {
  // copy commander files
  ['results', 'reports', 'cucumberJson'].forEach(certPath => {
    const sourcePath = join(getCommanderCertificationResultsPath(), certPath);

    if (fs.existsSync(sourcePath)) {
      fse.copySync(sourcePath, recipientPath, { overwrite: true, preserveTimestamps: true }, err => {
        if (err) {
          throw new Error(err);
        }
      });
    }
  });

  Object.values(CERTIFICATION_FILES).forEach(fileName => {
    const sourcePath = join(process.cwd(), fileName),
      destPath = join(recipientPath, fileName);

    if (fs.existsSync(sourcePath)) {
      fse.copySync(sourcePath, destPath, { overwrite: true, preserveTimestamps: true }, err => {
        if (err) {
          throw new Error(err);
        }
      });

      fs.rmSync(sourcePath);
    }
  });
};

/**
 * Executes the appropriate set of test steps for a given version and config
 * Replication service instance is used across calls
 * @param {Object} params relevant parameters for test execution
 */
const executeTestSteps = async (steps = [], fromCli = false) => {
  const WINDOW_SIZE = 6;
  const spinnerInstance = ora();

  let logger, messageBuffer;

  for await (const { stepName, testFunction = async () => {} } of steps) {
    const STEP_TEXT = chalk.cyanBright.bold(stepName);

    if (fromCli) {
      messageBuffer = [];
      spinnerInstance.start(STEP_TEXT);

      logger = {
        info: text => {
          messageBuffer.push(text);
          if (messageBuffer?.length >= WINDOW_SIZE) {
            messageBuffer = messageBuffer.slice(messageBuffer?.length - WINDOW_SIZE);
          }

          spinnerInstance.text = `${STEP_TEXT} (Memory: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB)\n${chalk.grey(messageBuffer.join('\n'))}`;
        },
        error: text => {
          spinnerInstance.text = `${STEP_TEXT}\n${chalk.bold.red(text)}\n`;
        }
      };
    } else {
      logger = {
        info: console.log,
        error: console.error
      };
    }

    try {
      await testFunction(logger);
      spinnerInstance.succeed(STEP_TEXT);
    } catch (err) {
      spinnerInstance.fail(STEP_TEXT);
      throw err;
    } finally {
      spinnerInstance.stop();
    }
  }
};

/**
 * Gets test steps for the given Data Dictionary version
 * @param {Object} params configuration options such as the config, version, etc.
 * @returns an array of promises for the given params
 */
const getDataDictionaryTestSteps = ({ config, version, fromCli, strictMode = true, limit, runAllTests = true, sharedTestState }) => {
  const { token: bearerToken, ...remainingConfig } = config;

  const testSteps = [];

  const defaultReplicationSettings = {
    bearerToken,
    ...remainingConfig,
    shouldGenerateReports: true,
    version,
    strictMode,
    fromCli,
    limit: parseInt(limit) ?? DEFAULT_LIMIT,
    jsonSchemaValidation: !!strictMode
  };

  testSteps.push({
    stepName: 'Data Dictionary Metadata Tests',
    testFunction: async logger => {
      const { pathToConfigFile, recipientPath } = sharedTestState;

      await executeCommanderMetadataTest({
        pathToWebApiCommander: WEB_API_COMMANDER_PATH,
        version,
        pathToConfigFile,
        fromCli,
        strictMode,
        logger
      });

      sharedTestState.pathToMetadataReportJson = await processDataDictionaryMetadataFiles(recipientPath);
    }
  });

  if (runAllTests) {
    // replication will be tested - create and wire up the replication state service
    sharedTestState.replicationStateService = createReplicationStateServiceInstance();

    if (version === DATA_DICTIONARY_VERSIONS.v1_7) {
      const DEFAULT_PAGE_SIZE = 1000;

      testSteps.push({
        stepName: 'Replication - ModificationTimestamp',
        testFunction: async logger =>
          replicate({
            ...defaultReplicationSettings,
            jsonSchemaValidation: false,
            top: DEFAULT_PAGE_SIZE,
            strategy: REPLICATION_STRATEGIES.TIMESTAMP_DESC,
            pathToMetadataReportJson: sharedTestState.pathToMetadataReportJson,
            replicationStateService: sharedTestState.replicationStateService,
            logger
          })
      });
    } else if (version === DATA_DICTIONARY_VERSIONS.v2_0) {
      const DEFAULT_PAGE_SIZE = 1000;

      testSteps.push(
        {
          stepName: 'Variations Check',
          testFunction: async logger => {
            const { variations } = await findVariations({
              pathToMetadataReportJson: sharedTestState.pathToMetadataReportJson,
              fromCli,
              strictMode,
              logger
            });
            if (strictMode && Object.values(variations ?? []).some(variation => variation?.length)) {
              throw new Error('Found variations during testing!');
            }
          }
        },
        {
          stepName: 'Replication - ModificationTimestamp desc',
          testFunction: async logger =>
            replicate({
              ...defaultReplicationSettings,
              top: DEFAULT_PAGE_SIZE,
              strategy: REPLICATION_STRATEGIES.TIMESTAMP_DESC,
              pathToMetadataReportJson: sharedTestState.pathToMetadataReportJson,
              replicationStateService: sharedTestState.replicationStateService,
              logger
            })
        },
        {
          stepName: 'Replication - NextLink',
          testFunction: async logger =>
            replicate({
              ...defaultReplicationSettings,
              maxPageSize: DEFAULT_PAGE_SIZE,
              strategy: REPLICATION_STRATEGIES.NEXT_LINK,
              pathToMetadataReportJson: sharedTestState.pathToMetadataReportJson,
              replicationStateService: sharedTestState.replicationStateService,
              logger
            })
        },
        {
          stepName: 'Replication - NextLink (3 years back, ascending)',
          testFunction: async logger =>
            replicate({
              ...defaultReplicationSettings,
              maxPageSize: DEFAULT_PAGE_SIZE,
              strategy: REPLICATION_STRATEGIES.NEXT_LINK,
              filter: `ModificationTimestamp ge ${new Date(new Date().getFullYear() - DEFAULT_YEARS_BACK, null).toISOString()}`,
              orderby: 'ModificationTimestamp asc',
              pathToMetadataReportJson: sharedTestState.pathToMetadataReportJson,
              replicationStateService: sharedTestState.replicationStateService,
              logger
            })
        }
      );
    } else {
      throw new Error(`Unsupported Data Dictionary version: '${version}'`);
    }
  }

  return testSteps;
};

module.exports = {
  runDDTests,
  DEFAULT_LIMIT
};
