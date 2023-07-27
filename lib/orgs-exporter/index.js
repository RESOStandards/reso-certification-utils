'use strict';

const { fetchOrgsAndEndorsements, computeEndorsementStats } = require('./data-access');
const { writeDataToS3 } = require('./utils');

const ORG_RESULTS_BUCKET_NAME = 'reso-public',
  ORG_RESULTS_FILE_NAME = 'OrgsAndEndorsements.json';

exports.handler = async event => {
  try {
    const data = await fetchOrgsAndEndorsements();
    const stats = await computeEndorsementStats(data);

    const serializedData = JSON.stringify({
      Description: 'RESO Organizations and Endorsements',
      GeneratedOn: new Date().toISOString(),
      Stats: stats,
      Data: data
    });

    await writeDataToS3({
      bucketName: ORG_RESULTS_BUCKET_NAME,
      fileName: ORG_RESULTS_FILE_NAME,
      serializedData
    });

    return {
      statusCode: 200,
      body: { orgCount: data?.length }
    };
  } catch (err) {
    console.error(`ERROR: ${err}, event: ${event}`);
    return {
      statusCode: 400,
      body: JSON.stringify('ERROR fetching endorsements!')
    };
  }
};
