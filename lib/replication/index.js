'use strict';

const { replicationIterator, REPLICATION_STRATEGIES } = require('./replication-iterator');
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

  const startTime = Date.now();

  for await (const data of replicationIterator(config)) {
    if (data?.hasResults) {
      console.log('Data fetched!');
    }
  }

  console.log(`\nReplication completed in ${humanizeDuration(Date.now() - startTime)}!`);
  return;
};

module.exports = {
  replicate
};
