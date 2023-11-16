'use strict';

const fs = require('fs');
const fse = require('fs-extra');
const { resolve, join } = require('path');
const { execSync } = require('child_process');

const { WEB_API_COMMANDER_PATH } = process.env;

const REPLICATION_RECORD_LIMIT = 1000;

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
  CERTIFICATION_FILES
} = require('../../common');

const { NOT_OK, REPLICATION_STRATEGIES } = require('../replication/utils');
const { findVariations } = require('../variations');
const { replicate } = require('../replication');

const { processLookupResourceMetadataFiles } = require('@reso/reso-certification-etl');

//TODO: make this more Windows-friendly. Currently, Windows users MUST
//specify the path since the Linux paths might not work depending on their shell.
const COMMANDER_PATH = WEB_API_COMMANDER_PATH || '.',
  COMMANDER_LOG_FILE_NAME = 'commander.log',
  ERROR_LOG_FILE_NAME = 'error.log';

const COMMANDER_CERTIFICATION_RESULTS_PATH = join(COMMANDER_PATH, 'build', 'certification'),
  RESULTS_PATH_NAME = 'results',
  CONFIG_FILE_NAME = 'config.xml';

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
const execSyncCommanderTestDataDictionaryTask = ({ COMMANDER_PATH, version, pathToConfigFile } = {}) => {
  //run dd tests
  execSync(`sh ${join(COMMANDER_PATH, `gradlew testDataDictionary -Dversion=${version} -DpathToRESOScript='${pathToConfigFile}'`)}`, {
    stdio: ['inherit', 'inherit', 'pipe'],
    cwd: COMMANDER_PATH
  });
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
 * Creates context-sensitive error handler function that logs to
 * the console or throws errors depending on whether the caller is using the CLI
 *
 * @param {Boolean} fromCli true if coming from the CLI, false otherwise (default)
 * @returns Error handler function
 */
const getErrorHandler = (fromCli = false) => {
  return message => {
    if (fromCli) {
      console.error(message);
      process.exit(NOT_OK);
    } else {
      throw new Error(message);
    }
  };
};

/**
 * Runs tests for a bulk config file of the user's choosing.
 *
 * Outputs the results of the tests to standard out/error and stops immediately
 * if any errors are found.
 *
 * @param {String} pathToConfigFile the path to the json config file.
 * @see {sample-config.json} for more information
 */
const runDDTests = async ({ pathToConfigFile, runAllTests = false, fromCli = false, ...args } = {}) => {
  if (!pathToConfigFile) throw Error('Missing pathToConfigFile.');

  const { endorsementName, version } = {
    endorsementName: ENDORSEMENTS.DATA_DICTIONARY,
    version: CURRENT_DATA_DICTIONARY_VERSION,
    ...args
  };

  const handleError = getErrorHandler(fromCli);

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
    handleError(`Could not read provider info! pathToConfigFile: ${pathToConfigFile}`);
  }

  const { providerUoi, configs } = providerInfo;

  if (!(providerUoi && providerUoi?.length)) handleError('providerUoi is required!');
  if (!(configs && configs?.length)) handleError('configs must contain valid configurations');

  configs.forEach(async config => {
    const { providerUsi, recipientUoi } = config;

    const RECIPIENT_PATH = join(
      process.cwd(),
      buildRecipientEndorsementPath({
        providerUoi,
        providerUsi,
        recipientUoi,
        endorsementName,
        version
      })
    );

    const pathToConfigFile = join(RECIPIENT_PATH, CONFIG_FILE_NAME);

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
        // if the task fails, it will throw an error
        execSyncCommanderTestDataDictionaryTask({ COMMANDER_PATH, version, pathToConfigFile });

        if (runAllTests) {
          let pathToMetadataReportJson;
          try {
            pathToMetadataReportJson = await processDataDictionaryMetadataFiles(RECIPIENT_PATH);
          } catch (err) {
            handleError(err);
          }

          const replicationStateServiceInstance = createReplicationStateServiceInstance();

          try {
            Promise.all(getDataDictionaryTestSteps({ config, version, pathToMetadataReportJson, replicationStateServiceInstance }));
          } catch (err) {
            handleError(err);
          }
        }
      } catch (err) {
        if (fromCli) {
          const commanderLogPath = join(COMMANDER_PATH, COMMANDER_LOG_FILE_NAME);
          const { size } = fs.statSync(commanderLogPath);

          if (size) {
            fs.copyFileSync(resolve(commanderLogPath), resolve(join(RECIPIENT_PATH, ERROR_LOG_FILE_NAME)));
          }
        }
        handleError('Data Dictionary testing failed for recipientUoi: ' + config?.recipientUoi);
      } finally {
        // remove any existing results before running job
        if (fs.existsSync(pathToConfigFile)) {
          fs.rmSync(pathToConfigFile);
        }
      }
    } catch (err) {
      handleError(err);
    } finally {
      copyDataDictionaryTestResults(RECIPIENT_PATH);
    }
  });

  // TODO: handle this in the CLI util
  console.log('Testing complete!');
};

const processDataDictionaryMetadataFiles = async recipientPath => {
  const pathToCommanderMetadataReport = join(COMMANDER_CERTIFICATION_RESULTS_PATH, RESULTS_PATH_NAME, CERTIFICATION_FILES.METADATA_REPORT),
    pathToCommanderLookupMetadataReport = join(
      COMMANDER_CERTIFICATION_RESULTS_PATH,
      RESULTS_PATH_NAME,
      CERTIFICATION_FILES.LOOKUP_RESOURCE_LOOKUP_METADATA
    );

  if (fs.existsSync(pathToCommanderMetadataReport)) {
    if (fs.existsSync(pathToCommanderLookupMetadataReport)) {
      const pathToOutputFile = resolve(join(recipientPath, CERTIFICATION_FILES.PROCESSED_METADATA_REPORT));

      await processLookupResourceMetadataFiles(pathToCommanderLookupMetadataReport, pathToCommanderLookupMetadataReport, pathToOutputFile);

      return pathToOutputFile;
    } else {
      fse.copySync(pathToCommanderMetadataReport, recipientPath, { overwrite: true, preserveTimestamps: true }, err => {
        if (err) {
          throw new Error(err);
        }
      });

      return join(COMMANDER_CERTIFICATION_RESULTS_PATH, RESULTS_PATH_NAME, CERTIFICATION_FILES.METADATA_REPORT);
    }
  } else {
    throw new Error(
      `${CERTIFICATION_FILES.METADATA_REPORT} does not exist in ${join(COMMANDER_CERTIFICATION_RESULTS_PATH, recipientPath)}!`
    );
  }
};

const copyDataDictionaryTestResults = recipientPath => {
  //TODO: replace this with const.js, which has knowledge of the paths in the config for each test type
  const certPaths = ['results', 'reports', 'cucumberJson'];
  certPaths.forEach(certPath => {
    fse.copySync(
      join(COMMANDER_CERTIFICATION_RESULTS_PATH, certPath),
      recipientPath,
      { overwrite: true, preserveTimestamps: true },
      err => {
        if (err) {
          throw new Error(err);
        }
      }
    );
  });
};

/*

  {
    "providerUoi": "REQUIRED: <providerUoi>",
    "configs": [
      {
        "description": "Sample Bearer Token Config",
        "serviceRootUri": "REQUIRED: OData Service Root",
        "recipientUoi": "REQUIRED: Recipient UOI",
        "providerUsi": "REQUIRED: USI of System",
        "token": "REQUIRED: auth token",
        "originatingSystemName": "OPTIONAL",
        "originatingSystemId": "OPTIONAL"
      },
      {
        "description": "Sample Client Credentials Config",
        "serviceRootUri": "REQUIRED: OData Service Root",
        "recipientUoi": "REQUIRED: Recipient UOI",
        "providerUsi": "REQUIRED: USI of System",
        "clientCredentials": {
          "clientId": "REQUIRED: clientId",
          "clientSecret": "REQUIRED: clientSecret",
          "tokenUri": "REQUIRED: tokenUri",
          "scope": "OPTIONAL"
        },
        "originatingSystemName": "OPTIONAL",
        "originatingSystemId": "OPTIONAL"
      }
    ]
  }


    serviceRootUri,
    strategy,
    bearerToken,
    clientCredentials = {},
    outputPath,
    limit,
    resourceName,
    expansions: expansionArrayOrCommaSeparatedString,
    metadataReportJson = {},
    pathToMetadataReportJson = '',
    filter,
    top,
    orderby,
    rateLimitedWaitTimeMinutes = DEFAULT_RATE_LIMITED_WAIT_MINUTES,
    secondsDelayBetweenRequests = DEFAULT_SECONDS_DELAY_BETWEEN_REQUEST,
    shouldGenerateReports = true,
    jsonSchemaValidation = false,
    fromCli = false,
    version = DEFAULT_DD_VERSION,
    strictMode = false,
    REPLICATION_STATE_SERVICE = REPLICATION_STATE_SERVICE.init()
        
*/
const getDataDictionaryTestSteps = ({ config, version, pathToMetadataReportJson, replicationStateServiceInstance }) => {
  const testSteps = [];

  const defaultReplicationSettings = {
    ...config,
    limit: REPLICATION_RECORD_LIMIT,
    shouldGenerateReports: true,
    version,
    strictMode: true,
    pathToMetadataReportJson,
    REPLICATION_STATE_SERVICE: replicationStateServiceInstance
  };

  if (version === DATA_DICTIONARY_VERSIONS.v1_7) {
    testSteps.push(
      replicate({
        ...defaultReplicationSettings,
        top: 100,
        strategy: REPLICATION_STRATEGIES.TIMESTAMP_DESC
      })
    );
  } else if (version === DATA_DICTIONARY_VERSIONS.v2_0) {
    testSteps.push(
      findVariations({ pathToMetadataReportJson }),
      replicate({ ...defaultReplicationSettings, top: 100, strategy: REPLICATION_STRATEGIES.TIMESTAMP_DESC }),
      replicate({ ...defaultReplicationSettings, top: 100 /* TODO: change to page size */, strategy: REPLICATION_STRATEGIES.NEXT_LINK })
    );
  } else {
    throw new Error(`Unsupported Data Dictionary version: '${version}'`);
  }
  return testSteps;
};

module.exports = {
  runDDTests
};
