const fs = require('fs');
const path = require('path');
const fse = require('fs-extra');
const unzipper = require('unzipper');
const chalk = require('chalk');

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
  EMPTY_STRING = '',
  ANNOTATION_STANDARD_NAME = 'RESO.OData.Metadata.StandardName',
  ANNOTATION_DD_WIKI_URL = 'RESO.DDWikiUrl';

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
  endorsementName && version && availableVersions[endorsementName] && availableVersions[endorsementName].currentVersion === version;

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
const getFileSafeIso8601Timestamp = (timestamp = new Date()) => timestamp.toISOString().replaceAll(/-|:|\./gi, EMPTY_STRING);

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
  `    ${clientCredentials.scope ? '<ClientScope>' + clientCredentials.scope + '</ClientScope>' : EMPTY_STRING}` +
  '  </ClientSettings>' +
  '</OutputScript>';

/**
 *
 * @param {object} options
 * @param {String} options.zipPath Path to the zip file
 * @param {string} options.outputPath Path to store the extracted files
 * @returns
 */
const extractFilesFromZip = async ({ zipPath, outputPath }) =>
  fs
    .createReadStream(zipPath)
    .pipe(unzipper.Extract({ path: outputPath }))
    .promise();
/**
 *
 * Sleeps for the given amount of milliseconds
 *
 * @param {int} ms Number of milliseconds to sleep
 * @returns Promise that resolves in the given time
 */
const sleep = async (ms = 500) => new Promise(resolve => setTimeout(resolve, ms));

const parseLookupName = lookupName => lookupName?.substring(lookupName.lastIndexOf('.') + 1);

const isStringEnumeration = type => !!type?.includes('Edm.String');

/**
 * Creates a metadata map for lookups from metadata report JSON
 * @param {Object} metadataReportJson to build map with
 * @returns Object containing a metadata map and accompanying stats
 */
const buildMetadataMap = ({ fields = [], lookups = [] } = {}) => {
  const STATS = {
    numResources: 0,
    numFields: 0,
    numLookups: 0,
    numExpansions: 0,
    numComplexTypes: 0
  };

  const lookupMap = lookups.reduce((acc, { lookupName, lookupValue, type, annotations = [] }) => {
    if (!acc[lookupName]) {
      acc[lookupName] = [];
    }

    const { lookupValue: annotatedLookupValue, ddWikiUrl } =
      annotations?.reduce((acc, { term, value }) => {
        if (term === ANNOTATION_STANDARD_NAME) {
          acc.lookupValue = value;
        }

        if (term === ANNOTATION_DD_WIKI_URL) {
          acc.ddWikiUrl = value;
        }
        return acc;
      }, {}) || {};

    if (
      (lookupValue?.startsWith('Sample') && lookupValue?.endsWith('EnumValue')) ||
      (annotatedLookupValue?.startsWith('Sample') && annotatedLookupValue.endsWith('EnumValue'))
    ) {
      return acc;
    }

    if (isStringEnumeration(type)) {
      acc[lookupName].push({ lookupValue, ddWikiUrl, isStringEnumeration: true });
    } else {
      acc[lookupName].push({ lookupValue: annotatedLookupValue, legacyODataValue: lookupValue, ddWikiUrl });
    }

    STATS.numLookups++;
    return acc;
  }, {});

  return {
    metadataMap: {
      ...fields.reduce((acc, { resourceName, fieldName, type, isExpansion = false, isComplexType = false, annotations }) => {
        if (!acc[resourceName]) {
          acc[resourceName] = {};
          STATS.numResources++;
        }

        const isLookupField = !!lookupMap?.[type];

        const { ddWikiUrl } =
          annotations?.reduce((acc, { term, value }) => {
            if (term === ANNOTATION_DD_WIKI_URL) {
              acc.ddWikiUrl = value;
            }
            return acc;
          }, {}) || {};

        //add field to map
        acc[resourceName][fieldName] = {
          type,
          isExpansion,
          isLookupField,
          isComplexType: isComplexType || (!isExpansion && !type?.startsWith('Edm.') && !isLookupField),
          ddWikiUrl
        };

        if (isLookupField && lookupMap?.[type]) {
          if (!acc?.[resourceName]?.[fieldName]?.lookupValues) {
            acc[resourceName][fieldName].lookupValues = {};
          }

          if (!acc?.[resourceName]?.[fieldName]?.legacyODataValues) {
            acc[resourceName][fieldName].legacyODataValues = {};
          }

          Object.values(lookupMap?.[type]).forEach(({ lookupValue, legacyODataValue, ddWikiUrl, isStringEnumeration }) => {
            const lookupName = parseLookupName(type);

            //skip legacyOData matching if we're using string enumerations
            if (!isStringEnumeration && legacyODataValue?.length) {
              acc[resourceName][fieldName].legacyODataValues[legacyODataValue] = {
                type,
                lookupName,
                lookupValue,
                legacyODataValue,
                ddWikiUrl
              };
            }

            if (lookupValue?.length) {
              acc[resourceName][fieldName].lookupValues[lookupValue] = {
                type,
                lookupName,
                lookupValue,
                legacyODataValue,
                ddWikiUrl,
                isStringEnumeration
              };
            }
          });
        }

        if (isExpansion) {
          STATS.numExpansions++;
        }

        if (isComplexType) {
          STATS.numComplexTypes++;
        }

        STATS.numFields++;
        return acc;
      }, {})
    },
    stats: STATS
  };
};

/**
 * Creates loggers
 * @param {Boolean} fromCli true if using the console, false otherwise (default)
 * @returns a pair of loggers, one for normal messages and another for errors
 */
const getLoggers = (fromCli = false) => {
  const noop = () => {};
  if (fromCli) {
    return {
      LOG: message => console.log(message),
      LOG_ERROR: message => console.error(chalk.redBright.bold(message))
    };
  } else {
    return {
      LOG: noop,
      LOG_ERROR: noop
    };
  }
};

module.exports = {
  CURRENT_DATA_DICTIONARY_VERSION,
  CURRENT_WEB_API_CORE_VERSION,
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
  extractFilesFromZip,
  sleep,
  buildMetadataMap,
  getLoggers
};
