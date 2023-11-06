'use strict';

const chalk = require('chalk');
const { readFile, writeFile } = require('fs/promises');
const { distance } = require('fastest-levenshtein');
const { getReferenceMetadata } = require('reso-certification-etl');
const { buildMetadataMap } = require('../../common');
const { DEFAULT_DD_VERSION } = require('../replication/utils');

const { REFERENCE_METADATA_URL, CERTIFICATION_PROVIDER_TOKEN, RESO_SERVICES_URL } = process.env;

const VARIATIONS_RESULTS_FILE = 'data-dictionary-variations.json';

const DEFAULT_FUZZINESS = 1.0 / 3,
  MIN_MATCHING_LENGTH = 3,
  CLOSE_MATCH_DISTANCE = 1;

const MATCHING_STRATEGIES = {
  SUBSTRING: 'Substring',
  EDIT_DISTANCE: 'Edit Distance',
  SUGGESTION: 'Suggestion',
  IGNORED: 'Ignored'
};

const MATCHED_ON = {
  LOOKUP_VALUE: 'lookupValue',
  LEGACY_ODATA_VALUE: 'legacyODataValue'
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
    ).flatMap(item => Object.values(item)),
    lookups: Object.values(
      [...lookupValues, ...legacyODataValues].reduce((acc, { resourceName, fieldName, lookupValue, legacyODataValue, ...rest }) => {
        if (!acc?.[resourceName]) {
          acc[resourceName] = {};
        }

        if (!acc?.[resourceName]?.[fieldName]) {
          acc[resourceName][fieldName] = {};
        }

        const combinedKey = legacyODataValue + lookupValue;

        if (!acc?.[resourceName]?.[fieldName]?.[combinedKey]) {
          acc[resourceName][fieldName][combinedKey] = {
            resourceName,
            fieldName,
            legacyODataValue,
            lookupValue,
            suggestions: []
          };
        }

        if (
          !acc[resourceName][fieldName][combinedKey].suggestions.some(
            x => x?.suggestedLookupValue === rest?.suggestedLookupValue && x?.suggestedLegacyODataValue === rest?.suggestedLegacyODataValue
          )
        ) {
          acc[resourceName][fieldName][combinedKey].suggestions.push({ ...rest });
        }

        return acc;
      }, {})
    ).flatMap(item => Object.values(Object.values(item).flatMap(item => Object.values(item)))),
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
      return referenceMetadata;
    }
  } catch (err) {
    try {
      return await fetch(`${REFERENCE_METADATA_URL}?${new URLSearchParams({ version }).toString()}`).json();
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
 * @param {Boolean} useMs true if the response should be in ms
 * @returns elapsed time (TODO: replace with humanize)
 */
const calculateElapsedTimeString = (startTime = new Date(), useMs = false) => {
  const elapsedTimeMs = new Date() - startTime;

  return elapsedTimeMs < 1000 ? `${elapsedTimeMs}ms` : `${Math.round(elapsedTimeMs / (useMs ? 1 : 1000))}${useMs ? 'ms' : 's'}`;
};

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
  useConsole = false,
  useSuggestions = true
} = {}) => {
  try {
    const POSSIBLE_VARIATIONS = {
      resources: [],
      fields: [],
      lookupValues: [],
      legacyODataValues: [],
      expansions: [],
      complexTypes: []
    };

    let startTime;

    //get latest version of reference metadata
    if (useConsole) {
      console.log(chalk.cyanBright.bold('\nFetching reference metadata...'));
      startTime = new Date();
    }

    const referenceMetadata = await fetchReferenceMetadata(version);
    if (useConsole) console.log(chalk.whiteBright.bold(`Time Taken: ${calculateElapsedTimeString(startTime)}\n`));
    if (!referenceMetadata) return;

    //build a map of reference metadata
    if (useConsole) {
      console.log(chalk.cyanBright.bold('\nBuilding references...'));
      startTime = new Date();
    }

    const { metadataMap: standardMetadataMap = {}, stats: referenceMetadataStats = {} } = buildMetadataMap(referenceMetadata);

    if (useConsole) {
      console.log(chalk.whiteBright.bold('Metadata info:', getMetadataInfo(referenceMetadataStats)));
      console.log(chalk.whiteBright.bold(`Time taken: ${calculateElapsedTimeString(startTime, true)}`));
    }

    //Pre-process metadata report into map
    if (useConsole) {
      console.log(chalk.cyanBright.bold('\nProcessing Metadata Report...'));
      startTime = new Date();
    }

    const { metadataMap: metadataReportMap = {}, stats: metadataReportStats = {} } = buildMetadataMap(metadataReportJson);

    if (useConsole) {
      console.log(chalk.whiteBright.bold(`Time taken: ${calculateElapsedTimeString(startTime, true)}`));
      console.log(chalk.whiteBright.bold('Metadata info:', getMetadataInfo(metadataReportStats)));
    }

    // if using suggestions, fetch variations
    let suggestionsMap = {};
    if (useSuggestions) {
      if (!CERTIFICATION_PROVIDER_TOKEN?.length) {
        console.error('Token is required when useSuggestions=true! Skipping suggestions...');
      } else {
        suggestionsMap = (await fetchSuggestionsMap(CERTIFICATION_PROVIDER_TOKEN)) || {};
      }
    }

    //run matching process using substrings and edit distance
    if (useConsole) {
      console.log(chalk.cyanBright.bold('\nMatching process starting...'));
      startTime = new Date();
    }

    const getDDWikiUrlForResourceName = standardResourceName =>
      getReferenceMetadata()?.resources?.find(item => item?.resourceName === standardResourceName)?.wikiPageURL ?? null;

    Object.keys(metadataReportMap).forEach(resourceName => {
      const isStandardResource = !!standardMetadataMap?.[resourceName] ?? false,
        isLocalResource = !isStandardResource;

      //check for resource variations if the resource name doesn't match the reference metadata exactly
      if (isLocalResource) {
        if (useSuggestions && suggestionsMap?.[resourceName]?.suggestions?.length) {
          // use suggestions, if present
          const suggestions = suggestionsMap?.[resourceName]?.suggestions || [];

          POSSIBLE_VARIATIONS.resources.push(
            ...suggestions.flatMap(({ suggestedResourceName, ...suggestion }) => {
              // local resource is allowed if standard resource exists for the suggestion
              if (!metadataReportMap?.[suggestedResourceName]) {
                return {
                  suggestedResourceName,
                  ...suggestion,
                  strategy: MATCHING_STRATEGIES.SUGGESTION
                };
              } else {
                return [];
              }
            })
          );
        } else {
          // Try matching the local resource to a standard one
          Object.keys(standardMetadataMap).forEach(standardResourceName => {
            const normalizedStandardResourceName = normalizeDataElementName(standardResourceName),
              normalizedResourceName = normalizeDataElementName(resourceName);

            const isMinMatchingLength = resourceName?.length > MIN_MATCHING_LENGTH, // && standardResourceName?.length > MIN_MATCHING_LENGTH,
              isSubstringMatch =
                isMinMatchingLength &&
                (normalizedResourceName.includes(normalizedStandardResourceName) ||
                  normalizedStandardResourceName.includes(normalizedResourceName)),
              isExactMatch = normalizedResourceName === normalizedStandardResourceName && resourceName !== standardResourceName,
              hasStandardResource = !!metadataReportMap?.[standardResourceName];

            if (!hasStandardResource && (isExactMatch || isSubstringMatch)) {
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
              // use edit distance matching
              const d = distance(normalizedStandardResourceName, normalizedResourceName),
                maxDistance = Math.floor(fuzziness * resourceName?.length);

              if (!hasStandardResource && d <= maxDistance) {
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
          });
        }
      } else {
        // Is standard resource, so try matching fields...
        Object.keys(metadataReportMap?.[resourceName] ?? {}).forEach(fieldName => {
          const isStandardField = standardMetadataMap?.[resourceName]?.[fieldName] ?? false,
            isLocalField = !isStandardField;

          if (isLocalField) {
            if (useSuggestions && suggestionsMap?.[resourceName]?.[fieldName]?.suggestions?.length) {
              // use suggestions, if present
              const suggestions = suggestionsMap?.[resourceName]?.[fieldName].suggestions || [];

              POSSIBLE_VARIATIONS.fields.push(
                ...suggestions.flatMap(({ suggestedResourceName, suggestedFieldName, ...suggestion }) => {
                  // local resource is allowed if standard resource/field exists for the suggestion
                  if (!metadataReportMap?.[suggestedResourceName]?.[suggestedFieldName]) {
                    return {
                      suggestedResourceName,
                      suggestedFieldName,
                      ...suggestion,
                      strategy: MATCHING_STRATEGIES.SUGGESTION
                    };
                  } else {
                    return [];
                  }
                })
              );
            } else {
              // Try matching
              Object.keys(standardMetadataMap?.[resourceName] ?? {}).forEach(standardFieldName => {
                const isExpansion = standardMetadataMap?.[resourceName]?.[standardFieldName]?.isExpansion ?? false;

                if (!isExpansion) {
                  //case-insensitive, no special characters
                  const normalizedFieldName = normalizeDataElementName(fieldName),
                    normalizedStandardFieldName = normalizeDataElementName(standardFieldName);

                  const isMinMatchingLength = fieldName?.length > MIN_MATCHING_LENGTH, // && standardFieldName?.length > MIN_MATCHING_LENGTH,
                    isExactMatch = normalizedFieldName === normalizedStandardFieldName && fieldName !== standardFieldName,
                    hasStandardField = !!metadataReportMap?.[resourceName]?.[standardFieldName] ?? false,
                    isSubstringMatch =
                      isMinMatchingLength &&
                      (normalizedStandardFieldName.includes(normalizedFieldName) ||
                        normalizedFieldName.includes(normalizedStandardFieldName));

                  //allow substring matching for anything greater than the minimum matching length
                  //unless the case-insensitive substring matches exactly
                  if (!hasStandardField && (isSubstringMatch || isExactMatch)) {
                    // Only add suggestion to the map if a local field with a similar name
                    // wasn't already present in standard form

                    const suggestion = {
                      resourceName,
                      fieldName,
                      suggestedFieldName: standardFieldName,
                      strategy: MATCHING_STRATEGIES.SUBSTRING,
                      ddWikiUrl: standardMetadataMap?.[resourceName]?.[standardFieldName]?.ddWikiUrl
                    };

                    if (isExactMatch) {
                      suggestion.exactMatch = true;
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

                    if (!hasStandardField && d <= maxDistance) {
                      const suggestion = {
                        resourceName,
                        fieldName,
                        suggestedFieldName: standardFieldName,
                        distance: d,
                        maxDistance,
                        strategy: MATCHING_STRATEGIES.EDIT_DISTANCE,
                        ddWikiUrl: standardMetadataMap?.[resourceName]?.[standardFieldName]?.ddWikiUrl
                      };

                      if (d <= CLOSE_MATCH_DISTANCE) {
                        suggestion.closeMatch = true;
                      }

                      POSSIBLE_VARIATIONS.fields.push(suggestion);
                    }
                  }
                }
              });
            }
          } else {
            //standard field - if lookup field then try and process the nested lookups
            const { lookupValues = {}, legacyODataValues = {} } = metadataReportMap?.[resourceName]?.[fieldName] || {};

            //check lookupValues
            Object.values(lookupValues).forEach(({ lookupValue, legacyODataValue, isStringEnumeration }) => {
              //lookup value can be null since it's the display name and not every system adds display names in this case
              if (lookupValue?.length) {
                const standardLookupValues = standardMetadataMap?.[resourceName]?.[fieldName]?.lookupValues || {},
                  isStandardLookupValue = standardLookupValues?.[lookupValue] ?? false,
                  isLocalLookupValue = !isStandardLookupValue;

                //if the lookupValue doesn't exist in the standard metadata map then try and find matches
                if (isLocalLookupValue) {
                  if (useSuggestions && suggestionsMap?.[resourceName]?.[fieldName]?.[lookupValue]?.suggestions?.length) {
                    // use suggestions, if present
                    const suggestions = suggestionsMap[resourceName][fieldName][lookupValue].suggestions || [];

                    POSSIBLE_VARIATIONS.lookupValues.push(
                      ...suggestions.flatMap(({ suggestedResourceName, suggestedFieldName, suggestedLookupValue, ...suggestion }) => {
                        // local lookup value is allowed if standard resource/field/lookupValue exists for the suggestion
                        if (!metadataReportMap?.[suggestedResourceName]?.[suggestedFieldName]?.lookupValues?.[suggestedLookupValue]) {
                          return {
                            suggestedResourceName,
                            suggestedFieldName,
                            suggestedLookupValue,
                            ...suggestion,
                            strategy: MATCHING_STRATEGIES.SUGGESTION
                          };
                        } else {
                          return [];
                        }
                      })
                    );
                  } else {
                    //look through the existing lookupValues to see if we can find matches
                    Object.keys(standardLookupValues).forEach(standardLookupValue => {
                      const normalizedLookupValue = normalizeDataElementName(lookupValue),
                        normalizedStandardLookupValue = normalizeDataElementName(standardLookupValue);

                      const isMinMatchingLength =
                          lookupValue?.length > MIN_MATCHING_LENGTH, // && standardLookupValue?.length > MIN_MATCHING_LENGTH,
                        isExactMatch = normalizedLookupValue === normalizedStandardLookupValue && lookupValue !== standardLookupValue,
                        hasStandardLookupValue = metadataReportMap?.[resourceName]?.[fieldName]?.lookupValues[standardLookupValue] ?? false,
                        isSubstringMatch =
                          isMinMatchingLength &&
                          (normalizedLookupValue.includes(normalizedStandardLookupValue) ||
                            normalizedStandardLookupValue.includes(normalizedLookupValue));

                      //first check case-insensitive substring matches
                      if (isExactMatch || isSubstringMatch) {
                        if (!hasStandardLookupValue) {
                          const { legacyODataValue: standardODataLookupValue, ddWikiUrl } =
                            standardMetadataMap?.[resourceName]?.[fieldName]?.lookupValues?.[standardLookupValue] || {};

                          const suggestion = {
                            resourceName,
                            fieldName,
                            lookupValue,
                            legacyODataValue,
                            suggestedLookupValue: standardLookupValue,
                            matchedOn: MATCHED_ON.LOOKUP_VALUE,
                            strategy: MATCHING_STRATEGIES.SUBSTRING,
                            ddWikiUrl
                          };

                          if (!isStringEnumeration) {
                            suggestion.suggestedLegacyODataValue = standardODataLookupValue;
                          }

                          if (isExactMatch) {
                            suggestion.exactMatch = true;
                            POSSIBLE_VARIATIONS.lookupValues.unshift(suggestion);
                          } else {
                            POSSIBLE_VARIATIONS.lookupValues.push(suggestion);
                          }
                        }
                      } else if (isMinMatchingLength) {
                        // use edit distance matching
                        const d = distance(normalizedLookupValue, normalizedStandardLookupValue),
                          maxDistance = Math.floor(fuzziness * lookupValue?.length);

                        if (!hasStandardLookupValue && d <= maxDistance) {
                          const suggestion = {
                            resourceName,
                            fieldName,
                            lookupValue,
                            legacyODataValue,
                            distance: d,
                            maxDistance,
                            strategy: MATCHING_STRATEGIES.EDIT_DISTANCE
                          };

                          const { legacyODataValue: standardODataLookupValue, ddWikiUrl } =
                            standardMetadataMap?.[resourceName]?.[fieldName]?.lookupValues?.[standardLookupValue] || {};

                          if (lookupValue !== standardLookupValue) {
                            suggestion.matchedOn = MATCHED_ON.LOOKUP_VALUE;
                            suggestion.suggestedLookupValue = standardLookupValue;
                            if (!isStringEnumeration && standardODataLookupValue?.length) {
                              suggestion.suggestedLegacyODataValue = standardODataLookupValue;
                            }
                            suggestion.ddWikiUrl = ddWikiUrl;
                          }

                          if (!isStringEnumeration && legacyODataValue !== standardODataLookupValue) {
                            suggestion.suggestedLegacyODataValue = standardODataLookupValue;
                          }

                          if (d <= CLOSE_MATCH_DISTANCE) {
                            suggestion.closeMatch = true;
                          }

                          POSSIBLE_VARIATIONS.lookupValues.push(suggestion);
                        }
                      }
                    });
                  }
                }
              }
            });

            //check legacyODataValues
            Object.values(legacyODataValues).forEach(({ lookupValue, legacyODataValue }) => {
              if (legacyODataValue?.length) {
                const standardLegacyODataValues = standardMetadataMap?.[resourceName]?.[fieldName]?.legacyODataValues || {},
                  hasStandardLegacyODataValue = standardLegacyODataValues?.[legacyODataValue] ?? false;

                if (!hasStandardLegacyODataValue) {
                  if (useSuggestions && !suggestionsMap?.[resourceName]?.[fieldName]?.[legacyODataValue]?.suggestions?.length) {
                    const suggestions = suggestionsMap?.[resourceName]?.[fieldName]?.[legacyODataValue]?.suggestions || [];

                    POSSIBLE_VARIATIONS.lookupValues.push(
                      ...suggestions.flatMap(({ suggestedResourceName, suggestedFieldName, suggestedODataValue, ...suggestion }) => {
                        // local lookup value is allowed if standard resource/field/legacyODataValue exists for the suggestion
                        if (!standardMetadataMap?.[suggestedResourceName]?.[suggestedFieldName]?.[suggestedODataValue]) {
                          return {
                            suggestedResourceName,
                            suggestedFieldName,
                            suggestedODataValue,
                            ...suggestion,
                            strategy: MATCHING_STRATEGIES.SUGGESTION
                          };
                        } else {
                          return [];
                        }
                      })
                    );


                  } else {
                    Object.keys(standardLegacyODataValues).forEach(standardODataLookupValue => {
                      const normalizedODataValue = normalizeDataElementName(legacyODataValue),
                        normalizedStandardODataValue = normalizeDataElementName(standardODataLookupValue);

                      const isMinMatchingLength =
                          legacyODataValue?.length > MIN_MATCHING_LENGTH, // && standardODataLookupValue?.length > MIN_MATCHING_LENGTH,
                        isExactMatch =
                          normalizedODataValue === normalizedStandardODataValue && legacyODataValue !== standardODataLookupValue,
                        hasStandardLegacyODataValue =
                          metadataReportMap?.[resourceName]?.[fieldName]?.legacyODataValues?.[standardODataLookupValue],
                        isSubstringMatch =
                          isMinMatchingLength &&
                          (normalizedODataValue.includes(normalizedStandardODataValue) ||
                            normalizedStandardODataValue.includes(normalizedODataValue));

                      if (!hasStandardLegacyODataValue) {
                        if (isExactMatch || isSubstringMatch) {
                          const { lookupValue: standardLookupValue, ddWikiUrl } =
                            standardMetadataMap?.[resourceName]?.[fieldName]?.legacyODataValues?.[standardODataLookupValue] || {};

                          const suggestion = {
                            resourceName,
                            fieldName,
                            lookupValue,
                            legacyODataValue,
                            suggestedLookupValue: standardLookupValue,
                            suggestedLegacyODataValue: standardODataLookupValue,
                            matchedOn: MATCHED_ON.LEGACY_ODATA_VALUE,
                            strategy: MATCHING_STRATEGIES.SUBSTRING,
                            ddWikiUrl
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

                          if (!hasStandardLegacyODataValue && d <= maxDistance) {
                            const { lookupValue: suggestedLookupValue, ddWikiUrl } =
                              standardMetadataMap?.[resourceName]?.[fieldName]?.legacyODataValues?.[standardODataLookupValue] || {};

                            const suggestion = {
                              resourceName,
                              fieldName,
                              lookupValue,
                              legacyODataValue,
                              distance: d,
                              maxDistance,
                              strategy: MATCHING_STRATEGIES.EDIT_DISTANCE
                            };

                            if (legacyODataValue !== standardODataLookupValue) {
                              suggestion.matchedOn = MATCHED_ON.LEGACY_ODATA_VALUE;
                              suggestion.suggestedLegacyODataValue = standardODataLookupValue;
                            }

                            if (ddWikiUrl?.length) {
                              suggestion.ddWikiUrl = ddWikiUrl;
                            }

                            if (lookupValue !== suggestedLookupValue) {
                              suggestion.suggestedLookupValue = suggestedLookupValue;
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
              }
            });
          }
        });
      }
    });

    if (useConsole) {
      console.log(chalk.greenBright.bold('Done!'));
      console.log(chalk.whiteBright.bold(`Time Taken: ${calculateElapsedTimeString(startTime, true)}`));
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
  version = '1.7',
  useSuggestions = true,
  useConsole = false
} = {}) => {
  if (!pathToMetadataReportJson?.length) {
    console.error(chalk.redBright.bold(`Invalid value! pathToMetadataReportJson = '${pathToMetadataReportJson}'`));
    return;
  }

  if (!parseFloat(fuzziness) || fuzziness < 0 || fuzziness > 1) {
    console.error(chalk.redBright.bold('Invalid value! fuzziness must be a decimal number in the range [0, 1]'));
    return;
  }

  console.log(chalk.bgBlueBright.whiteBright(`Using fuzziness of up to ${Math.round(fuzziness * 100)}% of word length!`));

  const TOTAL_START_TIME = new Date();

  try {
    //load metadata report from given path - might nee to take report json rather than from path
    if (useConsole) console.log(chalk.cyanBright.bold('\nLoading metadata report: '), chalk.whiteBright.bold(pathToMetadataReportJson));
    const metadataReportJson = JSON.parse(await readFile(pathToMetadataReportJson, { encoding: 'utf8' }));
    if (useConsole) console.log(chalk.greenBright.bold('Done!'));

    const report = await computeVariations({ metadataReportJson, fuzziness, version, useSuggestions });

    if (useConsole) console.log('\n');
    if (useConsole) console.log(chalk.cyanBright.bold(`Saving results to ${VARIATIONS_RESULTS_FILE}...`));
    await writeFile(VARIATIONS_RESULTS_FILE, Buffer.from(JSON.stringify(report, null, '  ')));
    if (useConsole) console.log(chalk.greenBright.bold('Done!'));

    if (useConsole) {
      console.log('\n');
      console.log(chalk.bold('Results:'));
      console.log(`  • Suggested Resources: ${report?.variations?.resources?.length ?? 0}`);
      console.log(`  • Suggested Fields: ${report?.variations?.fields?.length ?? 0}`);
      console.log(`  • Suggested Lookups: ${report?.variations?.lookups.length ?? 0}`);
      console.log(`  • Suggested Expansions: ${report?.variations?.expansions?.length ?? 0}`);
      console.log(`  • Suggested Complex Types: ${report?.variations?.complexTypes?.length ?? 0}`);
      console.log();

      console.log(chalk.greenBright.bold('\nProcessing complete! Exiting...'));
      console.log(chalk.magentaBright.bold(`Total runtime: ${calculateElapsedTimeString(TOTAL_START_TIME)}`));
    }
  } catch (err) {
    console.log(chalk.redBright.bold(`\nError in 'findVariations'!\n${err?.message}`));
    console.log(chalk.redBright.bold(`\nStacktrace: \n${err?.stack}`));
  }
};

/**
 * Fetches suggestions from the variations service
 * @returns Map of suggestions
 */
const fetchSuggestionsMap = async token => {
  try {
    const response = await fetch(`${RESO_SERVICES_URL}/certification/variations`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    return await response.json();
  } catch (err) {
    console.log(err);
    return {};
  }
};

module.exports = {
  findVariations,
  computeVariations,
  isValidUrl
};
