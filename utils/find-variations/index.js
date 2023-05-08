'use strict';

const chalk = require('chalk');
const { readFile, writeFile } = require('fs/promises');
const { distance, closest } = require('fastest-levenshtein');
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

/**
 * Trims whitespace and special characters from the given name
 *
 * @param {String} name - the name of the data element to process
 * @returns processed data element name, if possible, otherwise just returns the input
 */
const normalizeDataElementName = name => name?.toLowerCase()?.replace(/[^0-9a-z]/gi, '') || name;

const fetchReferenceMetadata = async () => {
  try {
    const referenceMetadata = getReferenceMetadata();
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
      ...fields.reduce(
        (acc, { resourceName, fieldName, type, isExpansion = false, isComplexType = false, annotations }) => {
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
        },
        {}
      )
    },
    stats: STATS
  };
};

const calculateElapsedTimeString = (startTime = new Date(), useMs = false) => {
  const elapsedTimeMs = new Date() - startTime;

  return elapsedTimeMs < 1000
    ? `${elapsedTimeMs}ms`
    : `${Math.round(elapsedTimeMs / (useMs ? 1 : 1000))}${useMs ? 'ms' : 's'}`;
};

const getMetadataInfo = ({
  numResources = 0,
  numFields = 0,
  numLookups = 0,
  numExpansions = 0,
  numComplexTypes = 0
} = {}) => {
  return `Resources: ${numResources}, Fields: ${numFields}, Lookups: ${numLookups}, Expansions: ${numExpansions}, Complex Types: ${numComplexTypes}`;
};

/**
 * Finds potential variations for a given metadata report
 * @param {String} path
 * @throws Error if path is not a valid S3 or local path
 */
const findVariations = async ({
  pathToMetadataReportJson = '',
  fuzziness = DEFAULT_FUZZINESS,
  verbose = false
} = {}) => {
  if (!pathToMetadataReportJson?.length) {
    console.error(
      chalk.redBright.bold(`Invalid value! pathToMetadataReportJson = '${pathToMetadataReportJson}'`)
    );
    return;
  }

  if (!parseFloat(fuzziness) || fuzziness < 0 || fuzziness > 1) {
    console.error(
      chalk.redBright.bold('Invalid value! fuzziness must be a decimal number in the range [0, 1]')
    );
    return;
  }

  console.log(
    chalk.bgBlueBright.whiteBright(`Using fuzziness of up to ${Math.round(fuzziness * 100)}% of word length!`)
  );

  const POSSIBLE_VARIATIONS = {
    resources: new Set(),
    fields: new Set(),
    lookupValues: new Set(),
    legacyODataValues: new Set(),
    expansions: new Set(),
    complexTypes: new Set()
  };

  const TOTAL_START_TIME = new Date();

  let startTime;

  try {
    //load metadata report from given path - might nee to take report json rather than from path
    console.log(
      chalk.cyanBright.bold('\nLoading metadata report: '),
      chalk.whiteBright.bold(pathToMetadataReportJson)
    );
    const metadataReportJson = JSON.parse(await readFile(pathToMetadataReportJson, { encoding: 'utf8' }));
    console.log(chalk.greenBright.bold('Done!'));

    //get latest version of reference metadata
    console.log(chalk.cyanBright.bold('\nFetching reference metadata...'));
    startTime = new Date();
    const referenceMetadata = await fetchReferenceMetadata();
    console.log(chalk.whiteBright.bold(`Time Taken: ${calculateElapsedTimeString(startTime)}\n`));
    if (!referenceMetadata) return;

    //build a map of reference metadata
    console.log(chalk.cyanBright.bold('\nBuilding references...'));
    startTime = new Date();
    const { metadataMap: standardMetadataMap = {}, stats: referenceMetadataStats = {} } =
      buildMetadataMap(referenceMetadata);
    console.log(chalk.whiteBright.bold(`Time taken: ${calculateElapsedTimeString(startTime, true)}`));
    console.log(chalk.whiteBright.bold('Metadata info:', getMetadataInfo(referenceMetadataStats)));

    //Pre-process metadata report into map
    console.log(chalk.cyanBright.bold('\nProcessing Metadata Report...'));
    startTime = new Date();
    const { metadataMap: metadataReportMap = {}, stats: metadataReportStats = {} } =
      buildMetadataMap(metadataReportJson);
    console.log(chalk.whiteBright.bold(`Time taken: ${calculateElapsedTimeString(startTime, true)}`));
    console.log(chalk.whiteBright.bold('Metadata info:', getMetadataInfo(metadataReportStats)));

    //run matching process using substrings and edit distance
    console.log(chalk.cyanBright.bold('\nMatching process starting...'));
    startTime = new Date();

    Object.keys(metadataReportMap).forEach(resourceName => {
      //check for resource variations if the resource name doesn't match the reference metadata exactly
      if (!standardMetadataMap?.[resourceName]) {
        Object.keys(standardMetadataMap).forEach(standardResourceName => {
          const normalizedStandardResourceName = normalizeDataElementName(standardResourceName),
            normalizedResourceName = normalizeDataElementName(resourceName);

          if (
            normalizedResourceName === normalizedStandardResourceName &&
            resourceName !== standardResourceName
          ) {
            //TODO: refactor ddWikiUrl accessor
            POSSIBLE_VARIATIONS.resources.add({
              resourceName,
              suggestedResourceName: standardResourceName,
              strategy: MATCHING_STRATEGIES.SUBSTRING,
              ddWikiUrl: getReferenceMetadata()?.resources?.find(
                item => item?.resourceName === standardResourceName
              )?.wikiPageURL
            });
          } else if (resourceName?.length > MIN_MATCHING_LENGTH) {
            const d = distance(normalizedStandardResourceName, normalizedResourceName),
              maxDistance = Math.floor(fuzziness * resourceName?.length);

            //TODO: refactor ddWikiUrl accessor
            if (!standardMetadataMap?.[resourceName] && d <= maxDistance) {
              POSSIBLE_VARIATIONS.resources.add({
                resourceName,
                suggestedResourceName: standardResourceName,
                distance: d,
                maxDistance,
                strategy: MATCHING_STRATEGIES.EDIT_DISTANCE,
                ddWikiUrl: getReferenceMetadata()?.resources?.find(
                  item => item?.resourceName === standardResourceName
                )?.wikiPageURL
              });
            }
          }
        });
      } else {
        //found standard resource - check field variations
        Object.keys(metadataReportMap?.[resourceName]).forEach(fieldName => {
          if (!standardMetadataMap?.[resourceName]?.[fieldName]) {
            //field was not found in reference metadata - look for variations
            Object.keys(standardMetadataMap?.[resourceName]).forEach(standardFieldName => {
              const normalizedFieldName = normalizeDataElementName(fieldName),
                normalizedStandardFieldName = normalizeDataElementName(standardFieldName);

              if (
                normalizedStandardFieldName.includes(normalizedFieldName) ||
                normalizedFieldName.includes(normalizedStandardFieldName) ||
                (normalizedFieldName === normalizedStandardFieldName && fieldName !== standardFieldName)
              ) {
                // Only add suggestion to the map if a local field with a similar name
                // wasn't already present in standard form
                if (!metadataReportMap[resourceName][standardFieldName]) {
                  POSSIBLE_VARIATIONS.fields.add({
                    resourceName,
                    fieldName,
                    suggestedFieldName: standardFieldName,
                    strategy: MATCHING_STRATEGIES.SUBSTRING,
                    ddWikiUrl: standardMetadataMap?.[resourceName]?.[standardFieldName]?.ddWikiUrl
                  });
                }
              } else if (fieldName?.length > MIN_MATCHING_LENGTH) {
                // Use Edit Distance matching if a substring match wasn't found
                // https://en.wikipedia.org/wiki/Edit_distance
                // https://en.wikipedia.org/wiki/Levenshtein_distance
                // https://github.com/ka-weihe/fastest-levenshtein
                const d = distance(normalizedFieldName, normalizedStandardFieldName),
                  maxDistance = Math.floor(fuzziness * fieldName?.length);

                if (!metadataReportMap?.[resourceName]?.[standardFieldName] && d <= maxDistance) {
                  if (verbose) {
                    console.log(
                      chalk.bold('\nField Variations Found!'),
                      `\nFound possible match for resource '${resourceName}' and field '${fieldName}'...`
                    );

                    console.log(`\tSuggested Field Name '${standardFieldName}'`);
                  }

                  POSSIBLE_VARIATIONS.fields.add({
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
            });
          } else {
            //standard field - if lookup field then try and process the nested lookups
            const { lookupValues = {}, legacyODataValues = {} } =
              metadataReportMap?.[resourceName]?.[fieldName] || {};

            //check lookupValues
            Object.values(lookupValues).forEach(({ lookupValue, legacyODataValue }) => {
              //lookup value can be null since it's the display name and not every system adds display names in this case
              if (lookupValue) {
                if (!standardMetadataMap?.[resourceName]?.[fieldName]?.lookupValues?.[lookupValue]) {
                  const suggestedLookupValue = closest(
                    lookupValue,
                    Object.keys(standardMetadataMap?.[resourceName]?.[fieldName]?.lookupValues)
                  );

                  if (suggestedLookupValue) {
                    const d = distance(lookupValue, suggestedLookupValue);
                    if (d < Math.round(fuzziness * lookupValue?.length)) {
                      if (
                        !metadataReportMap?.[resourceName]?.[fieldName]?.lookupValues?.[suggestedLookupValue]
                      ) {
                        const suggestion = {
                          resourceName,
                          fieldName,
                          lookupValue,
                          legacyODataValue,
                          distance: d,
                          strategy: MATCHING_STRATEGIES.EDIT_DISTANCE
                        };

                        const { legacyODataValue: suggestedLegacyODataValue, ddWikiUrl } =
                          standardMetadataMap?.[resourceName]?.[fieldName]?.lookupValues?.[
                            suggestedLookupValue
                          ] || {};

                        if (lookupValue !== suggestedLookupValue) {
                          suggestion.matchedOn = 'lookupValue';
                          suggestion.suggestedLookupValue = suggestedLookupValue;
                          if (suggestedLegacyODataValue) {
                            suggestion.suggestedLegacyODataValue = suggestedLegacyODataValue;
                            suggestion.ddWikiUrl = ddWikiUrl;
                          }
                        }

                        if (verbose) {
                          console.log(
                            chalk.bold('\nLookup Value Variations Found!'),
                            `\nFound possible match for resource '${resourceName}', field '${fieldName}', lookupValue '${lookupValue}', and legacyODataValue '${legacyODataValue}'...`
                          );

                          console.log(
                            chalk.bold('Suggested Lookup Value:'),
                            `'${suggestedLookupValue}', with legacyODataValue: '${suggestedLegacyODataValue}'`
                          );
                        }

                        if (legacyODataValue !== suggestedLegacyODataValue) {
                          suggestion.suggestedLegacyODataValue = suggestedLegacyODataValue;
                        }

                        POSSIBLE_VARIATIONS.lookupValues.add(suggestion);
                      }
                    }
                  }
                }
              }
            });

            //check legacyODataValues
            Object.values(legacyODataValues).forEach(({ lookupValue, legacyODataValue }) => {
              if (
                standardMetadataMap?.[resourceName]?.[fieldName]?.legacyODataValues &&
                !standardMetadataMap?.[resourceName]?.[fieldName]?.legacyODataValues?.[legacyODataValue]
              ) {
                const suggestedLegacyODataValue = closest(
                  legacyODataValue,
                  Object.keys(standardMetadataMap?.[resourceName]?.[fieldName]?.legacyODataValues)
                );

                const d = distance(legacyODataValue, suggestedLegacyODataValue);
                if (d < Math.round(fuzziness * legacyODataValue?.length)) {
                  if (
                    !metadataReportMap?.[resourceName]?.[fieldName]?.legacyODataValues[
                      suggestedLegacyODataValue
                    ]
                  ) {
                    if (verbose) {
                      console.log(
                        chalk.bold('\nLegacy OData Value variations found!'),
                        `\nFound possible match for resource '${resourceName}', field '${fieldName}', lookupValue '${lookupValue}', and legacyODataValue '${legacyODataValue}'...`
                      );

                      console.log(
                        chalk.bold('Suggested Legacy OData Value:'),
                        `'${suggestedLegacyODataValue}'`
                      );
                    }

                    const { lookupValue: suggestedLookupValue, ddWikiUrl } =
                      standardMetadataMap?.[resourceName]?.[fieldName]?.legacyODataValues?.[
                        suggestedLegacyODataValue
                      ] || {};

                    const suggestion = {
                      resourceName,
                      fieldName,
                      lookupValue,
                      legacyODataValue,
                      distance: d,
                      strategy: MATCHING_STRATEGIES.EDIT_DISTANCE
                    };

                    //if (lookupValue !== suggestedLookupValue) {
                    if (verbose)
                      console.log(
                        '---> lookupValue is: ' +
                          lookupValue +
                          ', suggestedLookupValue is: ' +
                          suggestedLookupValue
                      );
                    if (legacyODataValue !== suggestedLegacyODataValue) {
                      suggestion.matchedOn = 'legacyODataValue';
                      suggestion.suggestedLegacyODataValue = suggestedLegacyODataValue;
                    }

                    if (ddWikiUrl?.length) {
                      suggestion.ddWikiUrl = ddWikiUrl;
                    }

                    if (lookupValue !== suggestedLookupValue) {
                      suggestion.suggestedLookupValue = suggestedLookupValue;
                    }

                    POSSIBLE_VARIATIONS.legacyODataValues.add(suggestion);
                    //}
                  }
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

            if (!acc?.[resourceName]?.[fieldName]?.[legacyODataValue + lookupValue]) {
              acc[resourceName][fieldName][legacyODataValue + lookupValue] = {
                resourceName,
                fieldName,
                legacyODataValue,
                lookupValue,
                suggestions: []
              };
            }

            acc?.[resourceName]?.[fieldName]?.[legacyODataValue + lookupValue]?.suggestions.push({ ...rest });

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
            version: '1.7',
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
