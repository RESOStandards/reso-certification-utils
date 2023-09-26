'use strict';

const { replicationIterator, REPLICATION_STRATEGIES } = require('./replication-iterator');
const { scorePayload, writeDataAvailabilityReport } = require('./utils');
const humanizeDuration = require('humanize-duration');

const replicate = async ({ url: requestUri, strategy, bearerToken, expansions }) => {
  if (!Object.values(REPLICATION_STRATEGIES).includes(strategy)) {
    throw new Error(`Unknown strategy: '${strategy}'!`);
  }

  const config = {
    requestUri,
    strategy: strategy,
    authInfo: {
      bearerToken
    },
    expansions
  };

  const startTime = Date.now(),
    responseTimes = [];

  let recordsFetched = 0,
    availabilityMap = {};

  for await (const data of replicationIterator(config)) {
    if (data?.hasResults) {
      console.log('Data fetched!');
      responseTimes.push(data?.responseTimeMs ?? 0);
      recordsFetched = data?.recordsFetched ?? 0;

      if (data?.response?.value?.length) {
        availabilityMap = scorePayload(data.response.value, availabilityMap);
      }
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
      }, 0) / responseTimes.length
    )}ms, Total records: ${recordsFetched}\n`
  );

  await writeDataAvailabilityReport(availabilityMap, recordsFetched);
  return;
};

module.exports = {
  replicate
};
