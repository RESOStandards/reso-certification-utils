const fs = require('fs');
const fse = require('fs-extra');
const { sep } = require('path');
const { WEB_API_COMMANDER_PATH } = require('../../config.json');
const {
  getEndorsementConfig,
  isValidEndorsementKey,
  isValidVersion,
  endorsementKeys,
  availableVersions
} = require('../../common');

const EMPTY_STRING = '';

const { execSync } = require('child_process');

/**
 * Creates a filesystem path from the items in paths
 * @param {*} paths a list of string paths to join
 * @param {*} separator the separator to use, assumed to be that from path
 * @returns a path approriate for the local environment
 */
const buildFilePath = (...paths) => paths.join(sep);

//TODO: make this more Windows-friendly. Currently, Windows users MUST
//specify the path since the Linux paths might not work depending on their shell.
const COMMANDER_PATH = WEB_API_COMMANDER_PATH || '.';

const CERTIFICATION_RESULTS_PATH = buildFilePath(COMMANDER_PATH, 'build', 'certification');

/**
 * Returns the condensed version of the ISO 8601 format, e.g. 20211228T211042673Z
 * which is safe for directory naming.
 *
 * @param {Date} timestamp to convert, defaults to now.
 * @returns ISO 8601 timestamp without separators
 * @see https://en.wikipedia.org/wiki/ISO_8601
 */
const getFileSafeIso8601Timestamp = (timestamp = new Date()) =>
  timestamp.toISOString().replaceAll(/-|:|\./gi, EMPTY_STRING);

/**
 * Creates a path to the recipient's results using the following structure:
 *
 * - providerUoi1
 *   - dataDictionary-1.7
 *     - usi1
 *         - recipientUoi1
 *             * timestamp0001
 *             * timestamp0002
 *             * ...
 *             * timestamp000N
 *        + recipientUoi2
 *     + usi2
 *   + webApiCore-2.0.0
 *   + idxPayload-1.7
 * + providerUoi2
 *  ...
 * + providerUoiN
 *
 * @param {String} providerUoi
 * @param {String} recipientUoi
 * @returns Unix path for recipient
 */
const buildRecipientPath = ({
  providerUoi,
  providerUsi,
  recipientUoi,
  endorsementKey,
  endorsementVersion,
  timestamp = getFileSafeIso8601Timestamp()
}) => {
  if (!providerUoi) throw Error('providerUoi is required!');
  if (!providerUsi) throw Error('providerUsi is required!');
  if (!recipientUoi) throw Error('recipientUoi is required!');
  if (!endorsementKey) throw Error('endorsementKey is required!');
  if (!endorsementVersion) throw Error('endorsementVersion is required!');

  if (!isValidEndorsementKey(endorsementKey))
    throw new Error(`Invalid endorsementKey: ${endorsementKey}`);
  if (!isValidVersion(endorsementKey, endorsementVersion))
    throw new Error(`Invalid endorsementVersion: ${endorsementVersion}`);

  const { directoryName } = getEndorsementConfig(endorsementKey, endorsementVersion);

  return buildFilePath(providerUoi, directoryName, providerUsi, recipientUoi, timestamp);
};

const createResoscriptBearerTokenConfig = ({ serviceRootUri, token }) =>
  '<?xml version="1.0" encoding="utf-8" ?>' +
  '<OutputScript>' +
  '  <ClientSettings>' +
  `    <WebAPIURI>${serviceRootUri}</WebAPIURI>` +
  '    <AuthenticationType>authorization_code</AuthenticationType>' +
  `    <BearerToken>${token}</BearerToken>` +
  '  </ClientSettings>' +
  '</OutputScript>';

const createResoscriptClientCredentialsConfig = ({ serviceRootUri, clientCredentials }) =>
  '<?xml version="1.0" encoding="utf-8" ?>' +
  '<OutputScript>' +
  '  <ClientSettings>' +
  `    <WebAPIURI>${serviceRootUri}</WebAPIURI>` +
  '    <AuthenticationType>client_credentials</AuthenticationType>' +
  `    <ClientIdentification>${clientCredentials.clientId}</ClientIdentification>` +
  `    <ClientSecret>${clientCredentials.clientSecret}</ClientSecret>` +
  `    <TokenURI>${clientCredentials.tokenUri}</TokenURI>` +
  `    ${
    clientCredentials.scope
      ? '<ClientScope>' + clientCredentials.scope + '</ClientScope>'
      : EMPTY_STRING
  }` +
  '  </ClientSettings>' +
  '</OutputScript>';

const isClientCredentalsConfig = (config = { clientCredentials: {} }) =>
  config.clientCredentials &&
  config.clientCredentials.clientId &&
  config.clientCredentials.clientSecret &&
  config.clientCredentials.tokenUri;

const isBearerTokenConfig = (config = { token: EMPTY_STRING }) => !!config.token;

const buildTestingConfig = (config = {}) => {
  if (isClientCredentalsConfig(config)) {
    return createResoscriptClientCredentialsConfig(config);
  } else if (isBearerTokenConfig(config)) {
    return createResoscriptBearerTokenConfig(config);
  }
  return null;
};

/**
 * Runs tests for a bulk config file of the user's choosing.
 *
 * Outputs the results of the tests to standard out/error and stops immediately
 * if any errors are found.
 *
 * @param {*} RECIPIENT_CONFIG_PATH the path to the json config file.
 * @see {sample-config.json} for more information
 */
const runTests = async (RECIPIENT_CONFIG_PATH, endorsementKey, endorsementVersion) => {
  if (!RECIPIENT_CONFIG_PATH) throw Error('Missing RECIPIENT_CONFIG_PATH.');

  if (!isValidEndorsementKey(endorsementKey)) {
    console.error(`Endorsement key is not valid! endorsementKey: ${endorsementKey}`);
    return false;
  }

  if (!isValidVersion(endorsementKey, endorsementVersion)) {
    console.error(`Endorsement key is not valid! endorsementKey: ${endorsementKey}`);
    return false;
  }

  const providerInfo = {};
  try {
    Object.assign(providerInfo, JSON.parse(fs.readFileSync(RECIPIENT_CONFIG_PATH)));
  } catch (err) {
    throw new Error(
      `Could not read provider info! RECIPIENT_CONFIG_PATH: ${RECIPIENT_CONFIG_PATH}`
    );
  }

  const { providerUoi, configs } = providerInfo;

  if (!providerUoi) throw new Error('providerUoi is required!');
  if (!configs || !configs.length) throw new Error('configs must contain valid configurations');
  try {
    if (fs.existsSync(providerUoi)) {
      try {
        fs.renameSync(providerUoi, `${providerUoi}-old-${getFileSafeIso8601Timestamp()}`);
      } catch (err) {
        console.error(err);
        throw new Error('Could not rename directory! Exiting!');
      }
    }

    //create root directory
    await fs.promises.mkdir(providerUoi);

    configs.forEach(config => {
      try {
        const { providerUsi, recipientUoi } = config;
        if (!providerUsi)
          throw new Error(`providerUsi is missing from the given config: ${config}!`);
        if (!recipientUoi)
          throw new Error(`recipientUoi is missing from the given config: ${config}!`);

        const RECIPIENT_PATH = buildFilePath(
            process.cwd(),
            buildRecipientPath({
              providerUoi,
              providerUsi,
              recipientUoi,
              endorsementKey,
              endorsementVersion
            })
          ),
          RECIPIENT_CONFIG_PATH = buildFilePath(RECIPIENT_PATH, 'config.xml');

        fs.mkdirSync(RECIPIENT_PATH, { recursive: true });

        //build test config and write it to the appropriate path
        const testingConfig = buildTestingConfig(config);
        if (!testingConfig)
          throw new Error(
            'There was a problem creating a RESOScript config for recipientUoi: ' + recipientUoi
          );
        fs.writeFileSync(RECIPIENT_CONFIG_PATH, testingConfig);

        fs.rm(CERTIFICATION_RESULTS_PATH, { recursive: true });

        try {
        
          //run dd tests
          const dataDictionaryResult = execSync(
            `sh ${buildFilePath(
              COMMANDER_PATH,
              `gradlew testDataDictionary_1_7 -DpathToRESOScript='${RECIPIENT_CONFIG_PATH}'`
            )}`,
            { stdio: ['inherit', 'inherit', 'pipe'], cwd: COMMANDER_PATH }
          );

          if (dataDictionaryResult && dataDictionaryResult.stderr) {
            console.error(
              'Data Dictionary testing failed for recipientUoi: ' + config.recipientUoi
            );
            console.error(Error(dataDictionaryResult.stderr));

            //TODO, create error directory with each corresponding log
            process.exitCode = 1;
          }

          //run data availability tests
          const dataAvailabilityResult = execSync(
            `sh ${buildFilePath(
              COMMANDER_PATH,
              `gradlew testDataAvailability_1_7 -DpathToRESOScript='${RECIPIENT_CONFIG_PATH}'`
            )}`,
            { stdio: ['inherit', 'inherit', 'pipe'], cwd: COMMANDER_PATH }
          );

          if (dataAvailabilityResult && dataAvailabilityResult.stderr) {
            console.error('Data Dictionary testing failed for recipientUoi: ' + recipientUoi);
            console.error(Error(dataAvailabilityResult.stderr));
            process.exitCode = 1;
          }
        } catch (err) {
          console.error(err);
        } finally {
          try {
            //TODO: replace this with const.js, which has knowledge of the paths in the config for each test type
            const paths = ['results', 'reports', 'cucumberJson'];
            paths.forEach(path => {
              fse.copySync(
                buildFilePath(CERTIFICATION_RESULTS_PATH, path),
                RECIPIENT_PATH,
                { overwrite: true },
                err => {
                  if (err) {
                    console.error(err);
                  } else {
                    console.log(`Copied ${path} to ${RECIPIENT_PATH}`);
                  }
                }
              );
            });
          } catch (err) {
            console.error(`Could not copy files to ${RECIPIENT_PATH}!`);
          }
        }
      } catch (err) {
        console.error(err);
      }
    });
  } catch (err) {
    console.error(err);
  }
  
  // TODO: handle this in the CLI util
  console.log('Testing complete!');
};

module.exports = {
  runTests,
  endorsementKeys,
  availableVersions
};
