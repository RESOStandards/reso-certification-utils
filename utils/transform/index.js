const chalk = require('chalk');
const { ENDORSEMENTS_PATH } = process.env;
const { isValidUrl } = require('../../common');
const { rescore: rescoreReports } = require('./transformations/rescore');
const { runEtlOnReport } = require('./transformations/runEtl');
const {
  fetchDataDictionaryReportIds,
  fetchDataAvailabilityReport,
  sleep,
  postTransformedReport
} = require('../../data-access/cert-api-client');
const { backup: createBackup } = require('../backup');

const composeTransformations = async (transformations = [], initialData = {}) => {
  let result = initialData;
  for (const t of transformations) {
    const value = t(result);
    if (value instanceof Promise) {
      result = await value;
    } else {
      result = value;
    }
  }
  return result;
};

const transform = async (options = {}) => {
  const { url = '', pathToBackup = '', backup = false, rescore = false, runEtl = false } = options;
  if (!isValidUrl(url)) return;
  const stats = {
    total: 0,
    found: 0,
    backedUp: 0,
    transformed: 0
  };

  console.log(chalk.greenBright.bold(`Fetching data dictionary reports on ${url}`));
  const reportIds = await fetchDataDictionaryReportIds({
    serverUrl: url,
    endorsementsPath: ENDORSEMENTS_PATH
  });
  stats.total = reportIds.length;

  if (backup) {
    const { data_dictionary } =
      (await createBackup({ url, pathToBackup, dataDictionary: true }, reportIds)) || {};
    stats.backedUp = data_dictionary || 0;
  }

  console.log(chalk.greenBright.bold(`Found ${reportIds.length} data dictionary reports.`));
  let counter = 0;

  for (const reportId of reportIds) {
    console.clear();
    console.log(chalk.greenBright.bold(`Progress: ${++counter}/${reportIds.length}`));

    const data = await fetchDataAvailabilityReport({ serverUrl: url, reportId });
    if (!data) continue;
    stats.found++;

    const transformations = [];
    if (rescore) {
      transformations.push(rescoreReports);
    }
    if (runEtl) {
      transformations.push(runEtlOnReport);
    }
    if (transformations.length) {
      const finalTransformedReport = await composeTransformations(transformations, data);
      try {
        // post the transformed report to the /rescore endpoint
        const responseStatus = await postTransformedReport({
          serverUrl: url,
          rescoredReport: finalTransformedReport,
          reportId
        });

        if (responseStatus) {
          stats.transformed++;
          console.log(chalk.greenBright.bold('Successfully updated availability report\n'));
        } else {
          console.log(
            chalk.yellowBright.bold(`Couldn't post availability report ${reportId} to the server\n`)
          );
        }
      } catch (error) {
        console.log(error);
        console.log(chalk.yellowBright.bold(`Couldn't transform availability report ${reportId}\n`));
      }
    }
    await sleep(500);
  }
  console.log(
    chalk.greenBright.bold(
      [
        `Total DD reports found: ${stats.total}`,
        `DD reports with attached DA reports: ${stats.found}`,
        `Total reports backed up: ${stats.backedUp}`,
        `Total reports successfully transformed: ${stats.transformed}`
      ].join('\n')
    )
  );
};

module.exports = {
  transform
};
