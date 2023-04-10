const fs = require('fs/promises');
const chalk = require('chalk');
const { isValidUrl, checkFileExists } = require('../../common');
const path = require('path');
const {
  fetchAllWebApiReports,
  fetchDataDictionaryReportIds,
  fetchSingleDDReport,
  fetchDataAvailabilityReport,
  sleep
} = require('../../data-access/cert-api-client');
const { ENDORSEMENTS_PATH } = process.env;

const BACKUP_DIRECTORY = 'reso-server-backup',
  CURRENT_DIRECTORY = 'current',
  DATA_DICTIONARY = 'data_dictionary',
  WEB_API_SERVER_CORE = 'web_api_server_core',
  DATA_AVAILABILITY = 'data_availability',
  METADATA_REPORT_JSON = 'metadata-report.json',
  DATA_AVAILABILITY_REPORT_JSON = 'data-availability-report.json',
  WEB_API_REPORT_JSON = 'web-api-core-report.json';

const fileNameMap = {
  [DATA_DICTIONARY]: METADATA_REPORT_JSON,
  [WEB_API_SERVER_CORE]: WEB_API_REPORT_JSON,
  [DATA_AVAILABILITY]: DATA_AVAILABILITY_REPORT_JSON
};

const getAllDDAndDAReports = async (serverUrl, preFetchedDDReportIds) => {
  let ddReportIds = [];
  const ddReports = [];
  const daReports = [];
  console.log(
    chalk.greenBright.bold(`Fetching data dictionary reports on ${serverUrl}. This may take a while...`)
  );
  if (!preFetchedDDReportIds.length) {
    ddReportIds = await fetchDataDictionaryReportIds({
      serverUrl,
      endorsementsPath: ENDORSEMENTS_PATH,
      backup: true
    });
  } else {
    ddReportIds = preFetchedDDReportIds;
  }
  let count = 0;
  for (const id of ddReportIds) {
    console.clear();
    console.log(chalk.greenBright.bold(`Fetching report ${++count} of ${ddReportIds.length}`));
    const ddReport = await fetchSingleDDReport({ serverUrl, id });
    const daReport = await fetchDataAvailabilityReport({ serverUrl, reportId: id });
    if (ddReport) ddReports.push(ddReport);
    if (daReport) daReports.push(daReport);
    await sleep(200);
  }
  return { ddReports, daReports };
};

const backup = async (options = {}, preFetchedDDReportIds = []) => {
  const { url = '', pathToBackup = '', dataDictionary = false, webApi = false } = options;
  if (!isValidUrl(url)) return;
  const backupPath = path.join(pathToBackup, BACKUP_DIRECTORY);
  try {
    const backupDirectoryExists = await checkFileExists(backupPath);
    if (!backupDirectoryExists) await fs.mkdir(backupPath);
  } catch (error) {
    console.log(error);
    console.log(chalk.redBright.bold(`Error creating the backup directory at ${backupPath}`));
    return;
  }
  try {
    const ddReports = [];
    const daReports = [];
    const webApiReports = [];
    const stats = {
      [DATA_DICTIONARY]: 0,
      [DATA_AVAILABILITY]: 0,
      [WEB_API_SERVER_CORE]: 0
    };
    if ((!dataDictionary && !webApi) || (dataDictionary && webApi)) {
      // backup everything
      console.log(chalk.greenBright.bold(`Backing up everything on ${url}`));
      console.log(chalk.greenBright.bold(`Fetching web api reports on ${url}`));
      webApiReports.push(...((await fetchAllWebApiReports({ serverUrl: url })) || []));
      const { ddReports: ddReportsFromApi, daReports: daReportsFromApi } = await getAllDDAndDAReports(
        url,
        preFetchedDDReportIds
      );
      ddReports.push(...ddReportsFromApi);
      daReports.push(...daReportsFromApi);
    } else if (dataDictionary) {
      console.log(chalk.greenBright.bold(`Backing up data dictionary on ${url}`));
      const { ddReports: ddReportsFromApi, daReports: daReportsFromApi } = await getAllDDAndDAReports(
        url,
        preFetchedDDReportIds
      );
      ddReports.push(...ddReportsFromApi);
      daReports.push(...daReportsFromApi);
    } else if (webApi) {
      console.log(chalk.greenBright.bold(`Backing up web api on ${url}`));
      console.log(chalk.greenBright.bold(`Fetching web api reports on ${url}`));
      webApiReports.push(...((await fetchAllWebApiReports({ serverUrl: url })) || []));
    }

    // we put all da reports after dd reports here so that a dd report already exists in the backup directory
    const mergedReports = [...webApiReports, ...ddReports, ...daReports];
    for (const report of mergedReports) {
      const { recipientUoi, providerUoi, providerUsi, type, version, id } = report;
      const fileName = fileNameMap[type];
      const endorsementType = type === 'web_api_server_core' ? 'web_api_server_core' : 'data_dictionary';
      try {
        const finalBackupPath = path.join(
          backupPath,
          `${endorsementType}-${version}`,
          `${providerUoi}-${providerUsi}`,
          recipientUoi,
          CURRENT_DIRECTORY
        );
        if (!(await checkFileExists(path.join(backupPath, `${endorsementType}-${version}`))))
          await fs.mkdir(path.join(backupPath, `${endorsementType}-${version}`));
        if (
          !(await checkFileExists(
            path.join(backupPath, `${endorsementType}-${version}`, `${providerUoi}-${providerUsi}`)
          ))
        )
          await fs.mkdir(
            path.join(backupPath, `${endorsementType}-${version}`, `${providerUoi}-${providerUsi}`)
          );
        if (
          !(await checkFileExists(
            path.join(
              backupPath,
              `${endorsementType}-${version}`,
              `${providerUoi}-${providerUsi}`,
              recipientUoi
            )
          ))
        )
          await fs.mkdir(
            path.join(
              backupPath,
              `${endorsementType}-${version}`,
              `${providerUoi}-${providerUsi}`,
              recipientUoi
            )
          );
        if (!(await checkFileExists(finalBackupPath))) await fs.mkdir(finalBackupPath);
        fs.writeFile(path.join(finalBackupPath, fileName), JSON.stringify(report));
        stats[type]++;
        console.log(
          chalk.bold(
            `Backup Successfull for ${chalk.greenBright.bold(type)} report ${chalk.greenBright.bold(id)}`
          )
        );
      } catch (error) {
        console.log(chalk.redBright.bold(`Error backing up ${type} report ${id}`));
      }
    }
    console.log(chalk.greenBright.bold(`\nBackup Successfull for ${url}\n`));
    console.log(
      chalk.bold(
        [
          `Data Dictionary (backed up/total): ${chalk.greenBright.bold(
            `${stats.data_dictionary}/${ddReports.length}`
          )}`,
          `Data Availability (backed up/total): ${chalk.greenBright.bold(
            `${stats.data_availability}/${daReports.length}`
          )}`,
          `Web Api Server Core (backed up/total): ${chalk.greenBright.bold(
            `${stats.web_api_server_core}/${webApiReports.length}`
          )}`
        ].join('\n')
      )
    );
  } catch (error) {
    console.log(chalk.redBright.bold(`Error backing up data on ${url}`));
    console.log(error);
    return;
  }
};

module.exports = {
  backup
};
