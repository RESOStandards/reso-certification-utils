/* eslint-disable indent */
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
} = require('../misc/data-access/cert-api-client');
const { ENDORSEMENTS_PATH } = process.env;

const BACKUP_DIRECTORY = 'reso-server-backup',
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

async function saveReportToDisk(report, backupPath, stats) {
  const { recipientUoi, providerUoi, providerUsi, type, version, id } = report;
  const fileName = fileNameMap[type] ?? `${type}.json`;
  const endorsementType = (() => {
    switch (type) {
      case WEB_API_SERVER_CORE:
        return WEB_API_REPORT_JSON;
      case DATA_AVAILABILITY:
      case DATA_DICTIONARY:
        return DATA_DICTIONARY;
      default:
        return type;
    }
  })();
  try {
    const finalBackupPath = path.join(
      backupPath,
      `${endorsementType}-${version}`,
      `${providerUoi}-${providerUsi}`,
      recipientUoi
    );
    // TODO: this whole sequence can be extracted to a general function
    if (!(await checkFileExists(path.join(backupPath, `${endorsementType}-${version}`))))
      await fs.mkdir(path.join(backupPath, `${endorsementType}-${version}`));
    if (
      !(await checkFileExists(
        path.join(backupPath, `${endorsementType}-${version}`, `${providerUoi}-${providerUsi}`)
      ))
    )
      await fs.mkdir(path.join(backupPath, `${endorsementType}-${version}`, `${providerUoi}-${providerUsi}`));
    if (!(await checkFileExists(finalBackupPath))) await fs.mkdir(finalBackupPath);
    fs.writeFile(path.join(finalBackupPath, fileName), JSON.stringify(report));
    if (!(type in stats)) {
      stats[type] = 0;
    }
    stats[type]++;
    console.log(
      chalk.bold(
        `Backup Successfull for ${chalk.greenBright.bold(type)} report ${chalk.greenBright.bold(id)}`
      )
    );
  } catch (error) {
    console.log(error);
    console.log(chalk.redBright.bold(`Error backing up ${type} report ${id}`));
  }
}

const getAllDDAndDAReports = async (serverUrl, preFetchedDDReportIds, backupPath, stats, skip) => {
  let ddReportIds = [];
  let otherReports = [];
  let ddReports = 0;
  let daReports = 0;
  console.log(
    chalk.greenBright.bold(`Fetching data dictionary reports on ${serverUrl}. This may take a while...`)
  );
  if (!preFetchedDDReportIds.length) {
    const [ddIds, placeholderReports] = await fetchDataDictionaryReportIds({
      serverUrl,
      endorsementsPath: ENDORSEMENTS_PATH,
      backup: true
    });
    ddReportIds = ddIds;
    otherReports = placeholderReports;
  } else {
    ddReportIds = preFetchedDDReportIds;
  }
  let count = 0;
  for (const id of ddReportIds) {
    console.clear();
    console.log(chalk.greenBright.bold(`Fetching report ${++count} of ${ddReportIds.length}`));
    if (count < skip) {
      continue;
    }
    const ddReport = await fetchSingleDDReport({ serverUrl, id });
    const daReport = await fetchDataAvailabilityReport({ serverUrl, reportId: id });
    ddReports++;
    if (ddReport) {
      await saveReportToDisk(ddReport, backupPath, stats);
    }
    if (daReport) {
      daReports++;
      daReport.providerUsi = daReport.providerUsi || ddReport.providerUsi;
      await saveReportToDisk(daReport, backupPath, stats);
    }
    await sleep(200);
  }
  // placeholder reports TODO: handle this better
  for (const report of otherReports) {
    await saveReportToDisk(report, backupPath, stats);
  }
  return { ddReports, daReports };
};

const backup = async (options = {}, preFetchedDDReportIds = []) => {
  const { url = '', pathToBackup = '', dataDictionary = false, webApi = false, skip = 0 } = options;
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
    const webApiReports = [];
    const stats = {
      [DATA_DICTIONARY]: 0,
      [DATA_AVAILABILITY]: 0,
      [WEB_API_SERVER_CORE]: 0,
      ddReportsCount: 0,
      daReportsCount: 0
    };
    if ((!dataDictionary && !webApi) || (dataDictionary && webApi)) {
      // backup everything
      console.log(chalk.greenBright.bold(`Backing up everything on ${url}`));
      console.log(chalk.greenBright.bold(`Fetching web api reports on ${url}`));
      webApiReports.push(...((await fetchAllWebApiReports({ serverUrl: url })) || []));
      const { ddReports: ddReportsCount, daReports: daReportsCount } = await getAllDDAndDAReports(
        url,
        preFetchedDDReportIds,
        backupPath,
        stats,
        skip
      );
      stats.ddReportsCount = ddReportsCount;
      stats.daReportsCount = daReportsCount;
    } else if (dataDictionary) {
      console.log(chalk.greenBright.bold(`Backing up data dictionary on ${url}`));
      const { ddReports: ddReportsCount, daReports: daReportsCount } = await getAllDDAndDAReports(
        url,
        preFetchedDDReportIds,
        backupPath,
        stats
      );
      stats.ddReportsCount = ddReportsCount;
      stats.daReportsCount = daReportsCount;
    } else if (webApi) {
      console.log(chalk.greenBright.bold(`Backing up web api on ${url}`));
      console.log(chalk.greenBright.bold(`Fetching web api reports on ${url}`));
      webApiReports.push(...((await fetchAllWebApiReports({ serverUrl: url })) || []));
    }
    if (webApiReports.length) {
      for (const report of webApiReports) {
        await saveReportToDisk(report, backupPath, stats);
      }
    }
    console.log(chalk.greenBright.bold(`\nBackup Successfull for ${url}\n`));
    const statMessage = Object.keys(stats)
      .map(type => {
        switch (type) {
          case DATA_DICTIONARY:
            return `Data Dictionary (backed up/total): ${chalk.greenBright.bold(
              `${stats.data_dictionary}/${stats.ddReportsCount}`
            )}`;
          case DATA_AVAILABILITY:
            return `Data Availability (backed up/total): ${chalk.greenBright.bold(
              `${stats.data_availability}/${stats.daReportsCount}`
            )}`;
          case WEB_API_SERVER_CORE:
            return `Web Api Server Core (backed up/total): ${chalk.greenBright.bold(
              `${stats.web_api_server_core}/${webApiReports.length}`
            )}`;
          case 'ddReportsCount':
          case 'daReportsCount':
            return null;
          default:
            return `${type} (backed up/total): ${chalk.greenBright.bold(`${stats[type]}/${stats[type]}`)}`;
        }
      })
      .filter(Boolean);
    console.log(chalk.bold(statMessage.join('\n')));
    return stats;
  } catch (error) {
    console.log(chalk.redBright.bold(`Error backing up data on ${url}`));
    console.log(error);
    return;
  }
};

module.exports = {
  backup
};
