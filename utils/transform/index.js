const chalk = require('chalk');
const { ENDORSEMENTS_PATH } = process.env;
const { isValidUrl } = require('../../common');
const {
  fetchDataDictionaryReportIds,
  fetchDataAvailabilityReport,
  sleep,
  postRescoredReport
} = require('../../data-access/cert-api-client');
const {
  processDataAvailability: { processDataAvailability }
} = require('reso-certification-etl');
const { backup: createBackup } = require('../backup');

const transform = async (options = {}) => {
  const { url = '', pathToBackup = '', backup = false, rescore = false } = options;
  if (!isValidUrl(url)) return;
  const stats = {
    total: 0,
    found: 0,
    backedUp: 0,
    rescored: 0
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

  // for each report id fetch the sequentially corresponding data availability report, correct the frequency count and rescore
  for (const reportId of reportIds) {
    console.clear();
    console.log(chalk.greenBright.bold(`Progress: ${++counter}/${reportIds.length}`));

    const data = await fetchDataAvailabilityReport({ serverUrl: url, reportId });
    if (!data) continue;
    stats.found++;

    // rescore
    if (rescore) {
      const fieldsMap = data.fields.reduce((acc, field) => {
        const { resourceName, fieldName } = field;
        if (!acc[resourceName]) acc[resourceName] = {};
        acc[resourceName][fieldName] = field;
        return acc;
      }, {});

      // const lookupValuesMap = data.lookupValues.reduce((acc, lookup) => {
      //   const { fieldName, resourceName, frequency, availability } = lookup;
      //   if (!acc[resourceName]) acc[resourceName] = {};
      //   if (!acc[resourceName][fieldName])
      //     acc[resourceName][fieldName] = {
      //       frequency: 0,
      //       availability: 0
      //     };
      //   acc[resourceName][fieldName].frequency += frequency;
      //   acc[resourceName][fieldName].availability += availability;
      //   return acc;
      // }, {});

      // TODO: verify that this is correct
      // sanity check values
      // Object.entries(lookupValuesMap).forEach(([rName, value]) => {
      //   Object.entries(value).forEach(([fName, { frequency, availability }]) => {
      //     if (fieldsMap[rName][fName].frequency !== frequency) {
      //       console.log(
      //         `Frequency mistmatch [${rName}-${fName}]\n Count: ${fieldsMap[rName][fName].frequency}\nActual: ${frequency}`
      //       );
      //     }
      //     if (fieldsMap[rName][fName].availability !== availability) {
      //       console.log(
      //         `Availability mistmatch.\n Count: ${fieldsMap[rName][fName].availability}\nActual: ${availability}`
      //       );
      //     }
      //   });
      // });

      // adjust frequency and availability values
      data.lookupValues.forEach(lookup => {
        const { fieldName, frequency, resourceName, availability, lookupValue } = lookup;
        if (lookupValue === 'EMPTY_LIST' || lookupValue === 'NULL_VALUE') {
          // only adjust counts if not adjusted already (prevents multiple count adjustments)
          if (fieldsMap[resourceName][fieldName].frequency > frequency)
            fieldsMap[resourceName][fieldName].frequency -= frequency;
          if (fieldsMap[resourceName][fieldName].availability > availability)
            fieldsMap[resourceName][fieldName].availability -= availability;
        }
      });
      try {
        // recover the raw availability report
        const {
          description = 'RESO Data Availability Report',
          version,
          generatedOn,
          resources,
          fields,
          lookupValues,
          lookups,
          optInStatus
        } = data;

        const rawAvailabilityReport = {
          resources,
          fields: fields.map(({ resourceName, fieldName, frequency }) => ({
            resourceName,
            fieldName,
            frequency
          })),
          lookupValues: lookupValues.map(({ resourceName, fieldName, lookupValue, frequency }) => ({
            resourceName,
            fieldName,
            lookupValue,
            frequency
          })),
          lookups
        };

        const rescoredReport = await processDataAvailability(rawAvailabilityReport);

        // post the rescored report to the /rescore endpoint
        const responseStatus = await postRescoredReport({
          serverUrl: url,
          rescoredReport: {
            ...rescoredReport,
            description,
            version,
            generatedOn,
            optInStatus
          },
          reportId
        });

        if (responseStatus) {
          stats.rescored++;
          console.log(chalk.greenBright.bold('Successfully updated availability report\n'));
        } else {
          console.log(
            chalk.yellowBright.bold(`Couldn't post availability report ${reportId} to the rescore endpoint\n`)
          );
        }
      } catch (error) {
        console.log(error);
        console.log(chalk.yellowBright.bold(`Couldn't rescore availability report ${reportId}\n`));
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
        `Total reports successfully rescored: ${stats.rescored}`
      ].join('\n')
    )
  );
};

module.exports = {
  transform
};
