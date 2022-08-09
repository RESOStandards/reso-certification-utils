//const conf = new (require('conf'))();
const chalk = require('chalk');
const { promises: fs } = require('fs');
const { join } = require('path');
const { getOrgsMap, getOrgSystemsMap } = require('../../data-access/cert-api-client');

const CERTIFICATION_RESULTS_DIRECTORY = 'current',
  FILE_ENCODING = 'utf8',
  PATH_DATA_SEPARATOR = '-';

const CERTIFICATION_FILES = {
  METADATA_REPORT: 'metadata-report.json',
  DATA_AVAILABILITY_REPORT: 'data-availability-report.json',
  LOOKUP_RESOURCE_FIELD_METADATA: 'lookup-resource-field-metadata.json',
  LOOKUP_RESOURCE_LOOKUP_METADATA: 'lookup-resource-lookup-metadata.json'
};

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
    skippedProviders: [],
    skippedRecipients: [],
    missingResults: []
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
        console.warn(
          chalk.yellowBright.bold(`WARNING: Could not find providerUoi '${providerUoi}'! Skipping...`)
        );
        STATS.skippedProviders.push(providerUoi);
        break;
      }

      //is provider USI valid?
      const systems = orgSystemMap[providerUoi] || [];
      if (!systems?.length) {
        console.warn(
          chalk.yellowBright.bold(
            `WARNING: Could not find systems for providerUoi '${providerUoi}'! Skipping...`
          )
        );
        STATS.skippedProviders.push(providerUoi);
      } else {
        if (!systems.find(system => system === providerUsi)) {
          console.log(
            `ERROR: Could not find system ${providerUsi} for providerUoi '${providerUoi}'! Skipping...`
          );
          STATS.skippedProviders.push(providerUoi);
          break;
        }

        //read subdirectories
        const pathToRecipientResults = join(pathToResults, providerUoiAndUsiPath);

        const recipientUoiPaths = await readDirectory(pathToRecipientResults);

        if (!recipientUoiPaths?.length) {
          console.log(
            chalk.yellowBright.bold(
              `WARNING: Could not find recipient paths for ${providerUoiAndUsiPath}! Skipping...`
            )
          );
          break;
        }

        for await (const recipientUoi of recipientUoiPaths) {
          if (!orgMap[recipientUoi]) {
            console.log(
              chalk.yellowBright.bold(`WARNING: '${recipientUoi}' is not a valid UOI! Skipping...`)
            );
            STATS.skippedRecipients.push(recipientUoi);
          } else {
            const currentResultsPath = join(
              pathToResults,
              providerUoiAndUsiPath,
              recipientUoi,
              CERTIFICATION_RESULTS_DIRECTORY
            );

            console.log(
              chalk.cyanBright.bold(
                `Processing results for providerUoi: '${providerUoi}', providerUsi: '${providerUsi}', recipientUoi: '${recipientUoi}'...`
              )
            );

            console.log(`Path: ${currentResultsPath}`);
            const results = await readDirectory(currentResultsPath);

            if (!results?.length) {
              console.error(chalk.yellowBright.bold('WARNING: no results found to restore! Skipping...\n'));
              STATS.skippedRecipients.push(recipientUoi);
              STATS.missingResults.push(currentResultsPath);
            } else {
              console.log('Found results!');
              results.forEach(result => console.log(`\t${result}`));
              STATS.processed.push(currentResultsPath);
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

  console.log(chalk.magentaBright.bold('------------------------------------------------------------'));
  console.log(chalk.bold(`Processing complete!\nProcessed: ${STATS.processed.length}\nTime Taken: ~${timeTaken}s`));
  console.log(chalk.magentaBright.bold('------------------------------------------------------------'));
  
  console.log(chalk.bold(`Providers Skipped: ${STATS.skippedProviders.length}`));
  STATS.skippedProviders.forEach(provider => console.log(chalk.bold(`\t * ${provider}`)));

  console.log(chalk.bold(`\nRecipients Skipped: ${STATS.skippedRecipients.length}`));
  STATS.skippedRecipients.forEach(recipient => console.log(chalk.bold(`\t * ${recipient}`)));

  console.log(chalk.bold(`\nMissing Results: ${STATS.missingResults.length}`));
  STATS.missingResults.forEach(resultsPath => console.log(chalk.bold(`\t * ${resultsPath}`)));

  console.log();
};

module.exports = {
  restore
};
