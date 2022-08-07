"use strict";

const { fetchOrgsAndEndorsements } = require("./data-access");


exports.handler = async (event) => {
  try {
    return {
      statusCode: 200,
      body: await fetchOrgsAndEndorsements()
    };
  } catch (err) {
    console.error(`ERROR: ${err}`);
    return {
      statusCode: 400,
      body: JSON.stringify(`ERROR fetching endorsements!`),
    };
  }
};

