'use strict';

const chalk = require('chalk');
const { readFile, writeFile } = require('fs/promises');
const { distance } = require('fastest-levenshtein');
const { getReferenceMetadata } = require('reso-certification-etl');

const { REFERENCE_METADATA_URL } = process.env;

const VARIATIONS_RESULTS_FILE = 'data-dictionary-variations.json';

const DEFAULT_FUZZINESS = 1.0 / 3,
  MIN_MATCHING_LENGTH = 3;

const ANNOTATION_STANDARD_NAME = 'RESO.OData.Metadata.StandardName',
  ANNOTATION_DD_WIKI_URL = 'RESO.DDWikiUrl';

const MATCHING_STRATEGIES = {
  SUBSTRING: 'Substring',
  EDIT_DISTANCE: 'Edit Distance'
};

const MATCHED_ON = {
  LOOKUP_VALUE: 'lookupValue',
  LEGACY_ODATA_VALUE: 'legacyODataValue'
};

/**
 * Trims whitespace and special characters from the given name
 *
 * @param {String} name - the name of the data element to process
 * @returns processed data element name, if possible, otherwise just returns the input
 */
const normalizeDataElementName = name => name?.toLowerCase()?.replace(/[^0-9a-z]/gi, '') || name;

const fetchReferenceMetadata = async version => {
  try {
    const referenceMetadata = getReferenceMetadata(version);
    if (Object.keys(referenceMetadata)?.length) {
      return referenceMetadata;
    }
  } catch (err) {
    try {
      console.log(chalk.bold(`Loading default metadata from '${REFERENCE_METADATA_URL}'`));
      return (await fetch(REFERENCE_METADATA_URL)).json();
    } catch (err2) {
      return null;
    }
  }
};

const isValidUrl = url => {
  try {
    new URL(url);
    return true;
  } catch (err) {
    console.log(chalk.redBright.bold(`Error: Cannot parse given url: ${url}`));
    return false;
  }
};

const parseLookupName = lookupName => lookupName?.substring(lookupName.lastIndexOf('.') + 1);

const buildMetadataMap = ({ fields = [], lookups = [] } = {}) => {
  const STATS = {
    numResources: 0,
    numFields: 0,
    numLookups: 0,
    numExpansions: 0,
    numComplexTypes: 0
  };

  const lookupMap = lookups.reduce((acc, { lookupName, lookupValue: legacyODataValue, annotations = [] }) => {
    if (!acc[lookupName]) {
      acc[lookupName] = [];
    }

    const { lookupValue, ddWikiUrl } =
      annotations?.reduce((acc, { term, value }) => {
        if (term === ANNOTATION_STANDARD_NAME) {
          acc.lookupValue = value;
        }

        if (term === ANNOTATION_DD_WIKI_URL) {
          acc.ddWikiUrl = value;
        }
        return acc;
      }, {}) || {};

    acc[lookupName].push({ lookupValue, legacyODataValue, ddWikiUrl });
    STATS.numLookups++;
    return acc;
  }, {});

  return {
    metadataMap: {
      ...fields.reduce((acc, { resourceName, fieldName, type, isExpansion = false, isComplexType = false, annotations }) => {
        if (!acc[resourceName]) {
          acc[resourceName] = {};
          STATS.numResources++;
        }

        const isLookupField = !!lookupMap?.[type];

        const { ddWikiUrl } =
          annotations?.reduce((acc, { term, value }) => {
            if (term === ANNOTATION_DD_WIKI_URL) {
              acc.ddWikiUrl = value;
            }
            return acc;
          }, {}) || {};

        //add field to map
        acc[resourceName][fieldName] = {
          isExpansion,
          isLookupField,
          isComplexType: isComplexType || (!isExpansion && !type?.startsWith('Edm.') && !isLookupField),
          ddWikiUrl
        };

        if (isLookupField && lookupMap?.[type]) {
          if (!acc?.[resourceName]?.[fieldName]?.lookupValues) {
            acc[resourceName][fieldName].lookupValues = {};
          }

          if (!acc?.[resourceName]?.[fieldName]?.legacyODataValues) {
            acc[resourceName][fieldName].legacyODataValues = {};
          }

          Object.values(lookupMap?.[type]).forEach(({ lookupValue, legacyODataValue, ddWikiUrl }) => {
            const lookupName = parseLookupName(type);

            if (legacyODataValue?.length) {
              acc[resourceName][fieldName].legacyODataValues[legacyODataValue] = {
                lookupName,
                lookupValue,
                legacyODataValue,
                ddWikiUrl
              };
            }

            if (lookupValue?.length) {
              acc[resourceName][fieldName].lookupValues[lookupValue] = {
                lookupName,
                lookupValue,
                legacyODataValue,
                ddWikiUrl
              };
            }
          });
        }

        if (isExpansion) {
          STATS.numExpansions++;
        }

        if (isComplexType) {
          STATS.numComplexTypes++;
        }

        STATS.numFields++;
        return acc;
      }, {})
    },
    stats: STATS
  };
};

const calculateElapsedTimeString = (startTime = new Date(), useMs = false) => {
  const elapsedTimeMs = new Date() - startTime;

  return elapsedTimeMs < 1000 ? `${elapsedTimeMs}ms` : `${Math.round(elapsedTimeMs / (useMs ? 1 : 1000))}${useMs ? 'ms' : 's'}`;
};

const getMetadataInfo = ({ numResources = 0, numFields = 0, numLookups = 0, numExpansions = 0, numComplexTypes = 0 } = {}) => {
  return `Resources: ${numResources}, Fields: ${numFields}, Lookups: ${numLookups}, Expansions: ${numExpansions}, Complex Types: ${numComplexTypes}`;
};

/**
 * Finds potential variations for a given metadata report
 * @param {String} path
 * @throws Error if path is not a valid S3 or local path
 */
const findVariations = async ({ pathToMetadataReportJson = '', fuzziness = DEFAULT_FUZZINESS, debug = false, version = '1.7' } = {}) => {
  if (!pathToMetadataReportJson?.length) {
    console.error(chalk.redBright.bold(`Invalid value! pathToMetadataReportJson = '${pathToMetadataReportJson}'`));
    return;
  }

  if (!parseFloat(fuzziness) || fuzziness < 0 || fuzziness > 1) {
    console.error(chalk.redBright.bold('Invalid value! fuzziness must be a decimal number in the range [0, 1]'));
    return;
  }

  console.log(chalk.bgBlueBright.whiteBright(`Using fuzziness of up to ${Math.round(fuzziness * 100)}% of word length!`));

  const POSSIBLE_VARIATIONS = {
    resources: [],
    fields: [],
    lookupValues: [],
    legacyODataValues: [],
    expansions: [],
    complexTypes: []
  };

  const TOTAL_START_TIME = new Date();

  let startTime;

  try {
    //load metadata report from given path - might nee to take report json rather than from path
    console.log(chalk.cyanBright.bold('\nLoading metadata report: '), chalk.whiteBright.bold(pathToMetadataReportJson));
    const metadataReportJson = JSON.parse(await readFile(pathToMetadataReportJson, { encoding: 'utf8' }));
    console.log(chalk.greenBright.bold('Done!'));

    //get latest version of reference metadata
    console.log(chalk.cyanBright.bold('\nFetching reference metadata...'));
    startTime = new Date();
    const referenceMetadata = await fetchReferenceMetadata(version);
    console.log(chalk.whiteBright.bold(`Time Taken: ${calculateElapsedTimeString(startTime)}\n`));
    if (!referenceMetadata) return;

    //build a map of reference metadata
    console.log(chalk.cyanBright.bold('\nBuilding references...'));
    startTime = new Date();
    const { metadataMap: standardMetadataMap = {}, stats: referenceMetadataStats = {} } = buildMetadataMap(referenceMetadata);
    console.log(chalk.whiteBright.bold(`Time taken: ${calculateElapsedTimeString(startTime, true)}`));
    console.log(chalk.whiteBright.bold('Metadata info:', getMetadataInfo(referenceMetadataStats)));

    //Pre-process metadata report into map
    console.log(chalk.cyanBright.bold('\nProcessing Metadata Report...'));
    startTime = new Date();
    const { metadataMap: metadataReportMap = {}, stats: metadataReportStats = {} } = buildMetadataMap(metadataReportJson);
    console.log(chalk.whiteBright.bold(`Time taken: ${calculateElapsedTimeString(startTime, true)}`));
    console.log(chalk.whiteBright.bold('Metadata info:', getMetadataInfo(metadataReportStats)));

    //run matching process using substrings and edit distance
    console.log(chalk.cyanBright.bold('\nMatching process starting...'));
    startTime = new Date();

    const getDDWikiUrlForResourceName = standardResourceName =>
      getReferenceMetadata()?.resources?.find(item => item?.resourceName === standardResourceName)?.wikiPageURL || null;

    Object.keys(metadataReportMap).forEach(resourceName => {
      //check for resource variations if the resource name doesn't match the reference metadata exactly
      if (!standardMetadataMap?.[resourceName]) {
        Object.keys(standardMetadataMap).forEach(standardResourceName => {
          const normalizedStandardResourceName = normalizeDataElementName(standardResourceName),
            normalizedResourceName = normalizeDataElementName(resourceName);

          if (normalizedResourceName === normalizedStandardResourceName && resourceName !== standardResourceName) {
            POSSIBLE_VARIATIONS.resources.push({
              resourceName,
              suggestedResourceName: standardResourceName,
              strategy: MATCHING_STRATEGIES.SUBSTRING,
              ddWikiUrl: getDDWikiUrlForResourceName(standardResourceName),
              exactMatch: true
            });
          } else if (resourceName?.length > MIN_MATCHING_LENGTH) {
            const d = distance(normalizedStandardResourceName, normalizedResourceName),
              maxDistance = Math.floor(fuzziness * resourceName?.length);

            if (!metadataReportMap?.[standardResourceName] && d <= maxDistance) {
              POSSIBLE_VARIATIONS.resources.push({
                resourceName,
                suggestedResourceName: standardResourceName,
                distance: d,
                maxDistance,
                strategy: MATCHING_STRATEGIES.EDIT_DISTANCE,
                ddWikiUrl: getDDWikiUrlForResourceName(standardResourceName)
              });
            }
          }
        });
      } else {
        //found standard resource - check field name variations
        Object.keys(metadataReportMap?.[resourceName]).forEach(fieldName => {
          if (!standardMetadataMap?.[resourceName]?.[fieldName]) {
            //field was not found in reference metadata - look for variations
            Object.keys(standardMetadataMap?.[resourceName]).forEach(standardFieldName => {
              const normalizedFieldName = normalizeDataElementName(fieldName),
                normalizedStandardFieldName = normalizeDataElementName(standardFieldName);

              if (!standardMetadataMap?.[resourceName]?.[standardFieldName]?.isExpansion) {
                //allow substring matching for anything less than the minimum matching length
                //unless the case-insensitive substring matches exactly
                if (
                  ((normalizedStandardFieldName.includes(normalizedFieldName) ||
                    normalizedFieldName.includes(normalizedStandardFieldName)) &&
                    fieldName?.length > MIN_MATCHING_LENGTH) ||
                  (normalizedFieldName === normalizedStandardFieldName && fieldName !== standardFieldName)
                ) {
                  // Only add suggestion to the map if a local field with a similar name
                  // wasn't already present in standard form
                  if (!metadataReportMap[resourceName][standardFieldName]) {
                    const suggestion = {
                      resourceName,
                      fieldName,
                      suggestedFieldName: standardFieldName,
                      strategy: MATCHING_STRATEGIES.SUBSTRING,
                      ddWikiUrl: standardMetadataMap?.[resourceName]?.[standardFieldName]?.ddWikiUrl
                    };

                    if (normalizedFieldName === normalizedStandardFieldName && fieldName !== standardFieldName) {
                      suggestion.exactMatch = true;
                      POSSIBLE_VARIATIONS.fields.unshift(suggestion);
                    } else {
                      POSSIBLE_VARIATIONS.fields.push(suggestion);
                    }
                  }
                } else if (fieldName?.length > MIN_MATCHING_LENGTH) {
                  // Use Edit Distance matching if a substring match wasn't found
                  // https://en.wikipedia.org/wiki/Edit_distance
                  // https://en.wikipedia.org/wiki/Levenshtein_distance
                  // https://github.com/ka-weihe/fastest-levenshtein
                  const d = distance(normalizedFieldName, normalizedStandardFieldName),
                    maxDistance = Math.floor(fuzziness * fieldName?.length);

                  if (!metadataReportMap?.[resourceName]?.[standardFieldName] && d <= maxDistance) {
                    if (debug) {
                      console.log(
                        chalk.bold('\nField Variations Found!'),
                        `\nFound possible match for resource '${resourceName}' and field '${fieldName}'...`
                      );

                      console.log(`\tSuggested Field Name '${standardFieldName}'`);
                    }

                    POSSIBLE_VARIATIONS.fields.push({
                      resourceName,
                      fieldName,
                      suggestedFieldName: standardFieldName,
                      distance: d,
                      maxDistance,
                      strategy: MATCHING_STRATEGIES.EDIT_DISTANCE,
                      ddWikiUrl: standardMetadataMap?.[resourceName]?.[standardFieldName]?.ddWikiUrl
                    });
                  }
                }
              }
            });
          } else {
            //standard field - if lookup field then try and process the nested lookups
            const { lookupValues = {}, legacyODataValues = {} } = metadataReportMap?.[resourceName]?.[fieldName] || {};

            //check lookupValues
            Object.values(lookupValues).forEach(({ lookupValue, legacyODataValue }) => {
              //lookup value can be null since it's the display name and not every system adds display names in this case
              if (lookupValue?.length) {
                //if the lookupValue doesn't exist in the standard metadata map then try and find matches
                if (!standardMetadataMap?.[resourceName]?.[fieldName]?.lookupValues?.[lookupValue]) {
                  //look through the existing lookupValues to see if we can find matches
                  Object.keys(standardMetadataMap[resourceName][fieldName].lookupValues).forEach(standardLookupValue => {
                    const normalizedLookupValue = normalizeDataElementName(lookupValue),
                      normalizedStandardLookupValue = normalizeDataElementName(standardLookupValue);

                    //first check case-insensitive substring matches
                    if (
                      ((normalizedLookupValue.includes(normalizedStandardLookupValue) ||
                        normalizedStandardLookupValue.includes(normalizedLookupValue)) &&
                        lookupValue?.length > MIN_MATCHING_LENGTH) ||
                      (normalizedLookupValue === normalizedStandardLookupValue && lookupValue !== standardLookupValue)
                    ) {
                      if (!metadataReportMap?.[resourceName]?.[fieldName]?.lookupValues[standardLookupValue]) {
                        const { legacyODataValue: standardODataLookupValue, ddWikiUrl } =
                          standardMetadataMap?.[resourceName]?.[fieldName]?.lookupValues?.[standardLookupValue] || {};

                        const suggestion = {
                          resourceName,
                          fieldName,
                          lookupValue,
                          legacyODataValue,
                          suggestedLookupValue: standardLookupValue,
                          suggestedLegacyODataValue: standardODataLookupValue,
                          matchedOn: MATCHED_ON.LOOKUP_VALUE,
                          strategy: MATCHING_STRATEGIES.SUBSTRING,
                          ddWikiUrl
                        };

                        if (normalizedLookupValue === normalizedStandardLookupValue && lookupValue !== standardLookupValue) {
                          suggestion.exactMatch = true;
                          POSSIBLE_VARIATIONS.lookupValues.unshift(suggestion);
                        } else {
                          POSSIBLE_VARIATIONS.lookupValues.push(suggestion);
                        }

                        if (debug) {
                          console.log(
                            chalk.bold('\nLookup Value Variations Found!'),
                            `\nFound possible match for resource '${resourceName}', field '${fieldName}', lookupValue '${lookupValue}', and legacyODataValue '${legacyODataValue}'...`
                          );

                          console.log(
                            chalk.bold('Suggested Lookup Value:'),
                            `'${standardLookupValue}', with legacyODataValue: '${standardODataLookupValue}'`
                          );
                        }
                      }
                    } else if (lookupValue?.length > MIN_MATCHING_LENGTH) {
                      const d = distance(normalizedLookupValue, normalizedStandardLookupValue),
                        maxDistance = Math.floor(fuzziness * lookupValue?.length);

                      if (!metadataReportMap?.[resourceName]?.[fieldName]?.lookupValues[standardLookupValue] && d <= maxDistance) {
                        const suggestion = {
                          resourceName,
                          fieldName,
                          lookupValue,
                          legacyODataValue,
                          distance: d,
                          strategy: MATCHING_STRATEGIES.EDIT_DISTANCE
                        };

                        const { legacyODataValue: standardODataLookupValue, ddWikiUrl } =
                          standardMetadataMap?.[resourceName]?.[fieldName]?.lookupValues?.[standardLookupValue] || {};

                        if (lookupValue !== standardLookupValue) {
                          suggestion.matchedOn = MATCHED_ON.LOOKUP_VALUE;
                          suggestion.suggestedLookupValue = standardLookupValue;
                          if (standardODataLookupValue?.length) {
                            suggestion.suggestedLegacyODataValue = standardODataLookupValue;
                            suggestion.ddWikiUrl = ddWikiUrl;
                          }
                        }

                        if (debug) {
                          console.log(
                            chalk.bold('\nLookup Value Variations Found!'),
                            `\nFound possible match for resource '${resourceName}', field '${fieldName}', lookupValue '${lookupValue}', and legacyODataValue '${legacyODataValue}'...`
                          );

                          console.log(
                            chalk.bold('Suggested Lookup Value:'),
                            `'${standardLookupValue}', with legacyODataValue: '${standardODataLookupValue}'`
                          );
                        }

                        if (legacyODataValue !== standardODataLookupValue) {
                          suggestion.suggestedLegacyODataValue = standardODataLookupValue;
                        }

                        POSSIBLE_VARIATIONS.lookupValues.push(suggestion);
                      }
                    }
                  });
                }
              }
            });

            //check legacyODataValues
            Object.values(legacyODataValues).forEach(({ lookupValue, legacyODataValue }) => {
              if (legacyODataValue?.length) {
                if (!standardMetadataMap?.[resourceName]?.[fieldName]?.legacyODataValues?.[legacyODataValue]) {
                  Object.keys(standardMetadataMap[resourceName][fieldName].legacyODataValues).forEach(standardODataLookupValue => {
                    const normalizedODataValue = normalizeDataElementName(legacyODataValue),
                      normalizedStandardODataValue = normalizeDataElementName(standardODataLookupValue);

                    if (
                      ((normalizedODataValue.includes(normalizedStandardODataValue) ||
                        normalizedStandardODataValue.includes(normalizedODataValue)) &&
                        legacyODataValue?.length > MIN_MATCHING_LENGTH) ||
                      (normalizedODataValue === normalizedStandardODataValue && legacyODataValue !== standardODataLookupValue)
                    ) {
                      if (!metadataReportMap?.[resourceName]?.[fieldName]?.legacyODataValues?.[standardODataLookupValue]) {
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

                        if (normalizedODataValue === normalizedStandardODataValue && legacyODataValue !== standardODataLookupValue) {
                          suggestion.exactMatch = true;
                          POSSIBLE_VARIATIONS.legacyODataValues.unshift(suggestion);
                        } else {
                          POSSIBLE_VARIATIONS.legacyODataValues.push(suggestion);
                        }

                        if (debug) {
                          console.log(
                            chalk.bold('\nLegacy OData Value variations found!'),
                            `\nFound possible match for resource '${resourceName}', field '${fieldName}', lookupValue '${lookupValue}', and legacyODataValue '${legacyODataValue}'...`
                          );

                          console.log(chalk.bold('Suggested Legacy OData Value:'), `'${standardODataLookupValue}'`);
                        }
                      } else if (legacyODataValue?.length > MIN_MATCHING_LENGTH) {
                        const d = distance(legacyODataValue, standardODataLookupValue);
                        if (d < Math.round(fuzziness * legacyODataValue?.length)) {
                          if (!metadataReportMap?.[resourceName]?.[fieldName]?.legacyODataValues[standardODataLookupValue]) {
                            if (debug) {
                              console.log(
                                chalk.bold('\nLegacy OData Value variations found!'),
                                `\nFound possible match for resource '${resourceName}', field '${fieldName}', lookupValue '${lookupValue}', and legacyODataValue '${legacyODataValue}'...`
                              );

                              console.log(chalk.bold('Suggested Legacy OData Value:'), `'${standardODataLookupValue}'`);
                            }

                            const { lookupValue: suggestedLookupValue, ddWikiUrl } =
                              standardMetadataMap?.[resourceName]?.[fieldName]?.legacyODataValues?.[standardODataLookupValue] || {};

                            const suggestion = {
                              resourceName,
                              fieldName,
                              lookupValue,
                              legacyODataValue,
                              distance: d,
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

                            POSSIBLE_VARIATIONS.legacyODataValues.push(suggestion);
                          }
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

    console.log(chalk.greenBright.bold('Done!'));
    console.log(chalk.whiteBright.bold(`Time Taken: ${calculateElapsedTimeString(startTime, true)}`));

    console.log('\n');
    console.log(chalk.cyanBright.bold(`Saving results to ${VARIATIONS_RESULTS_FILE}...`));

    const variations = {
      resources: Object.values(
        Array.from(POSSIBLE_VARIATIONS.resources).reduce((acc, { resourceName, ...suggestion }) => {
          if (!acc?.[resourceName]) {
            acc[resourceName] = {
              resourceName,
              suggestions: []
            };
          }

          acc[resourceName].suggestions.push(suggestion);

          return acc;
        }, {})
      ),
      fields: Object.values(
        Array.from(POSSIBLE_VARIATIONS.fields).reduce((acc, { resourceName, fieldName, ...suggestion }) => {
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
        [...POSSIBLE_VARIATIONS.lookupValues, ...POSSIBLE_VARIATIONS.legacyODataValues].reduce(
          (acc, { resourceName, fieldName, lookupValue, legacyODataValue, ...rest }) => {
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
                x =>
                  x?.suggestedLookupValue === rest?.suggestedLookupValue && x?.suggestedLegacyODataValue === rest?.suggestedLegacyODataValue
              )
            ) {
              acc[resourceName][fieldName][combinedKey].suggestions.push({ ...rest });
            }

            return acc;
          },
          {}
        )
      ).flatMap(item => Object.values(Object.values(item).flatMap(item => Object.values(item)))),
      expansions: Array.from(POSSIBLE_VARIATIONS.expansions),
      complexTypes: Array.from(POSSIBLE_VARIATIONS.complexTypes)
    };

    await writeFile(
      VARIATIONS_RESULTS_FILE,
      Buffer.from(
        JSON.stringify(
          {
            description: 'Data Dictionary Variations Report',
            version,
            generatedOn: new Date().toISOString(),
            fuzziness: parseFloat(fuzziness),
            variations
          },
          null,
          '  '
        )
      )
    );
    console.log(chalk.greenBright.bold('Done!'));

    console.log('\n');
    console.log(chalk.bold('Results:'));
    console.log(`  • Suggested Resources: ${variations?.resources?.length || 0}`);
    console.log(`  • Suggested Fields: ${variations?.fields?.length || 0}`);
    console.log(`  • Suggested Lookups: ${variations?.lookups.length || 0}`);
    console.log(`  • Suggested Expansions: ${variations?.expansions?.length || 0}`);
    console.log(`  • Suggested Complex Types: ${variations?.complexTypes?.length || 0}`);
    console.log();

    //TODO: add a checker to connect to Sagemaker

    //TODO: add a checker to connect to human-curated variations

    console.log(chalk.greenBright.bold('\nProcessing complete! Exiting...'));
    console.log(chalk.magentaBright.bold(`Total runtime: ${calculateElapsedTimeString(TOTAL_START_TIME)}`));
  } catch (err) {
    console.log(chalk.redBright.bold(`\nError in 'findVariations'!\n${err?.message}`));
    console.log(chalk.redBright.bold(`\nStacktrace: \n${err?.stack}`));
  }
};

module.exports = {
  findVariations,
  isValidUrl
};
