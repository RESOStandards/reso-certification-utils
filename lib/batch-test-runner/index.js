'use strict';

const fs = require('fs');
const fse = require('fs-extra');
const path = require('path');

const { WEB_API_COMMANDER_PATH } = process.env;

const {
  buildRecipientEndorsementPath,
  isValidEndorsement,
  isValidVersion,
  createResoScriptBearerTokenConfig,
  createResoScriptClientCredentialsConfig,
  archiveEndorsement,
  ENDORSEMENTS,
  CURRENT_DATA_DICTIONARY_VERSION
} = require('../../common');

const { execSync } = require('child_process');
const { NOT_OK } = require('../replication/utils');

//TODO: make this more Windows-friendly. Currently, Windows users MUST
//specify the path since the Linux paths might not work depending on their shell.
const COMMANDER_PATH = WEB_API_COMMANDER_PATH || '.',
  COMMANDER_LOG_FILE_NAME = 'commander.log',
  ERROR_LOG_FILE_NAME = 'error.log';

const COMMANDER_CERTIFICATION_RESULTS_PATH = path.join(COMMANDER_PATH, 'build', 'certification');

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
const runTests = ({ pathToConfigFile, runAllTests = false, fromCli = false, ...args } = {}) => {
  if (!pathToConfigFile) throw Error('Missing pathToConfigFile.');

  const { endorsementName, version } = {
    endorsementName: ENDORSEMENTS.DATA_DICTIONARY,
    version: CURRENT_DATA_DICTIONARY_VERSION,
    ...args
  };

  const handleError = message => {
    if (fromCli) {
      console.error(message);
      process.exit(NOT_OK);
    } else {
      throw new Error(message);
    }
  };

  if (!isValidEndorsement(endorsementName)) {
    handleError(`Endorsement key is not valid! endorsementName: ${endorsementName}`);
  }

  if (!isValidVersion(endorsementName, version)) {
    handleError(`Endorsement key is not valid! endorsementName: ${endorsementName}`);
  }

  const providerInfo = {};

  try {
    Object.assign(providerInfo, JSON.parse(fs.readFileSync(pathToConfigFile)));
  } catch (err) {
    handleError(`Could not read provider info! pathToConfigFile: ${pathToConfigFile}`);
  }

  const { providerUoi, configs } = providerInfo;

  if (!(providerUoi && providerUoi?.length)) handleError('providerUoi is required!');
  if (!(configs && configs?.length)) handleError('configs must contain valid configurations');

  configs.forEach(config => {
    const { providerUsi, recipientUoi, originatingSystemId, originatingSystemName } = config;

    const RECIPIENT_PATH = path.join(
      process.cwd(),
      buildRecipientEndorsementPath({
        providerUoi,
        providerUsi,
        recipientUoi,
        endorsementName,
        version
      })
    );

    const pathToConfigFile = path.join(RECIPIENT_PATH, 'config.xml');

    if (!(providerUsi && providerUsi?.length)) handleError(`providerUsi is missing from the given config: ${config}!`);
    if (!(recipientUoi && recipientUoi?.length)) handleError(`recipientUoi is missing from the given config: ${config}!`);

    try {
      //archive existing results if they already exist
      archiveEndorsement({ providerUoi, providerUsi, recipientUoi, endorsementName, version });

      //create recipient path for new results
      fs.mkdirSync(RECIPIENT_PATH, { recursive: true });

      //build test config and write it to the appropriate path
      const testingConfig = buildTestingConfig(config);
      if (!testingConfig && Object.keys(testingConfig)?.length) {
        handleError(`There was a problem creating a RESOScript config for recipientUoi: ${recipientUoi}`);
      }

      fs.writeFileSync(pathToConfigFile, testingConfig);

      // remove any existing results before running job
      if (fs.existsSync(COMMANDER_CERTIFICATION_RESULTS_PATH)) {
        fs.rmSync(COMMANDER_CERTIFICATION_RESULTS_PATH, { recursive: true });
      }

      try {
        //run dd tests
        execSync(
          `sh ${path.join(COMMANDER_PATH, `gradlew testDataDictionary -Dversion=${version} -DpathToRESOScript='${pathToConfigFile}'`)}`,
          { stdio: ['inherit', 'inherit', 'pipe'], cwd: COMMANDER_PATH }
        );

        if (runAllTests) {
          // run variations tests
          if (version === true) {
            //TODO run tests
          }

          const optionalArgs = originatingSystemId
            ? `-DOriginatingSystemID=${originatingSystemId}`
            : originatingSystemName
              ? `-DOriginatingSystemName=${originatingSystemName}`
              : '';

          console.log(optionalArgs);

          try {
            //run data availability tests
            // execSync(
            //   `sh ${path.join(
            //     COMMANDER_PATH,
            //     `gradlew testDataAvailability -Dversion=${version} -DpathToRESOScript='${pathToConfigFile}' ` +
            //       optionalArgs
            //   )}`,
            //   { stdio: ['inherit', 'inherit', 'pipe'], cwd: COMMANDER_PATH }
            // );
          } catch (err) {
            // console.error('Data Dictionary testing failed for recipientUoi: ' + recipientUoi);
            // console.error('Error: ' + err);

            // const commanderLogPath = path.join(COMMANDER_PATH, COMMANDER_LOG_FILE_NAME);
            // const { size } = fs.statSync(commanderLogPath);

            // if (size) {
            //   fs.copyFileSync(
            //     path.resolve(commanderLogPath),
            //     path.resolve(path.join(RECIPIENT_PATH, ERROR_LOG_FILE_NAME))
            //   );
            // }

            process.exitCode = 1;
          }
        }
      } catch (err) {
        if (fromCli) {
          const commanderLogPath = path.join(COMMANDER_PATH, COMMANDER_LOG_FILE_NAME);
          const { size } = fs.statSync(commanderLogPath);

          if (size) {
            fs.copyFileSync(path.resolve(commanderLogPath), path.resolve(path.join(RECIPIENT_PATH, ERROR_LOG_FILE_NAME)));
          }
        }
        handleError('Data Dictionary testing failed for recipientUoi: ' + config.recipientUoi);
      }
    } catch (err) {
      handleError(err);
    } finally {
      try {
        //TODO: replace this with const.js, which has knowledge of the paths in the config for each test type
        const certPaths = ['results', 'reports', 'cucumberJson'];
        certPaths.forEach(certPath => {
          fse.copySync(
            path.join(COMMANDER_CERTIFICATION_RESULTS_PATH, certPath),
            RECIPIENT_PATH,
            { overwrite: true, preserveTimestamps: true },
            err => {
              if (err) {
                console.error(err);
              } else {
                console.log(`Copied ${certPath} to ${RECIPIENT_PATH}`);
              }
            }
          );
        });
      } catch (err) {
        handleError(`Could not copy files to ${RECIPIENT_PATH}!\n${err}`);
      }
    }
  });

  // TODO: handle this in the CLI util
  console.log('Testing complete!');
};

module.exports = {
  runTests
};
