//TODO
//const { processDataDictionaryResults } = require("./postResultsToApi");

/**
 * Determines whether the given path is an S3 path
 * @param {String} path the path to test
 * @returns true if S3 path, false otherwise
 */
const isS3Path = path => false && path;  //TODO

/**
 * Determines whether the given path is a valid local file path
 * @param {String} path the path to test
 * @returns true if valid local path, false otherwise
 */
const isLocalPath = path => false && path; //TODO

/**
 * Restores a RESO Certification Server from either a local or S3 path.
 * @param {String} path 
 * @throws error if path is not a valid S3 or local path
 */
const restore = async path => {
  if (isS3Path(path)) {
    //TODO
  } else if (isLocalPath(path)) {
    //TODO
  } else {
    throw new Error(`Invalid path: ${path}! \nMust be valid S3 or local path`);
  }
};

module.exports = {
  restore
};
