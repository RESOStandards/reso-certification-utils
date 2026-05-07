'use strict';

const { promises: fs } = require('fs');
const { join } = require('path');
const chalk = require('chalk');
const { isValidUrl, checkFileExists, sleep } = require('../../common');
const {
  fetchAllWebApiReports,
  fetchDataDictionaryReportIds,
  fetchSingleDDReport,
  fetchDataAvailabilityReport,
  fetchAllArchivedReports
} = require('../misc/data-access/cert-api-client');

const BACKUP_DIRECTORY = 'reso-server-backup',
  ARCHIVED_DIRECTORY = 'archived',
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
 * Infers the report type from `description` for older archive docs that pre-date
 * the explicit `type` field on the doc. The content is never modified — this is only
 * used to derive a sensible filename and directory layout on disk.
 */
const inferArchivedType = ({ type, description = '' }) => {
  if (type) return type;
  const d = description.toLowerCase();
  if (d.includes('data dictionary')) return DATA_DICTIONARY;
  if (d.includes('webapi') || d.includes('web api')) return WEB_API_SERVER_CORE;
  return 'archived';
};

/**
 * Saves an archived report under the `archived/` subtree of the backup directory.
 * Archived docs flow through restore with `archived: true` so they're written back
 * to the certification-archive index.
 *
 * @param {Object} report the archived report to save
 * @param {String} archivedBasePath the root archived directory path
 * @param {Object} stats stats tracker object (mutated in place)
 */
const saveArchivedReportToDisk = async (report, archivedBasePath, stats) => {
  const { recipientUoi, providerUoi, providerUsi, version, id } = report;
  const effectiveType = inferArchivedType(report);
  // Append the archive id to the filename so that re-archive events for the same
  // provider/recipient/type don't overwrite each other on disk.
  const baseFileName = fileNameMap[effectiveType] ?? `${effectiveType}.json`;
  const fileName = baseFileName.replace(/\.json$/, `-${id}.json`);
  const endorsementType = getEndorsementType(effectiveType);

  try {
    const finalBackupPath = join(
      archivedBasePath,
      `${endorsementType}-${version}`,
      `${providerUoi}-${providerUsi}`,
      recipientUoi
    );

    await fs.mkdir(finalBackupPath, { recursive: true });
    await fs.writeFile(join(finalBackupPath, fileName), JSON.stringify(report));

    const statKey = `${effectiveType}_archived`;
    if (!(statKey in stats)) stats[statKey] = 0;
    stats[statKey]++;

    console.log(
      chalk.bold(
        `Backup successful for archived ${chalk.greenBright.bold(effectiveType)} report ${chalk.greenBright.bold(id)}`
      )
    );
  } catch (err) {
    console.log(err);
    console.log(chalk.redBright.bold(`Error backing up archived ${effectiveType} report ${id}`));
  }
};

/**
 * Fetches all archived reports from the server and saves them under {backupPath}/archived/.
 *
 * @param {String} serverUrl the certification API URL
 * @param {String} backupPath the base backup directory path
 * @param {Object} stats stats tracker object
 * @returns {Number} count of archived reports fetched
 */
const getAllArchivedReports = async (serverUrl, backupPath, stats) => {
  console.log(chalk.greenBright.bold(`Fetching archived reports on ${serverUrl}. This may take a while...`));

  const reports = (await fetchAllArchivedReports({ serverUrl })) || [];
  if (!reports.length) {
    console.log(chalk.bold('No archived reports found.'));
    return 0;
  }

  const archivedBasePath = join(backupPath, ARCHIVED_DIRECTORY);
  await fs.mkdir(archivedBasePath, { recursive: true });

  let count = 0;
  for (const report of reports) {
    count++;
    console.log(chalk.greenBright.bold(`Archiving report ${count} of ${reports.length}`));
    await saveArchivedReportToDisk(report, archivedBasePath, stats);
  }

  return reports.length;
};

/**
 * Backs up reports from a RESO Certification API server to a local directory.
 *
 * @param {Object} options includes url, pathToBackup, dataDictionary, webApi, skip, includeArchived
 * @param {Array} preFetchedDDReportIds optional pre-fetched DD report IDs
 */
const backup = async (options = {}, preFetchedDDReportIds = []) => {
  const {
    url = '',
    pathToBackup = '',
    dataDictionary = false,
    webApi = false,
    skip = 0,
    includeArchived = false
  } = options;

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

    let archivedReportsCount = 0;
    if (includeArchived) {
      archivedReportsCount = await getAllArchivedReports(url, backupPath, stats);
    }
    stats.archivedReportsCount = archivedReportsCount;

    console.log(chalk.greenBright.bold(`\nBackup successful for ${url}\n`));

    const knownTypes = new Set([
      DATA_DICTIONARY,
      DATA_AVAILABILITY,
      WEB_API_SERVER_CORE,
      'ddReportsCount',
      'daReportsCount',
      'archivedReportsCount'
    ]);

    const statMessages = [
      `Data Dictionary (backed up/total): ${chalk.greenBright.bold(`${stats[DATA_DICTIONARY]}/${stats.ddReportsCount}`)}`,
      `Data Availability (backed up/total): ${chalk.greenBright.bold(`${stats[DATA_AVAILABILITY]}/${stats.daReportsCount}`)}`,
      `Web API Server Core (backed up/total): ${chalk.greenBright.bold(`${stats[WEB_API_SERVER_CORE]}/${webApiReports.length}`)}`,
      includeArchived
        ? `Archived Reports (backed up/total): ${chalk.greenBright.bold(
          `${Object.keys(stats).filter(k => k.endsWith('_archived')).reduce((acc, k) => acc + stats[k], 0)}/${archivedReportsCount}`
        )}`
        : null,
      ...Object.keys(stats)
        .filter(type => !knownTypes.has(type) && !type.endsWith('_archived'))
        .map(type => `${type} (backed up/total): ${chalk.greenBright.bold(`${stats[type]}/${stats[type]}`)}`)
    ].filter(Boolean);

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
