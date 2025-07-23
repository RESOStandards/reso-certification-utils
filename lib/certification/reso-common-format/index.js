'use strict';

const runRcfTests = async ({ /* pathToRcfResults = null, allowAdditionalElements = false */ } = {}) => {

  // 1. If pathToResults is S3, load from there. Otherwise load from local path

  // 2. Process RCF files with schema validation

  // 3. Generate data availability report

  // 4. Generate metadata report 

  // 5. Run variations check - if it fails, post to Cert API with failed status and variations report

  // 6. If variations check passes, save metadata and availability reports to S3, then push to Cert API
  
  // 7. For any path that is from S3, delete the raw data from S3 after the request is finished, 
  // whether it completed successfully or not

};

module.exports = {
  runRcfTests
};
