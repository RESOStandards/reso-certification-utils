'use strict';

const { readFile, writeFile } = require('fs/promises');
const { distance } = require('fastest-levenshtein');
const { getReferenceMetadata } = require('@reso/reso-certification-etl');
const { buildMetadataMap, getLoggers, CERTIFICATION_FILES, NOT_OK } = require('../../common');
const { DEFAULT_DD_VERSION } = require('../replication/utils');
const humanizeDuration = require('humanize-duration');
const { convertVariationsCsvToJson } = require('./utils');

const {
  REFERENCE_METADATA_URL,
  RESO_SERVICES_URL,
  CERT_AUTH_API_BASE_URL,
  CERT_AUTH_API_USERNAME,
  CURRENT_PROVIDER_UOI,
  CERTIFICATION_API_KEY
} = process.env;

const VARIATIONS_RESULTS_FILE = 'data-dictionary-variations.json';

const VARIATIONS_SERVICE_SEARCH_URL = `${RESO_SERVICES_URL}/certification/variations/search`,
  VARIATIONS_SERVICE_UPDATE_URL = `${RESO_SERVICES_URL}/certification/variations`;

const DEFAULT_FUZZINESS = 0.25,
  MIN_MATCHING_LENGTH = 3,
  CLOSE_MATCH_DISTANCE = 1;

const MATCHING_STRATEGIES = Object.freeze({
  SUBSTRING: 'Substring',
  EDIT_DISTANCE: 'Edit Distance',
  SUGGESTION: 'Suggestion',
  IGNORED: 'Ignored'
});

const MATCHED_ON = Object.freeze({
  LOOKUP_VALUE: 'lookupValue',
  LEGACY_ODATA_VALUE: 'legacyODataValue'
});

const checkRequiredCredentials = () => {
  const missingItems = [];

  if (!CERT_AUTH_API_BASE_URL) {
    missingItems.push('CERT_AUTH_API_BASE_URL');
  }

  if (!CERT_AUTH_API_USERNAME) {
    missingItems.push('CERT_AUTH_API_USERNAME');
  }

  if (!CERTIFICATION_API_KEY) {
    missingItems.push('CERTIFICATION_API_KEY');
  }

  return {
    hasMissingItems: !!missingItems?.length,
    missingItems
  };
};

/**
 * Prepares a metadata report so it can be searched easily
 * @param {params} elements of a metadata report
 * @returns a map of maps for each element
 */
const prepareResults = ({
  resources = [],
  fields = [],
  lookupValues = [],
  legacyODataValues = [],
  expansions = [],
  complexTypes = []
} = {}) => {
  return {
    resources:
      Object.values(
        resources.reduce((acc, { resourceName, ...suggestion }) => {
          if (!acc?.[resourceName]) {
            acc[resourceName] = {
              resourceName,
              suggestions: []
            };
          }

          acc[resourceName].suggestions.push(suggestion);

          return acc;
        }, {})
      ) || [],
    fields: Object.values(
      fields.reduce((acc, { resourceName, fieldName, ...suggestion }) => {
        if (!acc?.[resourceName]) {
          acc[resourceName] = {};
        }

        if (!acc?.[resourceName]?.[fieldName]) {
          acc[resourceName][fieldName] = {
            resourceName,
            fieldName,
            suggestions: []
          };
        }
        acc[resourceName][fieldName].suggestions.push(suggestion);

        return acc;
      }, {})
    ).flatMap(Object.values),
    lookups: Object.values(
      [...lookupValues, ...legacyODataValues].reduce((acc, { resourceName, fieldName, lookupValue, legacyODataValue, ...rest }) => {
        if (!acc?.[resourceName]) {
          acc[resourceName] = {};
        }

        if (!acc?.[resourceName]?.[fieldName]) {
          acc[resourceName][fieldName] = {};
        }

        const lookupKey = legacyODataValue + lookupValue;

        if (!acc?.[resourceName]?.[fieldName]?.[lookupKey]) {
          acc[resourceName][fieldName][lookupKey] = {
            resourceName,
            fieldName,
            legacyODataValue,
            lookupValue,
            suggestions: []
          };
        }

        if (
          !acc[resourceName][fieldName][lookupKey].suggestions.some(
            x => x?.suggestedLookupValue === rest?.suggestedLookupValue && x?.suggestedLegacyODataValue === rest?.suggestedLegacyODataValue
          )
        ) {
          acc[resourceName][fieldName][lookupKey].suggestions.push({ ...rest });
        }

        return acc;
      }, {})
    ).flatMap(item => Object.values(Object.values(item).flatMap(Object.values))),
    expansions,
    complexTypes
  };
};

/**
 * Trims whitespace and special characters from the given name
 *
 * @param {String} name - the name of the data element to process
 * @returns processed data element name, if possible, otherwise just returns the input
 */
const normalizeDataElementName = name => name?.toLowerCase()?.replace(/[^0-9a-z]/gi, '') || name;

/**
 * Fetches reference metadata
 * @param {String} version the version of the metadata report to fetch
 * @returns metadata-report.json for the given version
 */
const fetchReferenceMetadata = async (version = DEFAULT_DD_VERSION) => {
  try {
    const referenceMetadata = getReferenceMetadata(version);
    if (Object.keys(referenceMetadata)?.length) {
      return Object.freeze(referenceMetadata);
    }
  } catch (err) {
    try {
      return Object.freeze(await fetch(`${REFERENCE_METADATA_URL}?${new URLSearchParams({ version }).toString()}`).json());
    } catch (err2) {
      return null;
    }
  }
};

/**
 * Determines whether a URL string is valid
 * @param {String} url the string URL to test
 * @returns true if valid, false otherwise
 */
const isValidUrl = url => {
  try {
    new URL(url);
    return true;
  } catch (err) {
    return false;
  }
};

/**
 * Calculates the elapsed time from the given start time
 * @param {Date} startTime the time the event started
 * @returns elapsed time string
 * @todo Move to common
 */
const calculateElapsedTimeString = (startTime = new Date()) => humanizeDuration(Date.now() - startTime, { round: false });

/**
 * Gets metadata information for display
 * @param {Object} params metadata parts
 * @returns string showing how many items there are
 */
const getMetadataInfo = ({ numResources = 0, numFields = 0, numLookups = 0, numExpansions = 0, numComplexTypes = 0 } = {}) => {
  return `Resources: ${numResources}, Fields: ${numFields}, Lookups: ${numLookups}, Expansions: ${numExpansions}, Complex Types: ${numComplexTypes}`;
};

/**
 * Calculates variations based on algorithmic and human-provided mappings
 * @param {Object} params metadata report params such as fuzziness and version
 * @returns Data Dictionary variations report JSON
 */
const computeVariations = async ({
  metadataReportJson = {},
  fuzziness = DEFAULT_FUZZINESS,
  version = DEFAULT_DD_VERSION,
  fromCli = false,
  suggestionsMap = {}
} = {}) => {
  const POSSIBLE_VARIATIONS = {
    resources: [],
    fields: [],
    lookupValues: [],
    legacyODataValues: [],
    expansions: [],
    complexTypes: []
  };

  let startTime;

  try {
    //get latest version of reference metadata
    if (fromCli) {
      console.log('\nFetching reference metadata...');
      startTime = new Date();
    }

    const referenceMetadata = await fetchReferenceMetadata(version);
    if (fromCli) console.log(`Time Taken: ${calculateElapsedTimeString(startTime)}\n`);
    if (!referenceMetadata) return;

    //build a map of reference metadata
    if (fromCli) {
      console.log('\nBuilding references...');
      startTime = new Date();
    }

    const { metadataMap: standardMetadataMap = {}, stats: referenceMetadataStats = {} } = buildMetadataMap(referenceMetadata);

    const getDDWikiUrlForResourceName = resourceName => {
      if (!resourceName) return null;

      return getReferenceMetadata()?.resources?.find(item => item?.resourceName === resourceName)?.wikiPageURL ?? null;
    };

    const getDDWikiUrlForFieldName = (resourceName, fieldName) => {
      if (!(resourceName && fieldName)) return null;

      return standardMetadataMap?.[resourceName]?.[fieldName]?.ddWikiUrl ?? null;
    };

    const getDDWikiUrlForLookupValue = (resourceName, fieldName, lookupValue) => {
      if (!(resourceName && fieldName && lookupValue)) return null;

      return standardMetadataMap?.[resourceName]?.[fieldName]?.lookupValues?.[lookupValue]?.ddWikiUrl ?? null;
    };

    const getDDWikiUrlForODataLookupValue = (resourceName, fieldName, oDataLookupValue) => {
      if (!(resourceName && fieldName && oDataLookupValue)) return null;

      return standardMetadataMap?.[resourceName]?.[fieldName]?.legacyODataValues?.[oDataLookupValue]?.ddWikiUrl ?? null;
    };

    if (fromCli) {
      console.log('Metadata info:', getMetadataInfo(referenceMetadataStats));
      console.log(`Time taken: ${calculateElapsedTimeString(startTime, true)}`);

      console.log('\nProcessing Metadata Report...');
      startTime = new Date();
    }

    // create metadata map
    const { metadataMap: metadataReportMap = {}, stats: metadataReportStats = {} } = buildMetadataMap(metadataReportJson);

    if (fromCli) {
      console.log(`Time taken: ${calculateElapsedTimeString(startTime, true)}`);
      console.log('Metadata info:', getMetadataInfo(metadataReportStats));

      console.log('\nMatching process starting...');
      startTime = new Date();
    }

    // For each resource...
    Object.keys(metadataReportMap).forEach(resourceName => {
      const isStandardResource = !!standardMetadataMap?.[resourceName] ?? false;

      //check for resource variations if the resource name doesn't match the reference metadata exactly
      if (!isStandardResource) {
        const resourceNameSuggestions = suggestionsMap?.[resourceName]?.suggestions ?? [];

        if (resourceNameSuggestions?.length) {
          // for each suggestion, only use it if the suggested item isn't already there...
          const remainingSuggestions =
            resourceNameSuggestions.flatMap(({ suggestedResourceName, ...suggestion }) => {
              if (!metadataReportMap?.[suggestedResourceName]) {
                return [
                  {
                    resourceName,
                    suggestedResourceName,
                    strategy: MATCHING_STRATEGIES.SUGGESTION,
                    ddWikiUrl: getDDWikiUrlForResourceName(suggestedResourceName),
                    ...suggestion
                  }
                ];
              } else {
                return [];
              }
            }) ?? [];

          if (remainingSuggestions?.length) {
            POSSIBLE_VARIATIONS.resources.push(...remainingSuggestions);
          }
        } else {
          Object.keys(standardMetadataMap).forEach(standardResourceName => {
            const normalizedStandardResourceName = normalizeDataElementName(standardResourceName),
              normalizedResourceName = normalizeDataElementName(resourceName);

            const hasStandardResource = !!metadataReportMap?.[standardResourceName];

            if (!hasStandardResource) {
              const isMinMatchingLength = resourceName?.length > MIN_MATCHING_LENGTH,
                isExactMatch = !!(normalizedResourceName === normalizedStandardResourceName && resourceName !== standardResourceName),
                isSubstringMatch =
                  isMinMatchingLength &&
                  !!(
                    normalizedResourceName.includes(normalizedStandardResourceName) ||
                    normalizedStandardResourceName.includes(normalizedResourceName)
                  );

              if (isExactMatch || isSubstringMatch) {
                const suggestion = {
                  resourceName,
                  suggestedResourceName: standardResourceName,
                  strategy: MATCHING_STRATEGIES.SUBSTRING,
                  ddWikiUrl: getDDWikiUrlForResourceName(standardResourceName)
                };

                if (isExactMatch) {
                  suggestion.exactMatch = true;
                }

                POSSIBLE_VARIATIONS.resources.push(suggestion);
              } else if (isMinMatchingLength) {
                const d = distance(normalizedStandardResourceName, normalizedResourceName),
                  maxDistance = Math.floor(fuzziness * resourceName?.length);

                if (d <= maxDistance) {
                  const suggestion = {
                    resourceName,
                    suggestedResourceName: standardResourceName,
                    distance: d,
                    maxDistance,
                    strategy: MATCHING_STRATEGIES.EDIT_DISTANCE,
                    ddWikiUrl: getDDWikiUrlForResourceName(standardResourceName)
                  };

                  if (d <= CLOSE_MATCH_DISTANCE) {
                    suggestion.closeMatch = true;
                  }

                  POSSIBLE_VARIATIONS.resources.push(suggestion);
                }
              }
            }
          });
        }
      } else {
        //found standard resource - check field name variations
        Object.keys(metadataReportMap?.[resourceName] ?? {}).forEach(fieldName => {
          const isStandardField = !!standardMetadataMap?.[resourceName]?.[fieldName] ?? false;

          if (!isStandardField) {
            const localFieldNameSuggestions = suggestionsMap?.[resourceName]?.[fieldName]?.suggestions ?? [],
              hasLocalFieldNameSuggestions = (localFieldNameSuggestions && localFieldNameSuggestions?.length) ?? false;

            // try looking in suggestions map
            if (hasLocalFieldNameSuggestions) {
              // for each suggestion, only use it if the suggested item isn't already there...
              const remainingSuggestions =
                localFieldNameSuggestions.flatMap(({ suggestedResourceName, suggestedFieldName, ...suggestion }) => {
                  if (!metadataReportMap?.[suggestedResourceName]?.[suggestedFieldName]) {
                    return [
                      {
                        resourceName,
                        fieldName,
                        suggestedResourceName,
                        suggestedFieldName,
                        strategy: MATCHING_STRATEGIES.SUGGESTION,
                        ddWikiUrl: getDDWikiUrlForResourceName(suggestedResourceName),
                        ...suggestion
                      }
                    ];
                  } else {
                    return [];
                  }
                }) ?? [];

              if (remainingSuggestions?.length) {
                POSSIBLE_VARIATIONS.fields.push(...remainingSuggestions);
              }
            } else {
              const isExpansion = !!metadataReportMap?.[resourceName]?.[fieldName]?.isExpansion ?? false;

              if (!isExpansion) {
                //otherwise, field was not found in reference metadata - look for variations
                Object.keys(standardMetadataMap?.[resourceName] ?? {}).forEach(standardFieldName => {
                  const isStandardExpansion = !!standardMetadataMap?.[resourceName]?.[standardFieldName]?.isExpansion ?? false;

                  // skip standard expansions when searching for fields
                  if (!isStandardExpansion) {
                    //case-insensitive, no special characters
                    const normalizedFieldName = normalizeDataElementName(fieldName),
                      normalizedStandardFieldName = normalizeDataElementName(standardFieldName);

                    const isMinMatchingLength = fieldName?.length > MIN_MATCHING_LENGTH,
                      isExactMatch = !!(normalizedFieldName === normalizedStandardFieldName && fieldName !== standardFieldName),
                      hasStandardField = !!metadataReportMap?.[resourceName]?.[standardFieldName] ?? false,
                      isSubstringMatch =
                        isMinMatchingLength &&
                        !!(
                          normalizedStandardFieldName.includes(normalizedFieldName) ||
                          normalizedFieldName.includes(normalizedStandardFieldName)
                        );

                    if (!hasStandardField) {
                      //allow substring matching for anything greater than the minimum matching length
                      //unless the case-insensitive substring matches exactly
                      if (isSubstringMatch || isExactMatch) {
                        // Only add suggestion to the map if a local field with a similar name
                        // wasn't already present in standard form

                        const suggestion = {
                          resourceName,
                          fieldName,
                          suggestedFieldName: standardFieldName,
                          strategy: MATCHING_STRATEGIES.SUBSTRING,
                          ddWikiUrl: getDDWikiUrlForFieldName(resourceName, standardFieldName)
                        };

                        if (isExactMatch) {
                          suggestion.exactMatch = true;

                          // add any exact matches to the head of the list
                          POSSIBLE_VARIATIONS.fields.unshift(suggestion);
                        } else {
                          POSSIBLE_VARIATIONS.fields.push(suggestion);
                        }
                      } else if (isMinMatchingLength) {
                        // Use Edit Distance matching if a substring match wasn't found
                        // https://en.wikipedia.org/wiki/Edit_distance
                        // https://en.wikipedia.org/wiki/Levenshtein_distance
                        // https://github.com/ka-weihe/fastest-levenshtein
                        const d = distance(normalizedFieldName, normalizedStandardFieldName),
                          maxDistance = Math.floor(fuzziness * fieldName?.length);

                        if (d <= maxDistance) {
                          const suggestion = {
                            resourceName,
                            fieldName,
                            suggestedFieldName: standardFieldName,
                            distance: d,
                            maxDistance,
                            strategy: MATCHING_STRATEGIES.EDIT_DISTANCE,
                            ddWikiUrl: getDDWikiUrlForFieldName(resourceName, standardFieldName)
                          };

                          if (d <= CLOSE_MATCH_DISTANCE) {
                            suggestion.closeMatch = true;
                          }

                          POSSIBLE_VARIATIONS.fields.push(suggestion);
                        }
                      }
                    }
                  }
                });
              } else {
                // TODO
                // console.log(`TODO: Expansion found! Resource: '${resourceName}', Field: '${fieldName}'`);
              }
            }
          } else {
            //standard field - if lookup field then try and process the nested lookups
            const { lookupValues = {}, legacyODataValues = {} } = metadataReportMap?.[resourceName]?.[fieldName] || {};

            //check lookupValues
            Object.values(lookupValues ?? {}).forEach(({ lookupValue }) => {
              const standardLookupValues = standardMetadataMap?.[resourceName]?.[fieldName]?.lookupValues || {},
                isStandardLookupValue = !!standardLookupValues?.[lookupValue] ?? false;

              //if the lookupValue doesn't exist in the standard metadata map then try and find matches
              if (!isStandardLookupValue) {
                const localLookupValueSuggestions = suggestionsMap?.[resourceName]?.[fieldName]?.[lookupValue]?.suggestions ?? [],
                  hasLocalLookupValueSuggestions = (localLookupValueSuggestions && localLookupValueSuggestions?.length) ?? false;

                if (hasLocalLookupValueSuggestions) {
                  // for each suggestion, only use it if the suggested item isn't already there...
                  const remainingSuggestions =
                    localLookupValueSuggestions.flatMap(
                      ({ suggestedResourceName, suggestedFieldName, suggestedLookupValue, ...suggestion }) => {
                        if (!metadataReportMap?.[suggestedResourceName]?.[suggestedFieldName]?.lookupValues?.[suggestedLookupValue]) {
                          return [
                            {
                              resourceName,
                              fieldName,
                              lookupValue,
                              suggestedResourceName,
                              suggestedFieldName,
                              suggestedLookupValue,
                              strategy: MATCHING_STRATEGIES.SUGGESTION,
                              ddWikiUrl: getDDWikiUrlForLookupValue(suggestedResourceName, suggestedFieldName, suggestedLookupValue),
                              ...suggestion
                            }
                          ];
                        } else {
                          return [];
                        }
                      }
                    ) ?? [];

                  if (remainingSuggestions?.length) {
                    POSSIBLE_VARIATIONS.lookupValues.push(...remainingSuggestions);
                  }
                } else {
                  //look through the existing lookupValues to see if we can find matches
                  Object.keys(standardLookupValues).forEach(standardLookupValue => {
                    const normalizedLookupValue = normalizeDataElementName(lookupValue),
                      normalizedStandardLookupValue = normalizeDataElementName(standardLookupValue);

                    const isMinMatchingLength = lookupValue?.length > MIN_MATCHING_LENGTH,
                      isExactMatch = normalizedLookupValue === normalizedStandardLookupValue && lookupValue !== standardLookupValue,
                      hasStandardLookupValue =
                        !!metadataReportMap?.[resourceName]?.[fieldName]?.lookupValues?.[standardLookupValue] ?? false,
                      isSubstringMatch =
                        isMinMatchingLength &&
                        !!(
                          normalizedLookupValue.includes(normalizedStandardLookupValue) ||
                          normalizedStandardLookupValue.includes(normalizedLookupValue)
                        );

                    if (!hasStandardLookupValue) {
                      //first check case-insensitive substring matches
                      if (isExactMatch || isSubstringMatch) {
                        const suggestion = {
                          resourceName,
                          fieldName,
                          lookupValue,
                          suggestedLookupValue: standardLookupValue,
                          matchedOn: MATCHED_ON.LOOKUP_VALUE,
                          strategy: MATCHING_STRATEGIES.SUBSTRING,
                          ddWikiUrl: getDDWikiUrlForLookupValue(resourceName, fieldName, standardLookupValue)
                        };

                        if (isExactMatch) {
                          suggestion.exactMatch = true;

                          // add exact matches at the head of the list
                          POSSIBLE_VARIATIONS.lookupValues.unshift(suggestion);
                        } else {
                          POSSIBLE_VARIATIONS.lookupValues.push(suggestion);
                        }
                      } else if (isMinMatchingLength) {
                        const d = distance(normalizedLookupValue, normalizedStandardLookupValue),
                          maxDistance = Math.floor(fuzziness * lookupValue?.length);

                        if (!hasStandardLookupValue && d <= maxDistance) {
                          const suggestion = {
                            resourceName,
                            fieldName,
                            lookupValue,
                            distance: d,
                            maxDistance,
                            strategy: MATCHING_STRATEGIES.EDIT_DISTANCE
                          };

                          if (lookupValue !== standardLookupValue) {
                            suggestion.matchedOn = MATCHED_ON.LOOKUP_VALUE;
                            suggestion.suggestedLookupValue = standardLookupValue;
                            suggestion.ddWikiUrl = getDDWikiUrlForLookupValue(resourceName, fieldName, standardLookupValue);
                          }

                          if (d <= CLOSE_MATCH_DISTANCE) {
                            suggestion.closeMatch = true;
                          }

                          POSSIBLE_VARIATIONS.lookupValues.push(suggestion);
                        }
                      }
                    }
                  });
                }
              }
            });

            //check legacyODataValues
            Object.values(legacyODataValues ?? {}).forEach(({ legacyODataValue }) => {
              const standardLegacyODataValues = standardMetadataMap?.[resourceName]?.[fieldName]?.legacyODataValues || {},
                isStandardLegacyODataValue = standardLegacyODataValues?.[legacyODataValue] ?? false;

              if (!isStandardLegacyODataValue) {
                const localODataLookupValueSuggestions = suggestionsMap?.[resourceName]?.[fieldName]?.[legacyODataValue]?.suggestions ?? [],
                  hasLocalODataLookupValueSuggestions =
                    (localODataLookupValueSuggestions && localODataLookupValueSuggestions?.length) ?? false;

                if (hasLocalODataLookupValueSuggestions) {
                  // for each suggestion, only use it if the suggested item isn't already there...
                  const remainingSuggestions =
                    localODataLookupValueSuggestions.flatMap(
                      ({ suggestedResourceName, suggestedFieldName, suggestedLegacyODataValue, ...suggestion }) => {
                        if (!metadataReportMap?.[suggestedResourceName]?.[suggestedFieldName]?.lookupValues?.[suggestedLegacyODataValue]) {
                          return [
                            {
                              resourceName,
                              fieldName,
                              legacyODataValue,
                              suggestedResourceName,
                              suggestedFieldName,
                              suggestedLegacyODataValue,
                              strategy: MATCHING_STRATEGIES.SUGGESTION,
                              ddWikiUrl: getDDWikiUrlForLookupValue(suggestedResourceName, suggestedFieldName, suggestedLegacyODataValue),
                              ...suggestion
                            }
                          ];
                        } else {
                          return [];
                        }
                      }
                    ) ?? [];

                  if (remainingSuggestions?.length) {
                    POSSIBLE_VARIATIONS.legacyODataValues.push(...remainingSuggestions);
                  }
                } else {
                  Object.keys(standardLegacyODataValues).forEach(standardODataLookupValue => {
                    const normalizedODataValue = normalizeDataElementName(legacyODataValue),
                      normalizedStandardODataValue = normalizeDataElementName(standardODataLookupValue);

                    const isMinMatchingLength = legacyODataValue?.length > MIN_MATCHING_LENGTH,
                      isExactMatch = normalizedODataValue === normalizedStandardODataValue && legacyODataValue !== standardODataLookupValue,
                      hasStandardLegacyODataValue =
                        !!metadataReportMap?.[resourceName]?.[fieldName]?.legacyODataValues?.[standardODataLookupValue] ?? false,
                      isSubstringMatch =
                        isMinMatchingLength &&
                        !!(
                          normalizedODataValue.includes(normalizedStandardODataValue) ||
                          normalizedStandardODataValue.includes(normalizedODataValue)
                        );

                    if (!hasStandardLegacyODataValue) {
                      if (isExactMatch || isSubstringMatch) {
                        const suggestion = {
                          resourceName,
                          fieldName,
                          legacyODataValue,
                          suggestedLegacyODataValue: standardODataLookupValue,
                          matchedOn: MATCHED_ON.LEGACY_ODATA_VALUE,
                          strategy: MATCHING_STRATEGIES.SUBSTRING,
                          ddWikiUrl: getDDWikiUrlForODataLookupValue(resourceName, fieldName, standardODataLookupValue)
                        };

                        if (isExactMatch) {
                          suggestion.exactMatch = true;
                          POSSIBLE_VARIATIONS.legacyODataValues.unshift(suggestion);
                        } else {
                          POSSIBLE_VARIATIONS.legacyODataValues.push(suggestion);
                        }
                      } else if (isMinMatchingLength) {
                        const d = distance(legacyODataValue, standardODataLookupValue),
                          maxDistance = Math.round(fuzziness * legacyODataValue?.length);

                        if (d <= maxDistance) {
                          const suggestion = {
                            resourceName,
                            fieldName,
                            legacyODataValue,
                            distance: d,
                            maxDistance,
                            strategy: MATCHING_STRATEGIES.EDIT_DISTANCE
                          };

                          if (legacyODataValue !== standardODataLookupValue) {
                            suggestion.matchedOn = MATCHED_ON.LEGACY_ODATA_VALUE;
                            suggestion.suggestedLegacyODataValue = standardODataLookupValue;
                            suggestion.ddWikiUrl = getDDWikiUrlForODataLookupValue(resourceName, fieldName, standardODataLookupValue);
                          }

                          if (d <= CLOSE_MATCH_DISTANCE) {
                            suggestion.closeMatch = true;
                          }

                          POSSIBLE_VARIATIONS.legacyODataValues.push(suggestion);
                        }
                      }
                    }
                  });
                }
              }
            });
          }
        });
      }
    });

    if (fromCli) {
      console.log(`Time Taken: ${calculateElapsedTimeString(startTime)}`);
    }

    return {
      description: 'Data Dictionary Variations Report',
      version,
      generatedOn: new Date().toISOString(),
      fuzziness: parseFloat(fuzziness),
      variations: prepareResults(POSSIBLE_VARIATIONS)
    };
  } catch (err) {
    console.error(err);
    return { err: JSON.stringify(err) };
  }
};

/**
 * Finds potential variations for a given metadata report
 * @param {String} path
 * @throws Error if path is not a valid S3 or local path
 */
const findVariations = async ({
  pathToMetadataReportJson = '',
  fuzziness = DEFAULT_FUZZINESS,
  version = DEFAULT_DD_VERSION,
  useSuggestions = true,
  fromCli = false
} = {}) => {
  // custom logger
  const { LOG, LOG_ERROR } = getLoggers(fromCli);

  LOG('\n\nRunning Variations Check...');

  if (!pathToMetadataReportJson?.length) {
    LOG_ERROR(`Invalid value! pathToMetadataReportJson = '${pathToMetadataReportJson}'`);
    return;
  }

  if (fuzziness < 0 || fuzziness > 1) {
    LOG_ERROR('Invalid value! fuzziness must be a decimal number in the range [0, 1]');
    return;
  }

  LOG(`Using fuzziness of up to ${Math.round(fuzziness * 100)}% of word length!\n`);

  const START_TIME = new Date();

  try {
    const metadataReportJson = JSON.parse(await readFile(pathToMetadataReportJson, { encoding: 'utf8' }));
    LOG(`Using metadata report: ${pathToMetadataReportJson}`);

    const args = {
      metadataReportJson,
      fuzziness,
      version
    };

    if (useSuggestions && !checkRequiredCredentials()?.hasMissingItems) {
      LOG('Fetching suggestions...');
      const mappings = (await fetchSuggestions(metadataReportJson)) ?? {};
      args.suggestionsMap = mappings ?? {};
      LOG('Done');
    } else {
      LOG('Skipping external suggestions...');
    }

    const report = await computeVariations(args);

    await writeFile(CERTIFICATION_FILES.VARIATIONS_REPORT, Buffer.from(JSON.stringify(report, null, 2)));
    LOG(`Results saved to '${VARIATIONS_RESULTS_FILE}'`);

    LOG(
      [
        '\nResults:',
        `  • Suggested Resources: ${report?.variations?.resources?.length ?? 0}`,
        `  • Suggested Fields: ${report?.variations?.fields?.length ?? 0}`,
        `  • Suggested Lookups: ${report?.variations?.lookups.length ?? 0}`,
        `  • Suggested Expansions: ${report?.variations?.expansions?.length ?? 0}`,
        `  • Suggested Complex Types: ${report?.variations?.complexTypes?.length ?? 0}`,
        '\nProcessing complete!\n',
        `Total runtime: ${calculateElapsedTimeString(START_TIME)}\n`
      ].join('\n')
    );

    return report;
  } catch (err) {
    LOG_ERROR(`\nError in 'findVariations'!\n${err?.message}`);
    if (err?.stack) {
      LOG_ERROR(`\nStacktrace: \n${err.stack}`);
    }
  }

  return null;
};

/**
 * Fetches a provider token with the given environment information
 */
const fetchProviderToken = async () => {
  const CERTIFICATION_AUTH_URL = `${CERT_AUTH_API_BASE_URL}/${CURRENT_PROVIDER_UOI}?username=${CERT_AUTH_API_USERNAME}`;

  try {
    const response = await fetch(CERTIFICATION_AUTH_URL, {
      headers: {
        Authorization: `ApiKey ${CERTIFICATION_API_KEY}`
      },
      method: 'POST'
    });
    return await response.json();
  } catch (err) {
    console.error(`Could not fetch provider token from Cert API! CERTIFICATION_AUTH_URL: ${CERTIFICATION_AUTH_URL}`);
    return {};
  }
};

/**
 * Fetches suggestions from the variations service
 * @returns Map of suggestions
 */
const fetchSuggestions = async ({ fields = [], lookups = [] } = {}) => {
  if (!Array.isArray(fields) || !Array.isArray(lookups) || !(fields?.length && lookups?.length)) {
    return {};
  }

  try {
    const { token } = await fetchProviderToken();

    if (!token) {
      return {};
    }

    const response = await fetch(VARIATIONS_SERVICE_SEARCH_URL, {
      headers: {
        Authorization: `Bearer ${token}`
      },
      method: 'POST',
      body: JSON.stringify({ fields, lookups })
    });
    return await response.json();
  } catch (err) {
    console.error(err);
    return {};
  }
};

/**
 * Updates the Variations Service with CSV items
 * @param {Object} params path to CSV suggestions
 * @returns
 */
const updateVariations = async ({ pathToCsvSuggestions, fromCli = false }) => {
  try {
    const csvData = (await readFile(pathToCsvSuggestions)).toString();
    const jsonData = convertVariationsCsvToJson(csvData);

    const { token } = await fetchProviderToken();

    if (!token) {
      console.error('Could not fetch token from Cert API!');
      return;
    }

    const response = await fetch(VARIATIONS_SERVICE_UPDATE_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(jsonData)
    });

    if (response.ok) {
      const stats = await response.json();

      if (fromCli) {
        console.log('\nUpdated item stats:\n');

        if (stats && Object.keys(stats)?.length) {
          Object.entries(stats).forEach(([key, value]) => {
            if (key) {
              console.log(`  • ${key}: ${value}`);
            }
          });
        }
      }
      console.log('\n');
    } else {
      console.error('ERROR: No stats available!');
      process.exit(NOT_OK);
    }
  } catch (err) {
    console.error(`Could not update Variations Service! Error: ${err}`);
    process.exit(NOT_OK);
  }
};

module.exports = {
  findVariations,
  computeVariations,
  updateVariations,
  isValidUrl,
  DEFAULT_FUZZINESS
};
