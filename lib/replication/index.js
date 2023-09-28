'use strict';

const { replicationIterator, REPLICATION_STRATEGIES } = require('./replication-iterator');
const { scorePayload, writeDataAvailabilityReport } = require('./utils');
const humanizeDuration = require('humanize-duration');
const { writeFile, mkdir } = require('fs/promises');

// need to get the last part of the URL before the querystring
const parseResourceNameFromODataRequestUri = (requestUri = '') => {
  try {
    const [ resourceName = null ] = (new URL(requestUri))?.pathname?.split('/')?.slice(-1);
    return resourceName;
  } catch (err) {
    console.error(err);
    return null;
  }
};

const replicate = async ({ url: requestUri, strategy, bearerToken, outputPath, limit, expansions = [] }) => {
  if (!Object.values(REPLICATION_STRATEGIES).includes(strategy)) {
    throw new Error(`Unknown strategy: '${strategy}'!`);
  }

  const config = {
    requestUri,
    strategy,
    authInfo: {
      bearerToken
    }
  };

  const resourceName = parseResourceNameFromODataRequestUri(requestUri),
    shouldSaveResults = !!outputPath,
    resultsPath = shouldSaveResults
      ? `${outputPath}/reso-replication-output/${resourceName}-${new Date().toISOString().replaceAll(':', '-')}`
      : null;

  const startTime = Date.now(),
    responseTimes = [];

  let recordsFetched = 0,
    pagesFetched = 0;

  /*
    Availability map schema:

    {
      Property: {
        numRecordsFetched: 300
        fieldMap: {
          ListPrice: 234,
          Media: 123
        }
      }
    }
  */
  const resourceAvailabilityMap = {};

  try {
    for await (const data of replicationIterator(config)) {
      if (data?.hasResults) {
        responseTimes.push(data?.responseTimeMs ?? 0);
        recordsFetched = data?.recordsFetched ?? 0;

        if (data?.response?.value?.length) {
          // resourceAvailabilityMap is mutated here
          scorePayload(data.response.value, resourceAvailabilityMap, resourceName, expansions);

          if (shouldSaveResults) {
            await mkdir(resultsPath, { recursive: true });
            await writeFile(`${resultsPath}/page-${++pagesFetched}.json`, JSON.stringify(data.response));
          }
        }
      }

      if (!!limit && recordsFetched >= limit) {
        break;
      }
    }

    console.log(`\nReplication completed in ~${humanizeDuration(Date.now() - startTime, { round: true })}!`);
    console.log(
      `Total requests: ${responseTimes?.length}, Average response time: ${parseInt(
        responseTimes?.reduce((acc, item) => {
          if (item) {
            acc += item;
          }
          return acc;
        }, 0) / (responseTimes.length || 1)
      )}ms, Total records: ${recordsFetched}\n`
    );

    await writeDataAvailabilityReport(resourceName, resourceAvailabilityMap, recordsFetched);
  } catch (err) {
    console.error(err);
  }
  return;
};

module.exports = {
  replicate
};
