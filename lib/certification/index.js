'use strict';

const { runDDTests, DEFAULT_LIMIT } = require('./data-dictionary');
const { runUpiTests } = require('./upi');

module.exports = {
  runDDTests,
  DEFAULT_LIMIT,
  runUpiTests
};
