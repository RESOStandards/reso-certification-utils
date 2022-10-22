'use strict';

const fs = require('fs');
const fse = require('fs-extra');
const path = require('path');

require('dotenv').config();
const { WEB_API_COMMANDER_PATH } = process.env;

const {
  buildRecipientEndorsementPath,
  isValidEndorsement,
  isValidVersion,
  createResoScriptBearerTokenConfig,
  createResoScriptClientCredentialsConfig,
  EMPTY_STRING,
  archiveEndorsement,
  endorsements,
  CURRENT_DATA_DICTIONARY_VERSION
} = require('../../common');

const { execSync } = require('child_process');

//TODO: make this more Windows-friendly. Currently, Windows users MUST
//specify the path since the Linux paths might not work depending on their shell.
const COMMANDER_PATH = WEB_API_COMMANDER_PATH || '.',
  COMMANDER_LOG_FILE_NAME = 'commander.log',
  ERROR_LOG_FILE_NAME = 'error.log';

const COMMANDER_CERTIFICATION_RESULTS_PATH = path.join(COMMANDER_PATH, 'build', 'certification');

const buildTestingConfig = (config = {}) => {
  if (isClientCredentialsConfig(config)) {
    return createResoScriptClientCredentialsConfig(config);
  } else if (isBearerTokenConfig(config)) {
    return createResoScriptBearerTokenConfig(config);
  }
  return null;
};

const isClientCredentialsConfig = (config = { clientCredentials: {} }) =>
  config.clientCredentials &&
  config.clientCredentials.clientId &&
  config.clientCredentials.clientSecret &&
  config.clientCredentials.tokenUri;

const isBearerTokenConfig = (config = { token: EMPTY_STRING }) => !!config.token;

/**
 * Runs tests for a bulk config file of the user's choosing.
 *
 * Outputs the results of the tests to standard out/error and stops immediately
 * if any errors are found.
 *
 * @param {String} RECIPIENT_CONFIG_PATH the path to the json config file.
 * @see {sample-config.json} for more information
 */
const runTests = async (RECIPIENT_CONFIG_PATH, args) => {
  if (!RECIPIENT_CONFIG_PATH) throw Error('Missing RECIPIENT_CONFIG_PATH.');

  const { endorsementName, version, runAvailability } = {
    endorsementName: endorsements.DATA_DICTIONARY,
    version: CURRENT_DATA_DICTIONARY_VERSION,
    runAvailability: true,
    ...args
  };

  if (!isValidEndorsement(endorsementName)) {
    console.error(`Endorsement key is not valid! endorsementName: ${endorsementName}`);
    return false;
  }

  if (!isValidVersion(endorsementName, version)) {
    console.error(`Endorsement key is not valid! endorsementName: ${endorsementName}`);
    return false;
  }

  const providerInfo = {};
  try {
    Object.assign(providerInfo, JSON.parse(fs.readFileSync(RECIPIENT_CONFIG_PATH)));
  } catch (err) {
    throw new Error(`Could not read provider info! RECIPIENT_CONFIG_PATH: ${RECIPIENT_CONFIG_PATH}`);
  }

  const { providerUoi, configs } = providerInfo;

  if (!providerUoi) throw new Error('providerUoi is required!');
  if (!configs || !configs.length) throw new Error('configs must contain valid configurations');

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
      ),
      RECIPIENT_CONFIG_PATH = path.join(RECIPIENT_PATH, 'config.xml');

    if (!providerUsi) throw new Error(`providerUsi is missing from the given config: ${config}!`);
    if (!recipientUoi) throw new Error(`recipientUoi is missing from the given config: ${config}!`);

    try {
      //archive existing results if they already exist
      archiveEndorsement({ providerUoi, providerUsi, recipientUoi, endorsementName, version });

      //create recipient path for new results
      fs.mkdirSync(RECIPIENT_PATH, { recursive: true });

      //build test config and write it to the appropriate path
      const testingConfig = buildTestingConfig(config);
      if (!Object.keys(testingConfig))
        throw new Error(`There was a problem creating a RESOScript config for recipientUoi: ${recipientUoi}`);

      fs.writeFileSync(RECIPIENT_CONFIG_PATH, testingConfig);

      // remove any existing results before running job
      fs.rm(COMMANDER_CERTIFICATION_RESULTS_PATH, { recursive: true });

      try {
        //run dd tests
        execSync(
          `sh ${path.join(
            COMMANDER_PATH,
            `gradlew testDataDictionary_1_7 -DpathToRESOScript='${RECIPIENT_CONFIG_PATH}'`
          )}`,
          { stdio: ['inherit', 'inherit', 'pipe'], cwd: COMMANDER_PATH }
        );

        if (runAvailability) {
          const optionalArgs = originatingSystemId
            ? `-DOriginatingSystemID=${originatingSystemId}`
            : originatingSystemName
              ? `-DOriginatingSystemName=${originatingSystemName}`
              : '';

          try {
            //run data availability tests
            execSync(
              `sh ${path.join(
                COMMANDER_PATH,
                `gradlew testDataAvailability_1_7 -DpathToRESOScript='${RECIPIENT_CONFIG_PATH}' ` +
                  optionalArgs
              )}`,
              { stdio: ['inherit', 'inherit', 'pipe'], cwd: COMMANDER_PATH }
            );
          } catch (err) {
            console.error('Data Dictionary testing failed for recipientUoi: ' + recipientUoi);
            console.error('Error: ' + err);

            const commanderLogPath = path.join(COMMANDER_PATH, COMMANDER_LOG_FILE_NAME);
            const { size } = fs.statSync(commanderLogPath);

            if (size) {
              fs.copyFileSync(
                path.resolve(commanderLogPath),
                path.resolve(path.join(RECIPIENT_PATH, ERROR_LOG_FILE_NAME))
              );
            }

            process.exitCode = 1;
          }
        }
      } catch (err) {
        console.error('Data Dictionary testing failed for recipientUoi: ' + config.recipientUoi);

        const commanderLogPath = path.join(COMMANDER_PATH, COMMANDER_LOG_FILE_NAME);
        const { size } = fs.statSync(commanderLogPath);

        if (size) {
          fs.copyFileSync(
            path.resolve(commanderLogPath),
            path.resolve(path.join(RECIPIENT_PATH, ERROR_LOG_FILE_NAME))
          );
        }

        //TODO, create error directory with each corresponding log
        process.exitCode = 1;
      }
    } catch (err) {
      console.error(err);
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
        console.error(`Could not copy files to ${RECIPIENT_PATH}!`);
        console.error(err);
      }
    }
  });

  // TODO: handle this in the CLI util
  console.log('Testing complete!');
};

module.exports = {
  runTests
};
