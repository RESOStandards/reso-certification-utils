//TODO: add CLI handlers for these
// const { processDataDictionaryResults } = require('./restore-utils/postResultsToApi.js');
// const { processDataAvailabilityReport } = require('./etl/processDataAvailabilityReport.js');


//parse command line args
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const argv = yargs(hideBin(process.argv)).argv;

// TODO
!!argv;  //silence eslint until finished
// const { runTests, processDDResult, dataAvailabilityEtl } = argv;
// if (runTests)) {
//   const { configFilePath } = argv;
//   if (!configFilePath) console.log('configFilePath is required!\nUsage: $ node . --runTests');
//
// } else if (processDDResult) {
//  
// } else if (dataAvailabilityEtl) {
//
// } else {
//
// }
