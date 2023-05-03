const fs = require('fs');
const path = require('path');
const fse = require('fs-extra');
const chalk = require('chalk');

const { getOrgSystemsMap } = require('./data-access/cert-api-client');

/**
 * common.js - Contains programmatically derived constants related to Certification.
 */

const CURRENT_DATA_DICTIONARY_VERSION = '1.7',
  PREVIOUS_DATA_DICTIONARY_VERSION = null,
  CURRENT_WEB_API_CORE_VERSION = '2.0.0',
  PREVIOUS_WEB_API_CORE_VERSION = null,
  COMMANDER_LOG_FILE_NAME = 'commander.log',
  METADATA_REPORT_JSON = 'metadata-report.json',
  DATA_AVAILABILITY_REPORT_JSON = 'data-availability-report.json',
  IDX_DIFFERENCE_REPORT_JSON = 'idx-difference-report.json',
  EMPTY_STRING = '';

/**
 * Each key refers to what the given item is called when saved the filesystem.
 */
const endorsements = {
  DATA_DICTIONARY: 'data-dictionary',
  DATA_DICTIONARY_WITH_IDX: 'data-dictionary-idx',
  WEB_API_CORE: 'web-api-server.core'
};

/**
 * Defines the currently supported versions for each endorsement.
 */
const availableVersions = {
  [`${endorsements.DATA_DICTIONARY}`]: {
    currentVersion: CURRENT_DATA_DICTIONARY_VERSION,
    previousVersion: PREVIOUS_DATA_DICTIONARY_VERSION
  },
  [`${endorsements.DATA_DICTIONARY_WITH_IDX}`]: {
    currentVersion: CURRENT_DATA_DICTIONARY_VERSION,
    previousVersion: PREVIOUS_DATA_DICTIONARY_VERSION
  },
  [`${endorsements.WEB_API_CORE}`]: {
    currentVersion: CURRENT_WEB_API_CORE_VERSION,
    previousVersion: PREVIOUS_WEB_API_CORE_VERSION
  }
};

const getCurrentVersion = endorsementName =>
  endorsementName && availableVersions[endorsementName] && availableVersions[endorsementName].currentVersion;

const getPreviousVersion = endorsementName =>
  endorsementName && availableVersions[endorsementName] && availableVersions[endorsementName].previousVersion;

/**
 * Determines whether the given endorsementName is valid.
 *
 * @param {String} endorsementName the key to get the config for. @see {endorsements}
 * @returns true if the endorsementName is valid, false otherwise.
 * @throws error if parameters aren't valid
 */
const isValidEndorsement = endorsementName => endorsementName && !!availableVersions[endorsementName];

/**
 * Determines whether the version is valid for the given endorsement.
 *
 * @param {String} endorsementName the key to get the config for. @see {endorsements}
 * @param {String} version the version for the given key. @see {availableVersions}
 * @returns true if the version is valid, false otherwise.
 * @throws error if parameters aren't valid
 */
const isValidVersion = (endorsementName, version) =>
  endorsementName &&
  version &&
  availableVersions[endorsementName] &&
  availableVersions[endorsementName].currentVersion === version;

/**
 * Gets the appropriate config for a given endorsement
 *
 * @param {String} endorsementName the key to get the config for. @see {endorsements}
 * @param {String} version the version for the given key. @see {availableVersions}
 * @returns a config consisting of constants relevant for the given endorsement.
 */
const getEndorsementMetadata = (endorsementName, version) => {
  if (!isValidEndorsement(endorsementName)) {
    throw new Error(`Invalid endorsement! endorsementKey: ${endorsementName}`);
  }

  if (!isValidVersion(endorsementName, version)) {
    throw new Error(`Invalid endorsement version! endorsementKey: ${endorsementName}, version: ${version}`);
  }

  const ddVersion = version || CURRENT_DATA_DICTIONARY_VERSION,
    webApiVersion = version || CURRENT_WEB_API_CORE_VERSION;

  if (endorsementName === endorsements.DATA_DICTIONARY) {
    return {
      directoryName: `${endorsements.DATA_DICTIONARY}`,
      version: `${ddVersion}`,
      /* TODO: add versions to JSON results file names in the Commander */
      jsonResultsFiles: [METADATA_REPORT_JSON, DATA_AVAILABILITY_REPORT_JSON],
      htmlReportFiles: [`data-dictionary-${ddVersion}.html`, `data-availability.dd-${ddVersion}.html`],
      logFileName: COMMANDER_LOG_FILE_NAME
    };
  }

  if (endorsementName === endorsements.DATA_DICTIONARY_WITH_IDX) {
    return {
      directoryName: `${endorsements.DATA_DICTIONARY_WITH_IDX}`,
      version: `${version}`,
      /* TODO: add versions to JSON results file names in the Commander */
      jsonResultsFiles: [METADATA_REPORT_JSON, DATA_AVAILABILITY_REPORT_JSON, IDX_DIFFERENCE_REPORT_JSON],
      htmlReportFiles: [
        `data-dictionary-${ddVersion}.html`,
        `data-availability.dd-${ddVersion}.html`,
        `idx-difference-report.dd-${ddVersion}.html`
      ],
      logFileName: COMMANDER_LOG_FILE_NAME
    };
  }

  if (endorsementName === endorsements.WEB_API_CORE) {
    return {
      directoryName: `${endorsements.WEB_API_CORE}.${webApiVersion}`,
      jsonResultsFiles: [`${endorsements.WEB_API_CORE}.${webApiVersion}.json`],
      htmlReportFiles: [`${endorsements.WEB_API_CORE}.${webApiVersion}.html`],
      logFileName: COMMANDER_LOG_FILE_NAME
    };
  }

  throw new Error(`Invalid endorsementName: ${endorsementName ? endorsementName : '<null>'}!`);
};

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
 * - providerUoi1-usi1
 *  - recipientUoi1
 *    - current
 *      * <metadata report>
 *      * <data availability report>
 *    - archived
 *      - timestamp1
 *        * <metadata report>
 *        * <data availability report>
 *      + timestamp2
 *      + ...
 *      + timestampN
 *  + recipientUoi2
 *
 * @param {String} providerUoi the provider UOI
 * @param {String} providerUsi the provider USI
 * @param {String} recipientUoi the recipient UOI
 * @param {String} endorsementName the name of the given endorsement. @see {endorsements}
 * @param {String} version the version for the given endorsement
 * @returns Unix path for recipient
 */
const buildRecipientEndorsementPath = ({
  providerUoi,
  providerUsi,
  recipientUoi,
  endorsementName,
  version,
  currentOrArchived = 'current'
} = {}) => {
  if (!providerUoi) throw Error('providerUoi is required!');
  if (!providerUsi) throw Error('providerUsi is required!');
  if (!recipientUoi) throw Error('recipientUoi is required!');
  if (!endorsementName) throw Error('endorsementName is required!');
  if (!version) throw Error('version is required!');

  if (!isValidEndorsement(endorsementName)) throw new Error(`Invalid endorsementName: ${endorsementName}`);
  if (!isValidVersion(endorsementName, version)) throw new Error(`Invalid version: ${version}`);

  return path.join(`${providerUoi}-${providerUsi}`, recipientUoi, currentOrArchived);
};

/**
 * Copies results from the current endorsement path for the given item to its archive directory,
 * which has the format recipientPath/archived/archived-at-timestamp
 *
 * @param {String} endorsementName
 * @param {String} version
 * @param {String} providerUoi
 * @param {String} providerUsi
 * @param {String} recipientUoi
 */
const archiveEndorsement = ({ providerUoi, providerUsi, recipientUoi, endorsementName, version } = {}) => {
  const currentRecipientPath = buildRecipientEndorsementPath({
    providerUoi,
    providerUsi,
    recipientUoi,
    endorsementName,
    version
  });

  if (fs.existsSync(currentRecipientPath)) {
    try {
      fse.moveSync(
        currentRecipientPath,
        path.join(
          buildRecipientEndorsementPath({
            providerUoi,
            providerUsi,
            recipientUoi,
            endorsementName,
            version,
            currentOrArchived: 'archived'
          }),
          getFileSafeIso8601Timestamp()
        )
      );
    } catch (err) {
      console.error(err);
      throw new Error('Could not move directory! Exiting!');
    }
  }
};

const createResoScriptBearerTokenConfig = ({ serviceRootUri, token }) =>
  '<?xml version="1.0" encoding="utf-8" ?>' +
  '<OutputScript>' +
  '  <ClientSettings>' +
  `    <WebAPIURI>${serviceRootUri}</WebAPIURI>` +
  '    <AuthenticationType>authorization_code</AuthenticationType>' +
  `    <BearerToken>${token}</BearerToken>` +
  '  </ClientSettings>' +
  '</OutputScript>';

const createResoScriptClientCredentialsConfig = ({ serviceRootUri, clientCredentials }) =>
  '<?xml version="1.0" encoding="utf-8" ?>' +
  '<OutputScript>' +
  '  <ClientSettings>' +
  `    <WebAPIURI>${serviceRootUri}</WebAPIURI>` +
  '    <AuthenticationType>client_credentials</AuthenticationType>' +
  `    <ClientIdentification>${clientCredentials.clientId}</ClientIdentification>` +
  `    <ClientSecret>${clientCredentials.clientSecret}</ClientSecret>` +
  `    <TokenURI>${clientCredentials.tokenUri}</TokenURI>` +
  `    ${
    clientCredentials.scope ? '<ClientScope>' + clientCredentials.scope + '</ClientScope>' : EMPTY_STRING
  }` +
  '  </ClientSettings>' +
  '</OutputScript>';

const isValidUrl = url => {
  try {
    new URL(url);
    return true;
  } catch (err) {
    console.log(chalk.redBright.bold(`Error: Cannot parse given url: ${url}`));
    return false;
  }
};

const checkFileExists = async filePath => {
  try {
    await fs.promises.access(filePath);
    return true;
  } catch (err) {
    return false;
  }
};

const fetchSystemsData = async () => {
  //fetch system data
  console.log(chalk.cyanBright.bold('\nFetching system data...'));
  const orgSystemMap = (await getOrgSystemsMap()) || {};
  if (!Object.keys(orgSystemMap)?.length) throw new Error('Error: could not fetch systems!');
  console.log(chalk.cyanBright.bold('Done!'));
  return orgSystemMap;
};

const createCachedFunction = asyncFunc => {
  const cache = new Map();

  return async (...args) => {
    const key = JSON.stringify(args);
    if (cache.has(key)) {
      return cache.get(key);
    }

    const result = await asyncFunc(...args);
    cache.set(key, result);
    return result;
  };
};

const fetchSystemData = createCachedFunction(fetchSystemsData);

module.exports = {
  endorsements,
  availableVersions,
  isValidEndorsement,
  isValidVersion,
  getEndorsementMetadata,
  createResoScriptBearerTokenConfig,
  createResoScriptClientCredentialsConfig,
  getFileSafeIso8601Timestamp,
  buildRecipientEndorsementPath,
  archiveEndorsement,
  getCurrentVersion,
  getPreviousVersion,
  CURRENT_DATA_DICTIONARY_VERSION,
  CURRENT_WEB_API_CORE_VERSION,
  isValidUrl,
  checkFileExists,
  fetchSystemData
};
