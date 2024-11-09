'use strict';

const chalk = require('chalk');
const { promises: fs } = require('fs');
const { resolve, join } = require('path');
const { getOrgsMap, getOrgSystemsMap, processDataDictionaryResults } = require('../misc/data-access/cert-api-client');
const { isValidUrl, CERTIFICATION_FILES } = require('../../common');

const { processLookupResourceMetadataFiles } = require('@reso/reso-certification-etl');

const CERTIFICATION_RESULTS_DIRECTORY = 'current',
  PATH_DATA_SEPARATOR = '-';

const areRequiredFilesPresent = (fileNames = []) =>
  fileNames.filter(fileName =>
    [CERTIFICATION_FILES.METADATA_REPORT, CERTIFICATION_FILES.DATA_AVAILABILITY_REPORT].find(f => fileName === f)
  ).length === 2;

const readDirectory = async (path = '') => {
  try {
    return await fs.readdir(path);
  } catch {
    return [];
  }
};

const readFile = async filePath => {
  try {
    return await fs.readFile(filePath);
  } catch (err) {
    console.error(`Could not read file from path '${filePath}'! Error: ${err}`);
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

/**
 * Logs items in a bullet list
 * @param {Array} items collection of items to log
 */
const logCollectionAsBulletList = (items = []) => {
  if (Array.isArray(items)) {
    items.forEach(item => {
      if (item && item?.length) console.log(chalk.bold(`\t * ${item}`));
    });
  }
};

/**
 * Filters invalid paths from a list of paths.
 * @param {Array} paths items to test
 * @returns filtered array of paths
 */
const filterIgnoredPaths = (paths = []) => (Array.isArray(paths) && paths?.filter(path => !(path && path?.startsWith('.')))) ?? [];

/**
 * Restores a RESO Certification Server from either a local or S3 path.
 * @param {Object} options arguments to pass to the restore function
 * @throws Error if path is not a valid S3 or local path
 */
const restore = async ({ pathToResults, url } = {}) => {
  const START_TIME = new Date();

  const STATS = {
    processed: [],
    skippedProviderUoiPaths: [],
    skippedUsiPaths: [],
    skippedRecipientPaths: [],
    missingResultsPaths: [],
    missingResultsFilePaths: []
  };

  if (!isValidUrl(url)) {
    console.error(chalk.bold.redBright(`Provided URL is not valid! URL: ${url}`));
    return;
  }

  console.log(chalk.bold(`\nCertification API URL: ${url}`));
  console.log(chalk.bold(`Path to results: ${pathToResults}`));

  try {
    let orgMap = {},
      orgSystemMap = {};

    try {
      // fetch org data
      console.log(chalk.cyanBright.bold(`\nFetching org data...`));
      orgMap = Object.freeze(await getOrgsMap());
      console.log(chalk.cyanBright.bold('Done!'));
    } catch (err) {
      throw new Error(`Error fetching org data...Exiting!\nError: ${err}\n`);
    }

    try {
      // fetch system data
      console.log(chalk.cyanBright.bold('\nFetching system data...'));
      orgSystemMap = Object.freeze(await getOrgSystemsMap());
      console.log(chalk.cyanBright.bold('Done!'));
    } catch (err) {
      throw new Error(`Error fetching system data...Exiting!\nError: ${err}\n`);
    }

    console.log(chalk.greenBright.bold('\nRestore process starting...\n'));

    if (isS3Path(pathToResults)) {
      throw new Error('S3 path was passed but S3 is not currently supported! Exiting.');
    } else if (isLocalPath(pathToResults)) {
      const providerUoiAndUsiPaths = filterIgnoredPaths(await readDirectory(pathToResults));

      if (!providerUoiAndUsiPaths?.length) {
        throw new Error(`Could not find provider UOI and USI paths in '${pathToResults}'`);
      }

      for await (const providerUoiAndUsiPath of providerUoiAndUsiPaths) {
        const [providerUoi, providerUsi] = providerUoiAndUsiPath.split(PATH_DATA_SEPARATOR);

        //is provider UOI valid?
        if (!orgMap[providerUoi]) {
          console.warn(chalk.redBright.bold(`Error: Could not find providerUoi '${providerUoi}'! Skipping...`));
          STATS.skippedProviderUoiPaths.push(providerUoi);
        } else {
          //is provider USI valid?
          const systems = orgSystemMap[providerUoi] || [];
          if (!systems?.length) {
            console.warn(chalk.redBright.bold(`Error: Could not find systems for providerUoi '${providerUoi}'! Skipping...`));
            STATS.skippedProviderUoiPaths.push(providerUoi);
          } else {
            if (!systems.find(system => system === providerUsi)) {
              console.warn(`Error: Could not find system ${providerUsi} for providerUoi '${providerUoi}'! Skipping...`);
              STATS.skippedUsiPaths.push(providerUsi);
            } else {
              //read subdirectories
              const pathToRecipientResults = join(pathToResults, providerUoiAndUsiPath);
              const recipientUoiPaths = filterIgnoredPaths(await readDirectory(pathToRecipientResults));

              if (!recipientUoiPaths?.length) {
                console.error(chalk.redBright.bold(`Error: Could not find recipient paths for ${providerUoiAndUsiPath}! Skipping...`));
              } else {
                for await (const recipientUoi of recipientUoiPaths) {
                  console.log(
                    chalk.cyanBright.bold(
                      `\nProcessing results for providerUoi: '${providerUoi}', providerUsi: '${providerUsi}', recipientUoi: '${recipientUoi}'...`
                    )
                  );

                  if (!orgMap[recipientUoi]) {
                    console.log(chalk.redBright.bold(`Error: '${recipientUoi}' is not a valid UOI! Skipping...`));
                    STATS.skippedRecipientPaths.push(join(pathToResults, providerUoiAndUsiPath, recipientUoi));
                  } else {
                    const currentResultsPath = join(pathToResults, providerUoiAndUsiPath, recipientUoi, CERTIFICATION_RESULTS_DIRECTORY);
                    console.log(chalk.bold(`Path: ${currentResultsPath}`));
                    const results = await readDirectory(currentResultsPath);

                    if (!results?.length) {
                      console.log(chalk.redBright.bold('Error: No results found to restore! Skipping...\n'));
                      STATS.missingResultsPaths.push(currentResultsPath);
                    } else {
                      if (areRequiredFilesPresent(results)) {
                        STATS.processed.push(currentResultsPath);
                        console.log(chalk.green.bold('Found required results files!'));

                        const hasLookupResourceMetadata = !!results.find(
                          result => result === CERTIFICATION_FILES.LOOKUP_RESOURCE_LOOKUP_METADATA
                        );

                        const hasProcessedMetadataReport = !!results.find(
                          result => result === CERTIFICATION_FILES.PROCESSED_METADATA_REPORT
                        );

                        //if the server is using the Lookup Resource then preprocess results if they're not already present
                        //TODO: add option to rescore results
                        if (hasLookupResourceMetadata && !hasProcessedMetadataReport) {
                          const pathToMetadataReport = resolve(join(currentResultsPath, CERTIFICATION_FILES.METADATA_REPORT)),
                            pathToLookupResourceData = resolve(
                              join(currentResultsPath, CERTIFICATION_FILES.LOOKUP_RESOURCE_LOOKUP_METADATA)
                            ),
                            pathToOutputFile = resolve(join(currentResultsPath, CERTIFICATION_FILES.PROCESSED_METADATA_REPORT));
                          await processLookupResourceMetadataFiles(pathToMetadataReport, pathToLookupResourceData, pathToOutputFile);
                        }

                        const metadataReport =
                          JSON.parse(
                            await readFile(
                              join(
                                currentResultsPath,
                                hasLookupResourceMetadata
                                  ? CERTIFICATION_FILES.PROCESSED_METADATA_REPORT
                                  : CERTIFICATION_FILES.METADATA_REPORT
                              )
                            )
                          ) || {};

                        const dataAvailabilityReport =
                          JSON.parse(await readFile(join(currentResultsPath, CERTIFICATION_FILES.DATA_AVAILABILITY_REPORT))) || {};

                        console.log('Ingesting results...');
                        const result = await processDataDictionaryResults({
                          url,
                          providerUoi,
                          providerUsi,
                          recipientUoi,
                          metadataReport,
                          dataAvailabilityReport
                        });
                        console.log(chalk.bold(`Done! Result: ${result ? 'Succeeded!' : 'Failed!'}`));
                      } else {
                        console.log(chalk.redBright.bold(`Error: Could not find required files in ${currentResultsPath}`));
                        STATS.missingResultsFilePaths.push(currentResultsPath);
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
      console.log('\n');
    } else {
      console.error(chalk.bgRedBright.bold(`Invalid path: ${pathToResults}! \nMust be valid S3 or local path`));
    }
  } catch (err) {
    console.error(chalk.redBright.bold(err));
    return;
  }

  const timeTaken = Math.round((new Date() - START_TIME) / 1000);
  const totalItems = Object.values(STATS).reduce((acc, stats) => (acc += stats.length), 0);

  console.log(chalk.magentaBright.bold('------------------------------------------------------------'));
  console.log(chalk.bold(`Processing complete! Time Taken: ~${timeTaken}s`));
  console.log(chalk.magentaBright.bold('------------------------------------------------------------'));

  console.log(chalk.bold(`\nItems Processed: ${STATS.processed.length} of ${totalItems}`));
  logCollectionAsBulletList(STATS.processed);

  console.log(chalk.bold(`\nProvider UOI Paths Skipped: ${STATS.skippedProviderUoiPaths.length}`));
  logCollectionAsBulletList(STATS.skippedProviderUoiPaths);

  console.log(chalk.bold(`\nProvider USI Paths Skipped: ${STATS.skippedUsiPaths.length}`));
  logCollectionAsBulletList(STATS.skippedUsiPaths);

  console.log(chalk.bold(`\nRecipient UOI Paths Skipped: ${STATS.skippedRecipientPaths.length}`));
  logCollectionAsBulletList(STATS.skippedRecipientPaths);

  console.log(chalk.bold(`\nMissing Results: ${STATS.missingResultsPaths.length}`));
  logCollectionAsBulletList(STATS.missingResultsPaths);

  console.log(chalk.bold(`\nMissing Results Files: ${STATS.missingResultsFilePaths.length}`));
  logCollectionAsBulletList(STATS.missingResultsFilePaths);

  console.log(chalk.bold('\nRestore complete! Exiting...\n'));
};

module.exports = {
  restore,
  readDirectory
};
