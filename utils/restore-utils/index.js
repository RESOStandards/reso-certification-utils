//const conf = new (require('conf'))();
const chalk = require('chalk');
const { promises: fs } = require('fs');
// const { join } = require('path');
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
    const items = await fs.readdir(path);
    items.map(item => console.log(`\t${item}`));
    return items;
  } catch (err) {
    console.error(
      chalk.red.bold(`Error trying to read from the given path! Path: ${path}, Error: ${err}`)
    );
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
 * Restores a RESO Certification Server from either a local or S3 path.
 * @param {String} path
 * @throws error if path is not a valid S3 or local path
 */
const restore = async (options = {}) => {
  const { pathToResults, url } = options;

  console.log(chalk.greenBright.bold('\nRestore process starting...'));

  console.log(chalk.cyanBright.bold('\nFetching org data...'));
  const orgMap = await getOrgsMap() || {};
  if (!Object.keys(orgMap)?.length) throw new Error('ERROR: could not fetch orgs!');
  console.log(chalk.cyanBright.bold('Done!'));

  console.log(chalk.cyanBright.bold('\nFetching system data...'));
  const orgSystemMap = await getOrgSystemsMap() || {};
  if (!Object.keys(orgSystemMap)?.length) throw new Error('ERROR: could not fetch systems!');
  console.log(chalk.cyanBright.bold('Done!'));

  console.log(chalk.blueBright.bold(`\nCertification API URL: ${url}`));

  if (isS3Path(pathToResults)) {

    console.log(chalk.blueBright.bold(`S3 path provided! Path: ${pathToResults.toString()}`));

  } else if (isLocalPath(pathToResults)) {
  
    console.log(chalk.blueBright.bold(`Local path ${pathToResults} contains the following items:`));
    const items = await readDirectory(pathToResults);
    

    items.forEach((item = '') => {
      const [providerUoi, providerUsi, ] = item.split(PATH_DATA_SEPARATOR);
      console.log(chalk.cyanBright.bold(`\nProcessing item: ${item}...`));

      if (!orgMap[providerUoi]) {
        console.warn(chalk.yellowBright.bold(`\tWARNING: could not find providerUoi '${providerUoi}'! Skipping...`));
        return;
      } else {
        console.log(`\tFound providerUoi '${providerUoi}'!`);
      }

      const systems = orgSystemMap[providerUoi] || [];
      if (!systems?.length) {
        console.warn(chalk.yellowBright.bold(`\tWARNING: could not find systems for providerUoi '${providerUoi}'! Skipping...`));
        return;
      } else {
        if (systems.find(system => system === providerUsi)) {
          console.log(`\tFound system ${providerUsi} for providerUoi '${providerUoi}'!`);
        } else {
          console.log(`\tCould not find system ${providerUsi} for providerUoi '${providerUoi}'! Skipping...`);
          return;
        }
      }
    });

    console.log(chalk.greenBright.bold('\nRestore process complete!\n'));

  } else {
    console.error(
      chalk.red.bold(`Invalid path: ${pathToResults}! \nMust be valid S3 or local path`)
    );
  }
};

module.exports = {
  restore
};
