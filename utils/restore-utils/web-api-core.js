//const conf = new (require('conf'))();
const chalk = require('chalk');
const { promises: fs } = require('fs');
const { checkFileExists } = require('../../common');
const {
  getOrgsMap,
  getOrgSystemsMap,
  findWebAPIReport,
  processWebAPIResults,
  getSystemsMap,
  deleteExistingDDOrWebAPIReport,
  sleep
} = require('../../data-access/cert-api-client');

const OVERWRITE_DELAY_S = 10;

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

const fetchOrgData = async () => {
  //fetch org data
  console.log(chalk.cyanBright.bold('\nFetching org data...'));
  const orgMap = (await getOrgsMap()) || {};
  if (!Object.keys(orgMap)?.length) throw new Error('Error: could not fetch orgs!');
  console.log(chalk.cyanBright.bold('Done!'));
  return orgMap;
};

const fetchSystemData = async () => {
  //fetch system data
  console.log(chalk.cyanBright.bold('\nFetching system data...'));
  const orgSystemMap = (await getOrgSystemsMap()) || {};
  if (!Object.keys(orgSystemMap)?.length) throw new Error('Error: could not fetch systems!');
  console.log(chalk.cyanBright.bold('Done!'));
  return orgSystemMap;
};

const isValidUrl = url => {
  try {
    new URL(url);
    return true;
  } catch (err) {
    console.log(chalk.redBright.bold(`Error: Cannot parse given url: ${url}`));
    return false;
  }
};

/**
 * @param {Object} options
 * @param {string} options.pathToResults An absolute local path to the WebAPI results or a valid S3 path.
 * @param {string} options.url Cert API base URL.
 * @param {string} options.recipients Comma seperated string of recipient uoi's.
 * @param {string} options.system System name for the provider.
 * @throws Error if path is not a valid S3 or local path
 */
const syncWebApi = async (options = {}) => {
  const START_TIME = new Date();

  const { pathToResults, url, recipients = '', system = '', deleteExistingReport = false } = options;

  if (deleteExistingReport) {
    console.log(
      chalk.bgYellowBright.bold(
        'WARNING: --deleteExistingReport flag is set! This can delete an already certified report!'
      )
    );
    console.log(
      chalk.bold(
        `Waiting ${OVERWRITE_DELAY_S} seconds before proceeding...use <ctrl+c> to exit if this was unintended!`
      )
    );
    await sleep(OVERWRITE_DELAY_S * 1000);
  }

  if (isS3Path(pathToResults)) {
    console.log(
      chalk.yellowBright.bold(`S3 path provided but not supported at this time!\nPath: ${pathToResults}`)
    );
    process.exit(1);
  }

  if (!isValidUrl(url)) process.exit(1);

  const recipientsList = recipients.split(',');
  if (!recipientsList.length || !recipientsList[0]) {
    console.log(chalk.redBright.bold(`Error: The recipient string '${recipients}' is invalid`));
    process.exit(1);
  }
  console.log(chalk.bold(`\nCertification API URL: ${url}`));
  console.log(chalk.bold(`Path to results: ${pathToResults}`));
  console.log(chalk.bold(`Recipients: ${recipientsList}`));

  if (isLocalPath(pathToResults)) {
    const orgMap = await fetchOrgData();
    const orgSystemMap = await fetchSystemData();
    const systemMap = await getSystemsMap();

    console.log(chalk.greenBright.bold('\nRestore process starting...\n'));

    const providerUoi = systemMap[system];

    //is provider UOI valid?
    if (!orgMap[providerUoi]) {
      console.warn(chalk.redBright.bold(`Error: Could not find providerUoi '${providerUoi}'! Exiting...`));
      process.exit(1);
    }

    //is provider USI valid?
    const systems = orgSystemMap[providerUoi] || [];
    if (!systems?.length) {
      console.warn(
        chalk.redBright.bold(`Error: Could not find systems for providerUoi '${providerUoi}'! Exiting...`)
      );
      process.exit(1);
    }

    if (!systems?.includes(system)) {
      console.log(`Error: Could not find system ${system} for providerUoi '${providerUoi}'! Exiting...`);
      process.exit(1);
    }

    const fileExists = await checkFileExists(pathToResults);

    if (!fileExists) {
      console.log(chalk.redBright.bold(`Error: Could not find file in path '${pathToResults}'`));
      process.exit(1);
    }

    const webAPIReport = JSON.parse(await readFile(pathToResults)) || {};

    for await (const recipientUoi of recipientsList) {
      try {
        if (deleteExistingReport) {
          //search for existing results
          const report =
            (await findWebAPIReport({
              serverUrl: url,
              providerUoi,
              providerUsi: system,
              recipientUoi
            })) || {};

          const { id: reportId = null } = report;
          if (reportId) {
            console.log(chalk.yellowBright.bold('Deleting existing report...'));
            await deleteExistingDDOrWebAPIReport({
              url,
              reportId
            });
          }
        }

        console.log('Ingesting results...');
        const result = await processWebAPIResults({
          url,
          providerUoi,
          providerUsi: system,
          recipientUoi,
          webAPIReport: webAPIReport
        });

        console.log(chalk.bold(`Result: ${result ? 'Succeeded!' : 'Failed!'}`));
      } catch (err) {
        console.log(chalk.bgRed.bold(err));
      }
    }
  } else {
    console.log(chalk.bgRedBright.bold(`Invalid path: ${pathToResults}! \nMust be valid S3 or local path`));
  }

  const timeTaken = Math.round((new Date() - START_TIME) / 1000);

  console.log(chalk.magentaBright.bold('------------------------------------------------------------'));

  console.log(chalk.bold(`Time Taken: ~${timeTaken}s`));
  console.log(chalk.magentaBright.bold('------------------------------------------------------------'));

  console.log(chalk.bold('\nRestore complete! Exiting...\n'));
};

module.exports = {
  syncWebApi
};
