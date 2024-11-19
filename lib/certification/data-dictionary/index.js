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
  getLoggers
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
const executeCommanderMetadataTest = async ({ pathToWebApiCommander, version, pathToConfigFile, fromCli = false } = {}) => {
  const WINDOW_SIZE = 5;
  const STEP_TEXT = chalk.cyanBright.bold('Running Data Dictionary metadata tests...');

  let error, spinnerInstance, messageBuffer;

  try {
    //run dd tests
    const commander = spawn(
      join(pathToWebApiCommander, 'gradlew'),
      ['testDataDictionary', `-Dversion=${version}`, `-DpathToRESOScript=${pathToConfigFile}`],
      {
        cwd: pathToWebApiCommander,
        shell: true
      }
    );

    if (fromCli) {
      spinnerInstance = ora();
      spinnerInstance.start(STEP_TEXT);
      messageBuffer = [];
    }

    // throw new Error('ohai');

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
            if (fromCli && spinnerInstance) {
              processed.forEach(item => {
                messageBuffer.push(item);
                if (messageBuffer?.length > WINDOW_SIZE) {
                  messageBuffer = messageBuffer.slice(messageBuffer?.length - WINDOW_SIZE);
                }

                spinnerInstance.text = `${STEP_TEXT} \n${chalk.grey(messageBuffer.join('\n'))}`;
                spinnerInstance.render();
              });
            } else {
              process.stdout.write(`\n${processed.join('\n')}`);
            }
          }
        }
      });

      commander.stderr.on('data', x => {
        if (spinnerInstance) {
          spinnerInstance.error(x.toString());
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
    if (fromCli) {
      spinnerInstance.fail('Data Dictionary metadata testing failed!');
    }
    throw error;
  } else {
    if (fromCli) {
      spinnerInstance.succeed('Data Dictionary metadata testing passed!');
    }
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
  const { LOG_INFO, LOG_ERROR } = getLoggers(fromCli);

  const JOB_START_TIME = Object.freeze(new Date());

  LOG_INFO(chalk.bold(`\nTesting started at ${JOB_START_TIME.toLocaleString()}`));
  LOG_INFO(chalk.bold(`Using strict mode: ${strictMode}!`));

  if (!pathToConfigFile) handleError('Missing pathToConfigFile!');
  if (!WEB_API_COMMANDER_PATH) handleError(COMMANDER_PATH_UNDEFINED_MESSAGE);

  const endorsementName = ENDORSEMENTS.DATA_DICTIONARY;

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

  let configIndex = 0;

  for await (const config of configs) {
    let recipientPath;
    const { providerUsi, recipientUoi } = config;

    try {
      cleanUpCertificationFiles();

      if (!(providerUsi && providerUsi?.length)) throw new Error(`'providerUsi' is missing at index ${configIndex} in config '${pathToConfigFile}'`);
      if (!(recipientUoi && recipientUoi?.length)) throw new Error(`'recipientUoi' is missing at index ${configIndex} in config '${pathToConfigFile}'`);

      recipientPath = buildRecipientEndorsementPath({
        resultsPath: RESULTS_PATH_NAME,
        providerUoi,
        providerUsi,
        recipientUoi,
        endorsementName,
        version
      });

      const CONFIG_FILE_PATH = join(recipientPath, CONFIG_FILE_NAME);

      //archive existing results if they already exist
      archiveEndorsement({ resultsPath: RESULTS_PATH_NAME, providerUoi, providerUsi, recipientUoi, endorsementName, version });

      //create recipient path for new results
      fs.mkdirSync(recipientPath, { recursive: true });

      //build test config and write it to the appropriate path
      const testingConfig = buildTestingConfig(config);
      if (!testingConfig && Object.keys(testingConfig)?.length) {
        throw new Error(`There was a problem creating a RESOScript config for recipientUoi: ${recipientUoi}`);
      }
      fs.writeFileSync(CONFIG_FILE_PATH, testingConfig);

      LOG_INFO(`\nRunning tests for recipientUoi: ${recipientUoi}`);

      // if the task fails, it will throw an error
      await executeCommanderMetadataTest({
        pathToWebApiCommander: WEB_API_COMMANDER_PATH,
        version,
        pathToConfigFile: CONFIG_FILE_PATH,
        fromCli,
        strictMode
      });

      const pathToMetadataReportJson = await processDataDictionaryMetadataFiles(recipientPath);

      if (runAllTests) {
        const replicationStateServiceInstance = createReplicationStateServiceInstance();

        await executeDataDictionaryTestSteps({
          config,
          version,
          pathToMetadataReportJson,
          replicationStateServiceInstance,
          fromCli,
          strictMode,
          limit
        });
      }
    } catch (err) {
      const commanderLogPath = join(getWebApiCommanderPath(), COMMANDER_LOG_FILE_NAME);
      if (fs.existsSync(commanderLogPath)) {
        const { size } = fs.statSync(commanderLogPath);

        if (size && fs.existsSync(recipientPath)) {
          fs.copyFileSync(resolve(commanderLogPath), resolve(join(recipientPath, ERROR_LOG_FILE_NAME)));
        }
      }

      const message = `Data Dictionary testing errors${recipientUoi ? ` for recipientUoi: ${config?.recipientUoi}` : ''}...`;
      LOG_ERROR(`\n${message}\n${err}`);
    } finally {
      configIndex++;

      if (fs.existsSync(recipientPath)) {
        copyDataDictionaryTestResults(recipientPath);
      }
    }
  }

  LOG_INFO(chalk.bold(`\nTesting finished at ${new Date().toLocaleString()}`));
  LOG_INFO(`Runtime: ${humanizeDuration(new Date() - JOB_START_TIME)}\n\n`);
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
const executeDataDictionaryTestSteps = async ({
  config,
  version,
  pathToMetadataReportJson,
  replicationStateServiceInstance,
  fromCli,
  strictMode = true,
  limit
}) => {
  for await (const { stepName, testFunction = async () => {} } of getDataDictionaryTestSteps({
    config,
    version,
    pathToMetadataReportJson,
    replicationStateServiceInstance,
    fromCli,
    strictMode,
    limit
  }) ?? []) {
    console.log(`\n[${new Date().toISOString()}] - Test starting: '${stepName}'`);
    await testFunction();
    console.log(`\n[${new Date().toISOString()}] - Test finished: '${stepName}'`);
  }
};

/**
 * Gets test steps for the given Data Dictionary version
 * @param {Object} params configuration options such as the config, version, etc.
 * @returns an array of promises for the given params
 */
const getDataDictionaryTestSteps = ({
  config,
  version,
  pathToMetadataReportJson,
  replicationStateServiceInstance,
  fromCli,
  strictMode = true,
  limit
}) => {
  const { token: bearerToken, ...remainingConfig } = config;

  const defaultReplicationSettings = {
    bearerToken,
    ...remainingConfig,
    shouldGenerateReports: true,
    version,
    strictMode,
    pathToMetadataReportJson,
    REPLICATION_STATE_SERVICE: replicationStateServiceInstance,
    fromCli,
    limit: parseInt(limit) ?? DEFAULT_LIMIT,
    jsonSchemaValidation: !!strictMode
  };

  if (version === DATA_DICTIONARY_VERSIONS.v1_7) {
    const DEFAULT_PAGE_SIZE = 1000;

    return [
      {
        stepName: 'Replication - ModificationTimestamp',
        testFunction: async () =>
          replicate({
            ...defaultReplicationSettings,
            jsonSchemaValidation: false,
            top: DEFAULT_PAGE_SIZE,
            strategy: REPLICATION_STRATEGIES.TIMESTAMP_DESC
          })
      }
    ];
  } else if (version === DATA_DICTIONARY_VERSIONS.v2_0) {
    const DEFAULT_PAGE_SIZE = 1000;

    return [
      {
        stepName: 'Variations Check',
        testFunction: async () => {
          const { variations } = await findVariations({ pathToMetadataReportJson, fromCli, strictMode });
          if (strictMode && Object.values(variations ?? []).some(variation => variation?.length)) {
            throw new Error('Found variations during testing!');
          }
        }
      },
      {
        stepName: 'Replication - ModificationTimestamp desc',
        testFunction: async () =>
          replicate({
            ...defaultReplicationSettings,
            top: DEFAULT_PAGE_SIZE,
            strategy: REPLICATION_STRATEGIES.TIMESTAMP_DESC
          })
      },
      {
        stepName: 'Replication - NextLink',
        testFunction: async () =>
          replicate({
            ...defaultReplicationSettings,
            maxPageSize: DEFAULT_PAGE_SIZE,
            strategy: REPLICATION_STRATEGIES.NEXT_LINK
          })
      },
      {
        stepName: 'Replication - NextLink (3 years back, ascending)',
        testFunction: async () =>
          replicate({
            ...defaultReplicationSettings,
            maxPageSize: DEFAULT_PAGE_SIZE,
            strategy: REPLICATION_STRATEGIES.NEXT_LINK,
            filter: `ModificationTimestamp ge ${new Date(new Date().getFullYear() - DEFAULT_YEARS_BACK, null).toISOString()}`,
            orderby: 'ModificationTimestamp asc'
          })
      }
    ];
  } else {
    throw new Error(`Unsupported Data Dictionary version: '${version}'`);
  }
};

module.exports = {
  runDDTests,
  DEFAULT_LIMIT
};
