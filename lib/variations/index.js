'use strict';

const { readFile, writeFile } = require('fs/promises');
const { distance } = require('fastest-levenshtein');
const { getReferenceMetadata } = require('@reso/reso-certification-etl');
const { buildMetadataMap, getLoggers, isValidUrl, CERTIFICATION_FILES, NOT_OK } = require('../../common');
const { DEFAULT_DD_VERSION } = require('../replication/utils');
const humanizeDuration = require('humanize-duration');
const { convertVariationsCsvToJson } = require('./utils');
const { readFileSync, writeFileSync } = require('fs');
const { inflateSync } = require('node:zlib');

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
  ADMIN_REVIEW: 'Admin Review',
  FAST_TRACK: 'Fast Track',
  EXTERNAL_SUGGESTION: 'Suggestion'
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
  } catch {
    try {
      return Object.freeze(await fetch(`${REFERENCE_METADATA_URL}?${new URLSearchParams({ version }).toString()}`).json());
    } catch {
      return null;
    }
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
 * Gets the DD Wiki URL for the given Data Dictionary element
 * @param {*} options must have a standardMetadataMap and the resource or field name and lookup value or odata value
 * @returns DD Wiki URL or null if it wasn't found
 */
const getDDWikiUrl = ({ standardMetadataMap, resourceName, fieldName, lookupValue, oDataLookupValue }) => {
  if (!standardMetadataMap || !Object.values(standardMetadataMap)?.length) {
    return null;
  }

  if (resourceName && fieldName && lookupValue) {
    return standardMetadataMap?.[resourceName]?.[fieldName]?.lookupValues?.[lookupValue]?.ddWikiUrl ?? null;
  } else if (resourceName && fieldName && oDataLookupValue) {
    return standardMetadataMap?.[resourceName]?.[fieldName]?.legacyODataValues?.[oDataLookupValue]?.ddWikiUrl ?? null;
  } else if (resourceName && fieldName) {
    return standardMetadataMap?.[resourceName]?.[fieldName]?.ddWikiUrl ?? null;
  } else if (resourceName) {
    return getReferenceMetadata()?.resources?.find(item => item?.resourceName === resourceName)?.wikiPageURL ?? null;
  } else {
    return null;
  }
};

/**
 * Determines which kind of matching strategy was used for the given suggestion data
 * @param {*} suggestionData contains various flags from a given suggestion
 * @returns the appropriate matching strategy
 */
const classifySuggestionStrategy = ({ isAdminReview = false, isFastTrack = false } = {}) => {
  if (isAdminReview) {
    return MATCHING_STRATEGIES.ADMIN_REVIEW;
  } else if (isFastTrack) {
    return MATCHING_STRATEGIES.FAST_TRACK;
  } else {
    return MATCHING_STRATEGIES.EXTERNAL_SUGGESTION;
  }
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

    // Process each resource in the metadata
    Object.keys(metadataReportMap).forEach(resourceName => {
      const isStandardResource = !!standardMetadataMap?.[resourceName] ?? false;
      const { ignored: ignoreResourceMapping = false, suggestions: resourceSuggestions = [] } = suggestionsMap?.[resourceName] ?? {};

      if (!ignoreResourceMapping) {
        if (resourceSuggestions?.length) {
          //check for human-based suggestions first
          POSSIBLE_VARIATIONS.resources.push(
            ...(resourceSuggestions.flatMap(({ suggestedResourceName, isAdminReview, isFastTrack, ...suggestion }) => {
              if (!metadataReportMap?.[suggestedResourceName]) {
                return [
                  {
                    resourceName,
                    suggestedResourceName,
                    strategy: classifySuggestionStrategy({ isAdminReview, isFastTrack }),
                    ddWikiUrl: getDDWikiUrl({ standardMetadataMap, resourceName: suggestedResourceName }),
                    ...suggestion
                  }
                ];
              } else {
                return [];
              }
            }) ?? [])
          );
        } else if (!isStandardResource) {
          //use machine techniques
          Object.keys(standardMetadataMap).forEach(standardResourceName => {
            const normalizedStandardResourceName = normalizeDataElementName(standardResourceName),
              normalizedResourceName = normalizeDataElementName(resourceName);

            const hasStandardResource = !!metadataReportMap?.[standardResourceName];

            if (!hasStandardResource) {
              const isMinMatchingLength = resourceName?.length > MIN_MATCHING_LENGTH;
              const isExactMatch = !!(resourceName !== standardResourceName && normalizedResourceName === normalizedStandardResourceName);

              const isSubstringMatch = !!(
                isMinMatchingLength &&
                ((normalizedStandardResourceName?.length > MIN_MATCHING_LENGTH &&
                  normalizedResourceName.includes(normalizedStandardResourceName)) ||
                  (normalizedResourceName?.length > MIN_MATCHING_LENGTH && normalizedStandardResourceName.includes(normalizedResourceName)))
              );

              if (isExactMatch || isSubstringMatch) {
                const suggestion = {
                  resourceName,
                  suggestedResourceName: standardResourceName,
                  strategy: MATCHING_STRATEGIES.SUBSTRING,
                  ddWikiUrl: getDDWikiUrl({ standardMetadataMap, resourceName: standardResourceName })
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
                    ddWikiUrl: getDDWikiUrl({ standardMetadataMap, resourceName: standardResourceName })
                  };

                  if (d <= CLOSE_MATCH_DISTANCE) {
                    suggestion.closeMatch = true;
                  }

                  POSSIBLE_VARIATIONS.resources.push(suggestion);
                }
              }
            }
          });
        } else {
          //found standard resource - check field name variations
          Object.keys(metadataReportMap?.[resourceName] ?? {}).forEach(fieldName => {
            const isStandardField = !!standardMetadataMap?.[resourceName]?.[fieldName] ?? false;
            const { ignored: ignoreFieldMapping = false, suggestions: fieldSuggestions = [] } =
              suggestionsMap?.[resourceName]?.[fieldName] ?? {};

            if (!ignoreFieldMapping) {
              if (fieldSuggestions?.length) {
                POSSIBLE_VARIATIONS.fields.push(
                  ...(fieldSuggestions.flatMap(
                    ({ suggestedResourceName, suggestedFieldName, isAdminReview, isFastTrack, ...suggestion }) => {
                      if (!metadataReportMap?.[suggestedResourceName]?.[suggestedFieldName]) {
                        return [
                          {
                            resourceName,
                            fieldName,
                            suggestedResourceName,
                            suggestedFieldName,
                            strategy: classifySuggestionStrategy({ isAdminReview, isFastTrack }),
                            ddWikiUrl: getDDWikiUrl({
                              standardMetadataMap,
                              resourceName: suggestedResourceName,
                              fieldName: suggestedFieldName
                            }),
                            ...suggestion
                          }
                        ];
                      } else {
                        return [];
                      }
                    }
                  ) ?? [])
                );
              } else if (!isStandardField) {
                // use machine matching
                const isExpansion = !!metadataReportMap?.[resourceName]?.[fieldName]?.isExpansion ?? false;

                if (!isExpansion) {
                  //otherwise, field was not found in reference metadata - look for variations
                  Object.keys(standardMetadataMap?.[resourceName] ?? {}).forEach(standardFieldName => {
                    const isStandardExpansion = !!standardMetadataMap?.[resourceName]?.[standardFieldName]?.isExpansion ?? false;

                    // skip standard expansions when searching for fields
                    if (!isStandardExpansion) {
                      //case-insensitive, no special characters
                      const normalizedFieldName = normalizeDataElementName(fieldName);
                      const normalizedStandardFieldName = normalizeDataElementName(standardFieldName);

                      const isMinMatchingLength = fieldName?.length > MIN_MATCHING_LENGTH;
                      const isExactMatch = !!(normalizedFieldName === normalizedStandardFieldName && fieldName !== standardFieldName);
                      const hasStandardField = !!metadataReportMap?.[resourceName]?.[standardFieldName] ?? false;

                      const isSubstringMatch = !!(
                        isMinMatchingLength &&
                        ((normalizedFieldName?.length > MIN_MATCHING_LENGTH && normalizedStandardFieldName.includes(normalizedFieldName)) ||
                          (normalizedStandardFieldName?.length > MIN_MATCHING_LENGTH &&
                            normalizedFieldName.includes(normalizedStandardFieldName)))
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
                            ddWikiUrl: getDDWikiUrl({ standardMetadataMap, resourceName, fieldName: standardFieldName })
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
                              ddWikiUrl: getDDWikiUrl({ standardMetadataMap, resourceName, fieldName: standardFieldName })
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
              } else {
                // found standard field - if lookup field then try and process the nested lookups
                const { lookupValues = {}, legacyODataValues = {} } = metadataReportMap?.[resourceName]?.[fieldName] || {};

                //check lookupValues
                Object.values(lookupValues ?? {}).forEach(({ lookupValue }) => {
                  const standardLookupValues = standardMetadataMap?.[resourceName]?.[fieldName]?.lookupValues || {},
                    isStandardLookupValue = !!standardLookupValues?.[lookupValue] ?? false;

                  const { ignored: ignoreLookupValueMapping = false, suggestions: lookupValueSuggestions = [] } =
                    suggestionsMap?.[resourceName]?.[fieldName]?.[lookupValue] ?? {};

                  if (!ignoreLookupValueMapping) {
                    if (lookupValueSuggestions?.length) {
                      POSSIBLE_VARIATIONS.lookupValues.push(
                        ...(lookupValueSuggestions.flatMap(
                          ({
                            suggestedResourceName,
                            suggestedFieldName,
                            suggestedLookupValue,
                            isAdminReview,
                            isFastTrack,
                            ...suggestion
                          }) => {
                            if (!metadataReportMap?.[suggestedResourceName]?.[suggestedFieldName]?.lookupValues?.[suggestedLookupValue]) {
                              return [
                                {
                                  resourceName,
                                  fieldName,
                                  lookupValue,
                                  suggestedResourceName,
                                  suggestedFieldName,
                                  suggestedLookupValue,
                                  strategy: classifySuggestionStrategy({ isAdminReview, isFastTrack }),
                                  ddWikiUrl: getDDWikiUrl({
                                    standardMetadataMap,
                                    resourceName: suggestedResourceName,
                                    fieldName: suggestedFieldName,
                                    lookupValue: suggestedLookupValue
                                  }),
                                  ...suggestion
                                }
                              ];
                            } else {
                              return [];
                            }
                          }
                        ) ?? [])
                      );
                    } else if (!isStandardLookupValue) {
                      // use machine matching techniques
                      Object.keys(standardLookupValues).forEach(standardLookupValue => {
                        const normalizedLookupValue = normalizeDataElementName(lookupValue);
                        const normalizedStandardLookupValue = normalizeDataElementName(standardLookupValue);

                        const isMinMatchingLength = lookupValue?.length > MIN_MATCHING_LENGTH;
                        const isExactMatch = !!(
                          lookupValue !== standardLookupValue && normalizedLookupValue === normalizedStandardLookupValue
                        );
                        const hasStandardLookupValue =
                          !!metadataReportMap?.[resourceName]?.[fieldName]?.lookupValues?.[standardLookupValue] ?? false;

                        const isSubstringMatch = !!(
                          isMinMatchingLength &&
                          ((normalizedStandardLookupValue?.length > MIN_MATCHING_LENGTH &&
                            normalizedLookupValue.includes(normalizedStandardLookupValue)) ||
                            (normalizedLookupValue?.length > MIN_MATCHING_LENGTH &&
                              normalizedStandardLookupValue.includes(normalizedLookupValue)))
                        );

                        if (!hasStandardLookupValue) {
                          //first check case-insensitive substring matches
                          if (isExactMatch || isSubstringMatch) {
                            const suggestion = {
                              resourceName,
                              fieldName,
                              lookupValue,
                              suggestedLookupValue: standardLookupValue,
                              strategy: MATCHING_STRATEGIES.SUBSTRING,
                              ddWikiUrl: getDDWikiUrl({ standardMetadataMap, resourceName, fieldName, lookupValue: standardLookupValue })
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
                                suggestion.suggestedLookupValue = standardLookupValue;
                                suggestion.ddWikiUrl = getDDWikiUrl({
                                  standardMetadataMap,
                                  resourceName,
                                  fieldName,
                                  lookupValue: standardLookupValue
                                });
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

                  const { ignored: ignoreLegacyODataValueMapping = false, suggestions: legacyODataValueSuggestions = [] } =
                    suggestionsMap?.[resourceName]?.[fieldName]?.[legacyODataValue] ?? {};

                  if (!ignoreLegacyODataValueMapping) {
                    if (legacyODataValueSuggestions?.length) {
                      POSSIBLE_VARIATIONS.legacyODataValues.push(
                        ...(legacyODataValueSuggestions.flatMap(
                          ({
                            suggestedResourceName,
                            suggestedFieldName,
                            suggestedLegacyODataValue,
                            isAdminReview,
                            isFastTrack,
                            ...suggestion
                          }) => {
                            if (
                              !metadataReportMap?.[suggestedResourceName]?.[suggestedFieldName]?.lookupValues?.[suggestedLegacyODataValue]
                            ) {
                              return [
                                {
                                  resourceName,
                                  fieldName,
                                  legacyODataValue,
                                  suggestedResourceName,
                                  suggestedFieldName,
                                  suggestedLegacyODataValue,
                                  strategy: classifySuggestionStrategy({ isAdminReview, isFastTrack }),
                                  ddWikiUrl: getDDWikiUrl({
                                    standardMetadataMap,
                                    resourceName: suggestedResourceName,
                                    fieldName: suggestedFieldName,
                                    lookupValue: suggestedLegacyODataValue
                                  }),
                                  ...suggestion
                                }
                              ];
                            } else {
                              return [];
                            }
                          }
                        ) ?? [])
                      );
                    } else if (!isStandardLegacyODataValue) {
                      // use machine matching techniques
                      Object.keys(standardLegacyODataValues).forEach(standardODataLookupValue => {
                        const normalizedODataValue = normalizeDataElementName(legacyODataValue);
                        const normalizedStandardODataValue = normalizeDataElementName(standardODataLookupValue);

                        const isMinMatchingLength = legacyODataValue?.length > MIN_MATCHING_LENGTH;
                        const isExactMatch = !!(
                          normalizedODataValue === normalizedStandardODataValue && legacyODataValue !== standardODataLookupValue
                        );

                        const hasStandardLegacyODataValue =
                          !!metadataReportMap?.[resourceName]?.[fieldName]?.legacyODataValues?.[standardODataLookupValue] ?? false;

                        const isSubstringMatch = !!(
                          isMinMatchingLength &&
                          ((normalizedStandardODataValue?.length > MIN_MATCHING_LENGTH &&
                            normalizedODataValue.includes(normalizedStandardODataValue)) ||
                            (normalizedODataValue?.length > MIN_MATCHING_LENGTH &&
                              normalizedStandardODataValue.includes(normalizedODataValue)))
                        );

                        if (!hasStandardLegacyODataValue) {
                          if (isExactMatch || isSubstringMatch) {
                            const suggestion = {
                              resourceName,
                              fieldName,
                              legacyODataValue,
                              suggestedLegacyODataValue: standardODataLookupValue,
                              strategy: MATCHING_STRATEGIES.SUBSTRING,
                              ddWikiUrl: getDDWikiUrl({
                                standardMetadataMap,
                                resourceName,
                                fieldName,
                                legacyODataValue: standardODataLookupValue
                              })
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
                                suggestion.suggestedLegacyODataValue = standardODataLookupValue;
                                suggestion.ddWikiUrl = getDDWikiUrl({
                                  standardMetadataMap,
                                  resourceName,
                                  fieldName,
                                  legacyODataValue: standardODataLookupValue
                                });
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
            }
          });
        }
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

    if (Object.values(report?.variations ?? {}).some(variation => variation?.length)) {
      await writeFile(CERTIFICATION_FILES.VARIATIONS_REPORT, Buffer.from(JSON.stringify(report, null, 2)));
      LOG(`Results saved to '${VARIATIONS_RESULTS_FILE}'`);
    }

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
  } catch {
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
const updateVariations = async ({
  pathToCsvSuggestions,
  fromCli = false,
  isAdminReview = false,
  isFastTrack = false,
  overwrite = false
}) => {
  const STATS = {};
  const BATCH_SIZE = 10000;

  try {
    const csvData = (await readFile(pathToCsvSuggestions)).toString();
    const jsonData = convertVariationsCsvToJson(csvData);

    const { token } = await fetchProviderToken();

    if (!token) {
      console.error('Could not fetch token from Cert API!');
      return;
    }

    if (fromCli) {
      console.log('Processing suggestions...');
    }

    // need to slice the JSON data into chunks to not exceed the size limit of the service
    for (let slice = 0; slice <= jsonData.length; slice += BATCH_SIZE) {
      const response = await fetch(VARIATIONS_SERVICE_UPDATE_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          isAdminReview: isAdminReview ?? false,
          isFastTrack: isFastTrack ?? false,
          overwrite: overwrite ?? false
        },
        body: JSON.stringify(jsonData.slice(slice, slice + BATCH_SIZE))
      });

      if (response.ok) {
        const stats = await response.json();

        if (fromCli) {
          if (stats && Object.keys(stats)?.length) {
            Object.entries(stats).forEach(([key, value]) => {
              if (key) {
                if (!STATS[key]) {
                  STATS[key] = 0;
                }
                STATS[key] += value;
              }
            });
          }
        }
      } else {
        const errMsg = `Error: Update variations failed!\n${response.statusText}\n`;
        if (fromCli) {
          console.error(errMsg);
          process.exit(NOT_OK);
        } else {
          throw new Error(errMsg);
        }
      }
    }
  } catch (err) {
    const errMsg = `Error: Could not update Variations Service!\n${err}\n`;
    if (fromCli) {
      console.error(errMsg);
      process.exit(NOT_OK);
    } else {
      throw new Error(errMsg);
    }
  }

  if (fromCli) {
    console.log('Done!');

    if (STATS && Object.keys(STATS)?.length) {
      console.log('\nStats: \n');
      Object.entries(STATS).forEach(([key, value]) => {
        if (key) {
          console.log(`  • ${key}: ${value}`);
        }
      });
      console.log('\n');
    }
  }
};

/**
 * Inflates a set of mappings in the given pathToMappings to reso-variations.json
 * @param {String} pathToMappings the path to the gzipped mappings
 */
const inflateVariations = ({ pathToMappings }) => {
  try {
    const data = inflateSync(Buffer.from(readFileSync(pathToMappings).toString(), 'base64')).toString('utf-8');
    writeFileSync('reso-variations.json', JSON.stringify(JSON.parse(data), null, 2));
  } catch (err) {
    console.error(err);
  }
};

module.exports = {
  findVariations,
  computeVariations,
  inflateVariations,
  updateVariations,
  isValidUrl,
  DEFAULT_FUZZINESS,
  MATCHING_STRATEGIES
};
