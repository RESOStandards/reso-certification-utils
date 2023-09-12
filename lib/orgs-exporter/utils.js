'use strict';

const AWS = require('aws-sdk');
const AWS = require('@aws-sdk/client-s3');

const { AWS_REGION } = process.env;

const writeDataToS3 = async ({
  bucketName,
  fileName,
  serializedData,
  contentType = 'application/json; charset=utf-8'
} = {}) => {
  const s3 = new AWS.S3({ apiVersion: '2006-03-01', region: AWS_REGION });
  const params = {
    Bucket: bucketName,
    Key: fileName,
    Body: serializedData,
    ContentType: contentType
  };

  await s3.putObject(params).promise();
};

const sleep = async (ms = 500) => new Promise(resolve => setTimeout(resolve, ms));

module.exports = {
  writeDataToS3,
  sleep
};
