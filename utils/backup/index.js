const fs = require('fs/promises');
const chalk = require('chalk');
const { isValidUrl, checkFileExists, fetchSystemData } = require('../../common');
const path = require('path');
const {
  fetchAllWebApiReports,
  fetchDataDictionaryReportIds,
  fetchSingleDDReport,
  fetchDataAvailabilityReport,
  sleep
} = require('../../data-access/cert-api-client');
const { multiUsiUoiMappings } = require('../../data-access/usi-mapping');
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
  const fileName = fileNameMap[type];
  const endorsementType = type === WEB_API_SERVER_CORE ? WEB_API_SERVER_CORE : DATA_DICTIONARY;
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

const getAllDDAndDAReports = async (serverUrl, preFetchedDDReportIds, backupPath, stats) => {
  let ddReportIds = [];
  let ddReports = 0;
  let daReports = 0;
  console.log(
    chalk.greenBright.bold(`Fetching data dictionary reports on ${serverUrl}. This may take a while...`)
  );
  const systemData = await fetchSystemData();
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
    ddReports++;
    if (ddReport) {
      if (!ddReport.providerUsi) {
        const usis = systemData[ddReport.providerUoi];
        if (usis.length > 1) {
          // handle multi usi case
          const usi =
            multiUsiUoiMappings[ddReport.providerUoi]?.[ddReport.recipientUoi] ||
            multiUsiUoiMappings[ddReport?.providerUoi]?.__default__;
          ddReport.providerUsi = usi;
        } else {
          const [usi] = usis;
          ddReport.providerUsi = usi;
        }
      }
      await saveReportToDisk(ddReport, backupPath, stats);
    }
    if (daReport) {
      daReports++;
      daReport.providerUsi = daReport.providerUsi || ddReport.providerUsi;
      await saveReportToDisk(daReport, backupPath, stats);
    }
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
        stats
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
      const systemData = await fetchSystemData();
      for (const report of webApiReports) {
        if (!report.providerUsi) {
          const usis = systemData[report.providerUoi];
          if (usis.length > 1) {
            // handle multi usi case
            const usi =
              multiUsiUoiMappings[report.providerUoi]?.[report.recipientUoi] ||
              multiUsiUoiMappings[report?.providerUoi]?.__default__;
            report.providerUsi = usi;
          } else {
            const [usi] = usis;
            report.providerUsi = usi;
          }
        }
        await saveReportToDisk(report, backupPath, stats);
      }
    }
    console.log(chalk.greenBright.bold(`\nBackup Successfull for ${url}\n`));
    console.log(
      chalk.bold(
        [
          `Data Dictionary (backed up/total): ${chalk.greenBright.bold(
            `${stats.data_dictionary}/${stats.ddReportsCount}`
          )}`,
          `Data Availability (backed up/total): ${chalk.greenBright.bold(
            `${stats.data_availability}/${stats.daReportsCount}`
          )}`,
          `Web Api Server Core (backed up/total): ${chalk.greenBright.bold(
            `${stats.web_api_server_core}/${webApiReports.length}`
          )}`
        ].join('\n')
      )
    );
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
