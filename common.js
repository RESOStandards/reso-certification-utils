/**
 * common.js - Contains programmatically derived constants related to testing.
 */


const CURRENT_DATA_DICTIONARY_VERSION = '1.7',
  PREVIOUS_DATA_DICTIONARY_VERSION = null,
  CURRENT_WEB_API_CORE_VERSION = '2.0.0',
  PREVIOUS_WEB_API_CORE_VERSION = null,
  COMMANDER_LOG_FILE_NAME = 'commander.log',
  METADATA_REPORT_JSON = 'metadata-report.json',
  DATA_AVAILABILITY_REPORT_JSON = 'data-availability-report.json',
  IDX_DIFFERENCE_REPORT_JSON = 'idx-difference-report.json';


/**
 * Each key refers to what the given item is called when saved the filesystem.
 */
const endorsementKeys = {
  DATA_DICTIONARY: 'data-dictionary',
  DATA_DICTIONARY_WITH_IDX: 'data-dictionary-idx',
  WEB_API_CORE: 'web-api-server.core'
};

/**
 * Defines the currently supported versions for each endorsement.
 */
const availableVersions = {
  [`${endorsementKeys.DATA_DICTIONARY}`]: {
    currentVersion: CURRENT_DATA_DICTIONARY_VERSION,
    previousVersion: PREVIOUS_DATA_DICTIONARY_VERSION
  },
  [`${endorsementKeys.DATA_DICTIONARY_WITH_IDX}`]: {
    currentVersion: CURRENT_DATA_DICTIONARY_VERSION,
    previousVersion: PREVIOUS_DATA_DICTIONARY_VERSION
  },
  [`${endorsementKeys.WEB_API_CORE}`]: {
    currentVersion: CURRENT_WEB_API_CORE_VERSION,
    previousVersion: PREVIOUS_WEB_API_CORE_VERSION
  }
};

/**
 * Determines whether the given endorsementKey is valid.
 *
 * @param {String} endorsementKey the key to get the config for. @see {endorsementKeys}
 * @returns true if the endorsementKey is valid, false otherwise.
 * @throws error if parameters aren't valid
 */
const isValidEndorsementKey = endorsementKey =>
  endorsementKey && !!availableVersions[endorsementKey];

/**
 * Determines whether the version is valid for the given endorsement.
 *
 * @param {String} endorsementKey the key to get the config for. @see {endorsementKeys}
 * @param {String} version the version for the given key. @see {availableVersions}
 * @returns true if the version is valid, false otherwise.
 * @throws error if parameters aren't valid
 */
const isValidVersion = (endorsementKey, version) =>
  endorsementKey &&
  version &&
  availableVersions[endorsementKey] &&
  availableVersions[endorsementKey].currentVersion === version;

/**
 * Gets the appropriate config for a given endorsement
 *
 * @param {String} endorsementKey the key to get the config for. @see {endorsementKeys}
 * @param {String} version the version for the given key. @see {availableVersions}
 * @returns a config consisting of constants relevant for the given endorsement.
 */
const getEndorsementConfig = (endorsementKey, version) => {
  if (!isValidEndorsementKey(endorsementKey)) {
    throw new Error(`Invalid endorsement! endorsmentKey: ${endorsementKey}`);
  }

  if (!isValidVersion(endorsementKey, version)) {
    throw new Error(
      `Invalid endorsement version! endorsmentKey: ${endorsementKey}, version: ${version}`
    );
  }

  const ddVersion = version || CURRENT_DATA_DICTIONARY_VERSION,
    webApiVersion = version || CURRENT_WEB_API_CORE_VERSION;

  if (endorsementKey === endorsementKeys.DATA_DICTIONARY) {
    return {
      directoryName: `${endorsementKeys.DATA_DICTIONARY}-${ddVersion}`,
      /* TODO: add versions to JSON results file names in the Commander */
      jsonResultsFiles: [METADATA_REPORT_JSON, DATA_AVAILABILITY_REPORT_JSON],
      htmlReportFiles: [
        `data-dictionary-${ddVersion}.html`,
        `data-availability.dd-${ddVersion}.html`
      ],
      logFileName: COMMANDER_LOG_FILE_NAME
    };
  }

  if (endorsementKey === endorsementKeys.DATA_DICTIONARY_WITH_IDX) {
    return {
      directoryName: `${endorsementKeys.DATA_DICTIONARY_WITH_IDX}-${ddVersion}`,
      /* TODO: add versions to JSON results file names in the Commander */
      jsonResultsFiles: [
        METADATA_REPORT_JSON,
        DATA_AVAILABILITY_REPORT_JSON,
        IDX_DIFFERENCE_REPORT_JSON
      ],
      htmlReportFiles: [
        `data-dictionary-${ddVersion}.html`,
        `data-availability.dd-${ddVersion}.html`,
        `idx-difference-report.dd-${ddVersion}.html`
      ],
      logFileName: COMMANDER_LOG_FILE_NAME
    };
  }

  if (endorsementKey === endorsementKeys.WEB_API_CORE) {
    return {
      directoryName: `${endorsementKeys.WEB_API_CORE}.${webApiVersion}`,
      jsonResultsFiles: [`web-api-server.core.${webApiVersion}.json`],
      htmlReportFiles: [`web-api-server.core.${webApiVersion}.html`],
      logFileName: COMMANDER_LOG_FILE_NAME
    };
  }

  throw new Error(`Invalid endorsementKey: ${endorsementKey ? endorsementKey : '<null>'}!`);
};

module.exports = {
  endorsementKeys,
  availableVersions,
  isValidEndorsementKey,
  isValidVersion,
  getEndorsementConfig
};
