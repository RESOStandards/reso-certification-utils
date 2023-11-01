'use strict';

const { buildMetadataMap } = require('../../../common');

/**
 * Resource availability map has a structure of resourceName, fieldName, lookups, lookupValue
 */
const _resourceAvailabilityMap = {};

/**
 * Used to detect whether we've pulled the same record using different strategies
 * Format is recordHash: count
 */
const _recordHashCountMap = {};

/**
 * Tracks page responses
 */
const _responses = [];

/**
 * Tracks how many pages were fetched per resource
 */
const _resourcePageCounts = {};

/**
 * Metadata map used for lookups on a given metadata report
 */
let _metadataMap = {};


/**
 * Initializes the singleton replication state service
 */
const init = () => {
  // TODO: add some init steps, if needed
};

/**
 * Resource availability map accessor
 * @returns current instance
 */
const getResourceAvailabilityMap = () => _resourceAvailabilityMap;

/**
 * Record hash count map accessor
 * @returns current instance
 */
const getRecordCountHashMap = () => _recordHashCountMap;

/**
 * Responses accessor
 * @returns array of responses 
 */
const getResponses = () => _responses;

/**
 * Gets the resource count
 * @param {String} resourceName name of resource to get count for
 * @returns current record count
 */
const getResourcePageCount = resourceName => _resourcePageCounts?.[resourceName];

/**
 * Increments current record count for the given resource
 * @param {String} resourceName name of the resource to increment the count for
 */
const incrementResourcePageCount = resourceName => {
  if (!_resourcePageCounts?.[resourceName]) {
    _resourcePageCounts[resourceName] = 0;
  }

  _resourcePageCounts[resourceName]++;
};

/**
 * Metadata map accessor
 * @returns current metadata map
 */
const getMetadataMap = () => _metadataMap;

/**
 * Creates a local metadata map from the given metadata report JSON
 * @param {Object} metadataReportJson JSON metadata report (fields, lookups) to build the metadata map from
 */
const setMetadataMap = (metadataReportJson = {}) => {
  const { metadataMap } = buildMetadataMap(metadataReportJson);
  _metadataMap = metadataMap;
};

module.exports = {
  init,
  getResourceAvailabilityMap,
  getRecordCountHashMap,
  getResponses,
  getResourcePageCount,
  incrementResourcePageCount,
  getMetadataMap,
  setMetadataMap
};
