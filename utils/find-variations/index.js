'use strict';

const chalk = require('chalk');
const { readFile, writeFile } = require('fs/promises');
const { distance, closest } = require('fastest-levenshtein');

const REFERENCE_METADATA_URL = 'https://services.reso.org/metadata?view=all';

const VARIATIONS_RESULTS_FILE = 'data-dictionary-variations.json';

const DEFAULT_FUZZINESS = 1.0 / 3;

const fetchReferenceMetadata = async () => {
  try {
    return (await fetch(REFERENCE_METADATA_URL)).json();
  } catch (err) {
    console.error('Error fetching reference metadata!', err);
    return null;
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

const parseLookupName = lookupName => lookupName?.substring(lookupName.lastIndexOf('.'));

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

    const lookupValue = annotations?.find(
      annotation => annotation?.term === 'RESO.OData.Metadata.StandardName'
    )?.value;

    acc[lookupName].push({ lookupValue, legacyODataValue });
    STATS.numLookups++;
    return acc;
  }, {});

  return {
    metadataMap: {
      ...fields.reduce((acc, { resourceName, fieldName, type, isExpansion = false }) => {
        if (!acc[resourceName]) {
          acc[resourceName] = {};
          STATS.numResources++;
        }

        const hasLookups = !!lookupMap?.[type],
          isLookupField = !type?.startsWith('Edm.') && hasLookups,
          isComplexType = !type?.startsWith('Edm.') && !hasLookups;

        //add field to map
        acc[resourceName][fieldName] = {
          isExpansion,
          isLookupField,
          isComplexType
        };

        if (isLookupField && lookupMap[type]) {
          if (!acc?.[resourceName]?.[fieldName]?.lookupValues) {
            acc[resourceName][fieldName].lookupValues = {};
          }

          if (!acc?.[resourceName]?.[fieldName]?.legacyODataValues) {
            acc[resourceName][fieldName].legacyODataValues = {};
          }

          Object.values(lookupMap?.[type]).forEach(({ lookupValue, legacyODataValue }) => {
            const lookupName = parseLookupName(type);

            if (legacyODataValue?.length) {
              acc[resourceName][fieldName].legacyODataValues[legacyODataValue] = {
                lookupName,
                lookupValue,
                legacyODataValue
              };
            }

            if (lookupValue?.length) {
              acc[resourceName][fieldName].lookupValues[lookupValue] = {
                lookupName,
                lookupValue,
                legacyODataValue
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

const calculateElapsedTime = (startTime = new Date(), useMs = false) =>
  Math.round((new Date() - startTime) / (useMs ? 1 : 1000));

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
      chalk.redBright.bold(`Invalid value! fuzziness must be a decimal number in the range [0, 1]`)
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
    console.log(chalk.whiteBright.bold(`Time Taken: ${calculateElapsedTime(startTime)}s\n`));
    if (!referenceMetadata) return;

    //build a map of reference metadata
    console.log(chalk.cyanBright.bold('\nBuilding references...'));
    startTime = new Date();
    const { metadataMap: referenceMetadataMap = {}, stats: referenceMetadataStats = {} } =
      buildMetadataMap(referenceMetadata);
    console.log(chalk.whiteBright.bold(`Time taken: ${calculateElapsedTime(startTime, true)}ms`));
    console.log(chalk.whiteBright.bold('Metadata info:', getMetadataInfo(referenceMetadataStats)));

    //Pre-process metadata report into map
    console.log(chalk.cyanBright.bold('\nProcessing Metadata Report...'));
    startTime = new Date();
    const { metadataMap: metadataReportMap = {}, stats: metadataReportStats = {} } =
      buildMetadataMap(metadataReportJson);
    console.log(chalk.whiteBright.bold(`Time taken: ${calculateElapsedTime(startTime, true)}ms`));
    console.log(chalk.whiteBright.bold('Metadata info:', getMetadataInfo(metadataReportStats)));

    //run matching process using substrings and edit distance
    console.log(chalk.cyanBright.bold('\nMatching process starting...'));
    startTime = new Date();

    Object.keys(metadataReportMap).forEach(resourceName => {
      //check resources
      if (!referenceMetadataMap?.[resourceName]) {
        const suggestedResourceName = closest(resourceName, Object.keys(referenceMetadataMap));

        const d = distance(resourceName, suggestedResourceName);
        if (d < Math.round(fuzziness * resourceName?.length)) {
          if (verbose) {
            console.log(
              chalk.bold('\nResource Variations Found!'),
              `\nFound possible match for resource '${resourceName}'...`
            );
            console.log('Suggested Resource Name:', suggestedResourceName);
          }

          POSSIBLE_VARIATIONS.resources.add({
            resourceName,
            suggestedResourceName
          });
        }
      } else {
        //standard resource - check field variations
        Object.keys(metadataReportMap?.[resourceName]).forEach(fieldName => {
          if (!referenceMetadataMap?.[resourceName]?.[fieldName]) {
            const suggestedFieldName = closest(fieldName, Object.keys(referenceMetadataMap[resourceName]));

            const d = distance(fieldName, suggestedFieldName);
            if (d < Math.round(fuzziness * fieldName?.length)) {
              if (!metadataReportMap?.[resourceName]?.[suggestedFieldName]) {
                if (verbose) {
                  console.log(
                    chalk.bold('\nField Variations Found!'),
                    `\nFound possible match for resource '${resourceName}' and field '${fieldName}'...`
                  );

                  console.log(`\tSuggested Field Name '${suggestedFieldName}'`);
                }

                POSSIBLE_VARIATIONS.fields.add({
                  resourceName,
                  fieldName,
                  suggestedFieldName
                });
              }
            }
          } else {
            //standard field - if lookup field then try and process the nested lookups
            const { lookupValues = {}, legacyODataValues = {} } =
              metadataReportMap?.[resourceName]?.[fieldName] || {};

            Object.values(lookupValues).forEach(({ lookupValue, legacyODataValue }) => {
              //lookup value can be null since it's the display name and not every system adds display names in this case
              if (lookupValue) {
                if (!referenceMetadataMap?.[resourceName]?.[fieldName]?.lookupValues?.[lookupValue]) {
                  const suggestedLookupValue = closest(
                    lookupValue,
                    Object.keys(referenceMetadataMap?.[resourceName]?.[fieldName]?.lookupValues)
                  );

                  if (suggestedLookupValue) {
                    const d = distance(lookupValue, suggestedLookupValue);
                    if (d < Math.round(fuzziness * lookupValue?.length)) {
                      if (
                        !metadataReportMap?.[resourceName]?.[fieldName]?.lookupValues?.[suggestedLookupValue]
                      ) {
                        if (verbose) {
                          console.log(
                            chalk.bold('\nLookup Value Variations Found!'),
                            `\nFound possible match for resource '${resourceName}', field '${fieldName}', and lookup '${lookupValue}'...`
                          );

                          console.log(chalk.bold('Suggested Lookup Value:'), `'${suggestedLookupValue}'`);
                        }

                        const suggestedLegacyODataValue =
                          referenceMetadataMap?.[resourceName]?.[fieldName]?.lookupValues?.[
                            suggestedLookupValue
                          ]?.legacyODataValue;

                        const suggestions = {
                          resourceName,
                          fieldName,
                          lookupValue,
                          legacyODataValue
                        };

                        if (lookupValue !== suggestedLookupValue) {
                          suggestions.suggestedLookupValue = suggestedLookupValue;
                        }

                        if (legacyODataValue !== suggestedLegacyODataValue) {
                          suggestions.suggestedLegacyODataValue = suggestedLegacyODataValue;
                        }

                        POSSIBLE_VARIATIONS.lookupValues.add(suggestions);
                      }
                    }
                  }
                }
              }
            });

            Object.values(legacyODataValues).forEach(({ lookupValue, legacyODataValue }) => {
              if (!referenceMetadataMap?.[resourceName]?.[fieldName]?.legacyODataValues?.[legacyODataValue]) {
                const suggestedLegacyODataValue = closest(
                  legacyODataValue,
                  Object.keys(referenceMetadataMap?.[resourceName]?.[fieldName]?.legacyODataValues)
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
                        `\nFound possible match for resource '${resourceName}', field '${fieldName}', and lookup '${legacyODataValue}'...`
                      );

                      console.log(
                        chalk.bold('Suggested Legacy OData Value:'),
                        `'${suggestedLegacyODataValue}'`
                      );
                    }

                    const suggestedLookupValue =
                      referenceMetadataMap?.[resourceName]?.[fieldName]?.legacyODataValues?.[
                        suggestedLegacyODataValue
                      ]?.lookupValue;

                    const suggestions = {
                      resourceName,
                      fieldName,
                      lookupValue,
                      legacyODataValue
                    };

                    if (lookupValue !== suggestedLookupValue) {
                      suggestions.suggestedLookupValue = suggestedLookupValue;
                    }

                    if (legacyODataValue !== suggestedLegacyODataValue) {
                      suggestions.suggestedLegacyODataValue = suggestedLegacyODataValue;
                    }

                    POSSIBLE_VARIATIONS.legacyODataValues.add(suggestions);
                  }
                }
              }
            });
          }
        });
      }
    });

    console.log(chalk.greenBright.bold('Done!'));
    console.log(chalk.whiteBright.bold(`Time Taken: ${calculateElapsedTime(startTime, true)}ms`));

    console.log('\n');
    console.log(chalk.cyanBright.bold(`Saving results to ${VARIATIONS_RESULTS_FILE}...`));

    const variations = {
      resources: Array.from(POSSIBLE_VARIATIONS.resources),
      fields: Array.from(POSSIBLE_VARIATIONS.fields),
      lookups: Array.from(new Set(POSSIBLE_VARIATIONS.lookupValues, POSSIBLE_VARIATIONS.legacyODataValues)),
      expansions: Array.from(POSSIBLE_VARIATIONS.expansions),
      complexTypes: Array.from(POSSIBLE_VARIATIONS.complexTypes)
    };

    await writeFile(
      VARIATIONS_RESULTS_FILE,
      Buffer.from(
        JSON.stringify(
          {
            description: 'Data Dictionary Variations',
            version: '1.7',
            generatedOn: new Date().toISOString(),
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
    console.log(chalk.magentaBright.bold(`Total runtime: ${calculateElapsedTime(TOTAL_START_TIME)}s`));
  } catch (err) {
    console.log(chalk.redBright.bold(`\nError in 'findVariations'!\n${err?.message}`));
    console.log(chalk.redBright.bold(`\nStacktrace: \n${err?.stack}`));
  }
};

module.exports = {
  findVariations
};
