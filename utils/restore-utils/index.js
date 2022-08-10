//const conf = new (require('conf'))();
const chalk = require('chalk');
const { promises: fs } = require('fs');
const { join } = require('path');
const { getOrgsMap, getOrgSystemsMap, findDataDictionaryReport } = require('../../data-access/cert-api-client');

const CERTIFICATION_RESULTS_DIRECTORY = 'current',
  // FILE_ENCODING = 'utf8',
  PATH_DATA_SEPARATOR = '-';

const CERTIFICATION_FILES = {
  METADATA_REPORT: 'metadata-report.json',
  DATA_AVAILABILITY_REPORT: 'data-availability-report.json',
  LOOKUP_RESOURCE_FIELD_METADATA: 'lookup-resource-field-metadata.json',
  LOOKUP_RESOURCE_LOOKUP_METADATA: 'lookup-resource-lookup-metadata.json'
};

const areRequiredFilesPresent = (fileNames = []) =>
  fileNames.filter(fileName =>
    [CERTIFICATION_FILES.METADATA_REPORT, CERTIFICATION_FILES.DATA_AVAILABILITY_REPORT].find(
      f => fileName === f
    )
  ).length === 2;

const readDirectory = async (path = '') => {
  try {
    return await fs.readdir(path);
  } catch (err) {
    return [];
  }
};

/**
 * Determines whether the given path is an S3 path
 * @param {String} path the path to test
 * @returns true if S3 path, false otherwise
 */
const isS3Path = (path = '') => path.trim().toLowerCase().startsWith('s3://');

/**
 * Determines whether the given path is a valid local file path
 * @param {String} path the path to test
 * @returns true if valid local path, false otherwise
 */
const isLocalPath = (path = '') => !isS3Path(path);

const fetchOrgData = async () => {
  //fetch org data
  console.log(chalk.cyanBright.bold('\nFetching org data...'));
  const orgMap = (await getOrgsMap()) || {};
  if (!Object.keys(orgMap)?.length) throw new Error('ERROR: could not fetch orgs!');
  console.log(chalk.cyanBright.bold('Done!'));
  return orgMap;
};

const fetchSystemData = async () => {
  //fetch system data
  console.log(chalk.cyanBright.bold('\nFetching system data...'));
  const orgSystemMap = (await getOrgSystemsMap()) || {};
  if (!Object.keys(orgSystemMap)?.length) throw new Error('ERROR: could not fetch systems!');
  console.log(chalk.cyanBright.bold('Done!'));
  return orgSystemMap;
};

const isValidUrl = url => {
  try {
    new URL(url);
    return true;
  } catch (err) {
    console.error(chalk.redBright.bold(`ERROR: Cannot parse given url: ${url}`));
    return false;
  }
};

/**
 * Restores a RESO Certification Server from either a local or S3 path.
 * @param {String} path
 * @throws error if path is not a valid S3 or local path
 */
const restore = async (options = {}) => {
  const START_TIME = new Date();

  const STATS = {
    processed: [],
    skippedProviderUoiPaths: [],
    skippedUsiPaths: [],
    skippedRecipientPaths: [],
    missingResultsPaths: [],
    missingResultsFilePaths: []
  };

  const { pathToResults, url } = options;

  if (isS3Path(pathToResults)) {
    console.log(
      chalk.yellowBright.bold(`S3 path provided but not supported at this time!\nPath: ${pathToResults}`)
    );
    return;
  }

  if (!isValidUrl(url)) return;

  console.log(chalk.bold(`\nCertification API URL: ${url}`));
  console.log(chalk.bold(`Path to results: ${pathToResults}`));

  if (isLocalPath(pathToResults)) {
    const orgMap = await fetchOrgData();
    const orgSystemMap = await fetchSystemData();

    console.log(chalk.greenBright.bold('\nRestore process starting...\n'));

    const providerUoiAndUsiPaths = await readDirectory(pathToResults);

    if (!providerUoiAndUsiPaths?.length) {
      console.error(
        chalk.redBright.bold(`ERROR: Could not find provider UOI and USI paths in '${pathToResults}'`)
      );
      return;
    }

    for await (const providerUoiAndUsiPath of providerUoiAndUsiPaths) {
      const [providerUoi, providerUsi] = providerUoiAndUsiPath.split(PATH_DATA_SEPARATOR);

      //is provider UOI valid?
      if (!orgMap[providerUoi]) {
        console.warn(chalk.redBright.bold(`ERROR: Could not find providerUoi '${providerUoi}'! Skipping...`));
        STATS.skippedProviderUoiPaths.push(providerUoi);
        break;
      }

      //is provider USI valid?
      const systems = orgSystemMap[providerUoi] || [];
      if (!systems?.length) {
        console.warn(
          chalk.redBright.bold(`ERROR: Could not find systems for providerUoi '${providerUoi}'! Skipping...`)
        );
        STATS.skippedProviderUoiPaths.push(providerUoi);
      } else {
        if (!systems.find(system => system === providerUsi)) {
          console.log(
            `ERROR: Could not find system ${providerUsi} for providerUoi '${providerUoi}'! Skipping...`
          );
          STATS.skippedUsiPaths.push(providerUsi);
          break;
        }

        //read subdirectories
        const pathToRecipientResults = join(pathToResults, providerUoiAndUsiPath);
        const recipientUoiPaths = await readDirectory(pathToRecipientResults);

        if (!recipientUoiPaths?.length) {
          console.log(
            chalk.redBright.bold(
              `ERROR: Could not find recipient paths for ${providerUoiAndUsiPath}! Skipping...`
            )
          );
          break;
        }

        for await (const recipientUoi of recipientUoiPaths) {
          console.log(
            chalk.cyanBright.bold(
              `\nProcessing results for providerUoi: '${providerUoi}', providerUsi: '${providerUsi}', recipientUoi: '${recipientUoi}'...`
            )
          );

          if (!orgMap[recipientUoi]) {
            console.log(chalk.redBright.bold(`ERROR: '${recipientUoi}' is not a valid UOI! Skipping...`));
            STATS.skippedRecipientPaths.push(join(pathToResults, providerUoiAndUsiPath, recipientUoi));
          } else {
            const currentResultsPath = join(
              pathToResults,
              providerUoiAndUsiPath,
              recipientUoi,
              CERTIFICATION_RESULTS_DIRECTORY
            );
            console.log(chalk.bold(`Path: ${currentResultsPath}`));
            const results = await readDirectory(currentResultsPath);

            if (!results?.length) {
              console.error(chalk.redBright.bold('ERROR: No results found to restore! Skipping...\n'));
              STATS.missingResultsPaths.push(currentResultsPath);
            } else {
              if (areRequiredFilesPresent(results)) {
                STATS.processed.push(currentResultsPath);
                console.log(chalk.green.bold('Found results!'));

                //search for existing results
                const { id: reportId = null } = await findDataDictionaryReport({ serverUrl: url, providerUoi, providerUsi, recipientUoi }) || {};

                if (reportId) {
                  console.log(chalk.bold('Found report! Report ID: ' + JSON.stringify(reportId)));
                } else {
                  console.log('No report found!');
                }
                
              } else {
                console.log(
                  chalk.redBright.bold(`ERROR: Could not find required files in ${currentResultsPath}`)
                );
                STATS.missingResultsFilePaths.push(currentResultsPath);
              }
            }
          }
        }
      }
    }
    console.log();
  } else {
    console.error(chalk.red.bold(`Invalid path: ${pathToResults}! \nMust be valid S3 or local path`));
  }

  const timeTaken = Math.round((new Date() - START_TIME) / 1000);
  const totalItems = Object.values(STATS).reduce((acc, stats) => (acc += stats.length), 0);

  console.log(chalk.magentaBright.bold('------------------------------------------------------------'));
  console.log(
    chalk.bold(`Processing complete!\nItems Processed: ${STATS.processed.length} of ${totalItems}`)
  );
  console.log(chalk.bold(`Time Taken: ~${timeTaken}s`));
  console.log(chalk.magentaBright.bold('------------------------------------------------------------'));

  console.log(chalk.bold(`Provider UOI Paths Skipped: ${STATS.skippedProviderUoiPaths.length}`));
  STATS.skippedProviderUoiPaths.forEach(providerPath => console.log(chalk.bold(`\t * ${providerPath}`)));

  console.log(chalk.bold(`Provider USI Paths Skipped: ${STATS.skippedUsiPaths.length}`));
  STATS.skippedUsiPaths.forEach(usiPath => console.log(chalk.bold(`\t * ${usiPath}`)));

  console.log(chalk.bold(`\nRecipient UOI Paths Skipped: ${STATS.skippedRecipientPaths.length}`));
  STATS.skippedRecipientPaths.forEach(recipientPath => console.log(chalk.bold(`\t * ${recipientPath}`)));

  console.log(chalk.bold(`\nMissing Results: ${STATS.missingResultsPaths.length}`));
  STATS.missingResultsPaths.forEach(resultsPath => console.log(chalk.bold(`\t * ${resultsPath}`)));

  console.log(chalk.bold(`\nMissing Results Files: ${STATS.missingResultsFilePaths.length}`));
  STATS.missingResultsFilePaths.forEach(resultsFilePath =>
    console.log(chalk.bold(`\t * ${resultsFilePath}`))
  );

  console.log();
};

module.exports = {
  restore
};
