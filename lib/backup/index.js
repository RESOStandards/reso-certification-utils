'use strict';

const { promises: fs } = require('fs');
const { join } = require('path');
const chalk = require('chalk');
const { isValidUrl, checkFileExists, sleep } = require('../../common');
const {
  fetchAllWebApiReports,
  fetchDataDictionaryReportIds,
  fetchSingleDDReport,
  fetchDataAvailabilityReport
} = require('../misc/data-access/cert-api-client');

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

/**
 * Determines the endorsement type directory name for a given report type.
 *
 * @param {String} type the report type
 * @returns endorsement type string used in the directory structure
 */
const getEndorsementType = (type = '') => {
  switch (type) {
    case WEB_API_SERVER_CORE:
      return WEB_API_REPORT_JSON;
    case DATA_AVAILABILITY:
    case DATA_DICTIONARY:
      return DATA_DICTIONARY;
    default:
      return type;
  }
};

/**
 * Saves a report to disk in the backup directory structure:
 * {backupPath}/{endorsementType}-{version}/{providerUoi}-{providerUsi}/{recipientUoi}/{fileName}
 *
 * @param {Object} report the report to save
 * @param {String} backupPath the base backup directory path
 * @param {Object} stats stats tracker object (mutated in place)
 */
const saveReportToDisk = async (report, backupPath, stats) => {
  const { recipientUoi, providerUoi, providerUsi, type, version, id } = report;
  const fileName = fileNameMap[type] ?? `${type}.json`;
  const endorsementType = getEndorsementType(type);

  try {
    const finalBackupPath = join(
      backupPath,
      `${endorsementType}-${version}`,
      `${providerUoi}-${providerUsi}`,
      recipientUoi
    );

    await fs.mkdir(finalBackupPath, { recursive: true });
    await fs.writeFile(join(finalBackupPath, fileName), JSON.stringify(report));

    if (!(type in stats)) {
      stats[type] = 0;
    }
    stats[type]++;

    console.log(
      chalk.bold(`Backup successful for ${chalk.greenBright.bold(type)} report ${chalk.greenBright.bold(id)}`)
    );
  } catch (err) {
    console.log(err);
    console.log(chalk.redBright.bold(`Error backing up ${type} report ${id}`));
  }
};

/**
 * Fetches all DD and DA reports from the server and saves them to disk.
 *
 * @param {String} serverUrl the certification API URL
 * @param {Array} preFetchedDDReportIds optional pre-fetched report IDs
 * @param {String} backupPath the base backup directory path
 * @param {Object} stats stats tracker object
 * @param {Number} skip number of reports to skip
 * @returns {Object} counts of DD and DA reports fetched
 */
const getAllDDAndDAReports = async (serverUrl, preFetchedDDReportIds, backupPath, stats, skip = 0) => {
  let ddReportIds = [];
  let otherReports = [];
  let ddReports = 0;
  let daReports = 0;

  console.log(chalk.greenBright.bold(`Fetching data dictionary reports on ${serverUrl}. This may take a while...`));

  if (!preFetchedDDReportIds.length) {
    const [ddIds, placeholderReports] = await fetchDataDictionaryReportIds({
      serverUrl,
      backup: true
    });
    ddReportIds = ddIds;
    otherReports = placeholderReports;
  } else {
    ddReportIds = preFetchedDDReportIds;
  }

  let count = 0;
  for (const id of ddReportIds) {
    count++;
    console.log(chalk.greenBright.bold(`Fetching report ${count} of ${ddReportIds.length}`));

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
      daReport.providerUsi = daReport.providerUsi || ddReport?.providerUsi;
      await saveReportToDisk(daReport, backupPath, stats);
    }

    await sleep(200);
  }

  for (const report of otherReports) {
    await saveReportToDisk(report, backupPath, stats);
  }

  return { ddReports, daReports };
};

/**
 * Backs up reports from a RESO Certification API server to a local directory.
 *
 * @param {Object} options includes url, pathToBackup, dataDictionary, webApi, skip
 * @param {Array} preFetchedDDReportIds optional pre-fetched DD report IDs
 */
const backup = async (options = {}, preFetchedDDReportIds = []) => {
  const { url = '', pathToBackup = '', dataDictionary = false, webApi = false, skip = 0 } = options;

  if (!isValidUrl(url)) {
    console.log(chalk.redBright.bold(`Error: Invalid URL: ${url}`));
    return;
  }

  const backupPath = join(pathToBackup, BACKUP_DIRECTORY);

  try {
    if (!(await checkFileExists(backupPath))) {
      await fs.mkdir(backupPath, { recursive: true });
    }
  } catch (err) {
    console.log(err);
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
        stats,
        skip
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

    console.log(chalk.greenBright.bold(`\nBackup successful for ${url}\n`));

    const statMessages = [
      `Data Dictionary (backed up/total): ${chalk.greenBright.bold(`${stats[DATA_DICTIONARY]}/${stats.ddReportsCount}`)}`,
      `Data Availability (backed up/total): ${chalk.greenBright.bold(`${stats[DATA_AVAILABILITY]}/${stats.daReportsCount}`)}`,
      `Web API Server Core (backed up/total): ${chalk.greenBright.bold(`${stats[WEB_API_SERVER_CORE]}/${webApiReports.length}`)}`
    ];

    console.log(chalk.bold(statMessages.join('\n')));

    return stats;
  } catch (err) {
    console.log(chalk.redBright.bold(`Error backing up data on ${url}`));
    console.log(err);
  }
};

module.exports = {
  backup
};
