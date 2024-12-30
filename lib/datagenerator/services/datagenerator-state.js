'use strict';

const { buildMetadataMap } = require('../../../common');
const { extendMetadataMap } = require('../utils');

/**
 * Stores metadata map for resources, fields and lookups
 */
let _metadataMap = {};

/**
 * Map of total count of generated entities for each resource
 */
let _entityCounts = {};

/**
 * Map of recently generated entities for each resource (for use in expansions)
 */
let _recentlyGeneratedEntities = {};

/**
 * Local state variable to track whether the service is initialized
 */
let _isInitialized = false;

/**
 * Accessor for initialization state
 * @returns {boolean} true if the service has been initialized, false otherwise
 */
const getIsInitialized = () => _isInitialized;

/**
 * Initializes the singleton data generator state service
 * @param {Object} metadataReportJson Metadata report including field and lookup definitions
 */
const init = metadataReportJson => {
  if (_isInitialized) {
    return;
  }

  if (!metadataReportJson || !metadataReportJson.fields || !metadataReportJson.lookups) {
    throw new Error('Invalid metadataReportJson provided to datagenerator-state init.');
  }

  const { metadataMap: baseMetadataMap } = buildMetadataMap(metadataReportJson);

  const extendedMetadataMap = extendMetadataMap(baseMetadataMap);
  _metadataMap = { metadataMap: extendedMetadataMap };
  _isInitialized = true;

  // Clear out existing entity tracking
  _recentlyGeneratedEntities = {};
  _entityCounts = {};
};

/**
 * Metadata map accessor
 * @returns current metadata map
 */
const getMetadataMap = () => _metadataMap;

/**
 * tracks generated entities
 * @param {String} resourceName
 * @param {Array} entities
 */
const trackGeneratedEntities = (resourceName, entities) => {
  if (!resourceName || !entities || !Array.isArray(entities)) {
    throw new Error('Invalid arguments provided to trackGeneratedEntities.');
  }

  if (!_recentlyGeneratedEntities[resourceName]) {
    _recentlyGeneratedEntities[resourceName] = [];
  }

  _recentlyGeneratedEntities[resourceName].push(...entities);

  if (!_entityCounts[resourceName]) {
    _entityCounts[resourceName] = 0;
  }
  _entityCounts[resourceName] += entities.length;

  // Save memory space by keeping 1000 newest entities
  const MAX_ENTITIES = 1000;
  if (_recentlyGeneratedEntities[resourceName].length > MAX_ENTITIES) {
    _recentlyGeneratedEntities[resourceName] = _recentlyGeneratedEntities[resourceName].slice(-MAX_ENTITIES);
  }
};

/**
 * Get count of total entities generated for resource
 * @param {String} resourceName
 * @returns {Number} entity count
 */
const getEntityCount = resourceName => {
  return _entityCounts[resourceName] || 0;
};

/**
 * Accessor for tracked entities
 * @param {String} resourceName
 * @returns {Array} Tracked entities array
 */
const getTrackedEntities = resourceName => {
  return _recentlyGeneratedEntities[resourceName] || [];
};

/**
 * Resets the state service, TODO: remove if not needed
 */
const reset = () => {
  _metadataMap = {};
  _recentlyGeneratedEntities = {};
  _entityCounts = {};
  _isInitialized = false;
};

module.exports = {
  init,
  getIsInitialized,
  getMetadataMap,
  trackGeneratedEntities,
  getEntityCount,
  getTrackedEntities,
  reset
};
