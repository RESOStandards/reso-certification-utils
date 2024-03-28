'use strict';

const assert = require('assert');
const { computeVariations } = require('../index.js');
const { getReferenceMetadata } = require('../lib/misc/index.js');
const { MATCHING_STRATEGIES } = require('../lib/variations/index.js');

const getRandomNonAlphaNumericCharacter = () => {
  const chars = ['_', '&', '-', ' ', ', '];

  return chars[Math.floor(Math.random() * chars.length)];
};

const isEven = (n = 0) => (parseInt(n) ? n % 2 == 0 : false);

const intersperseNonAlphaNumericNoise = (value = '') => {
  let newValue = '';

  for (let i = 0; i < value.length; i++) {
    if (isEven(Math.floor(Math.random() * 100))) {
      newValue += value[i] + getRandomNonAlphaNumericCharacter();
    } else {
      newValue += value[i];
    }
  }

  return newValue;
};

const TEST_FUZZINESS = 0.25,
  DD_1_7 = '1.7',
  DD_2_0 = '2.0',
  DEFAULT_VERSION = DD_1_7;


describe('Variations Service reference metadata tests', () => {
  it('Should have required properties when the metadata report is empty', async () => {
    const metadataReportJson = {};

    try {
      const { description, version, generatedOn, fuzziness, variations } = await computeVariations({
        metadataReportJson,
        fuzziness: TEST_FUZZINESS,
        version: DEFAULT_VERSION
      });

      assert.notEqual(description.length, 0);
      assert.notEqual(version.length, 0);
      assert.notEqual(generatedOn.length, 0);

      //check that the variations object is present and has values
      assert.equal(!!Object.keys(variations).length, true);

      const { resources, fields, lookups, expansions, complexTypes } = variations;

      assert.deepStrictEqual(resources, [], '"resources" is non-empty but expected []!');
      assert.deepStrictEqual(fields, [], '"fields" is non-empty but expected []!!');
      assert.deepStrictEqual(lookups, [], '"lookups" is non-empty but expected []!!');
      assert.deepStrictEqual(expansions, [], '"expansions" is non-empty but expected []!!');
      assert.deepStrictEqual(complexTypes, [], '"complexTypes" is non-empty but expected []!!');

      //check version and fuzziness
      assert.equal(version, DEFAULT_VERSION, `'${version}' does not match version specified: '${DEFAULT_VERSION}'`);
      assert.equal(fuzziness, TEST_FUZZINESS, `'${fuzziness}' does not match version specified: '${TEST_FUZZINESS}'`);
    } catch (err) {
      assert.ok(false, err?.message);
    }
  });

  it(`Should have no variations flagged when using version ${DD_1_7} metadata`, async () => {
    try {
      const metadataReportJson = await getReferenceMetadata(DD_1_7);

      const { description, version, generatedOn, fuzziness, variations } = await computeVariations({
        metadataReportJson,
        fuzziness: TEST_FUZZINESS,
        version: DD_1_7
      });

      assert.notEqual(description.length, 0);
      assert.notEqual(version.length, 0);
      assert.notEqual(generatedOn.length, 0);

      //check that the variations object is present and has values
      assert.equal(!!Object.keys(variations).length, true);

      const { resources, fields, lookups, expansions, complexTypes } = variations;

      assert.deepStrictEqual(resources, [], '"resources" is non-empty but expected []!');
      assert.deepStrictEqual(fields, [], '"fields" is non-empty but expected []!!');
      assert.deepStrictEqual(lookups, [], '"lookups" is non-empty but expected []!!');
      assert.deepStrictEqual(expansions, [], '"expansions" is non-empty but expected []!!');
      assert.deepStrictEqual(complexTypes, [], '"complexTypes" is non-empty but expected []!!');

      //check version and fuzziness
      assert.equal(version, DD_1_7, `Version '${version}' does not match version specified: '${DD_1_7}'`);
      assert.equal(fuzziness, TEST_FUZZINESS, `Fuzziness '${fuzziness}' does not match fuzziness specified: '${TEST_FUZZINESS}'`);
    } catch (err) {
      assert.ok(false, err?.message);
    }
  });

  it(`Should have no variations flagged when using version ${DD_1_7} metadata with 100% fuzziness`, async () => {
    try {
      const MAX_FUZZINESS = 1.0;
      const metadataReportJson = await getReferenceMetadata(DD_1_7);

      const { description, version, generatedOn, fuzziness, variations } = await computeVariations({
        metadataReportJson,
        fuzziness: 1.0,
        version: DD_1_7
      });

      assert.notEqual(description.length, 0);
      assert.notEqual(version.length, 0);
      assert.notEqual(generatedOn.length, 0);

      //check that the variations object is present and has values
      assert.equal(!!Object.keys(variations).length, true);

      const { resources, fields, lookups, expansions, complexTypes } = variations;

      assert.deepStrictEqual(resources, [], '"resources" is non-empty but expected []!');
      assert.deepStrictEqual(fields, [], '"fields" is non-empty but expected []!!');
      assert.deepStrictEqual(lookups, [], '"lookups" is non-empty but expected []!!');
      assert.deepStrictEqual(expansions, [], '"expansions" is non-empty but expected []!!');
      assert.deepStrictEqual(complexTypes, [], '"complexTypes" is non-empty but expected []!!');

      assert.equal(fuzziness, MAX_FUZZINESS, `Expected fuzziness to be 1.0 but was: ${fuzziness}`);
    } catch (err) {
      assert.ok(false, err?.message);
    }
  });

  it(`Should identify known ${DD_1_7} resources with lowercase and non-alphanumeric noise`, async () => {
    const metadataReportJson = await getReferenceMetadata(DD_1_7);

    const processedResources = new Set();

    for await (const { resourceName, fieldName } of Object.values(metadataReportJson.fields)) {
      if (!processedResources.has(resourceName)) {
        const testMetadataReportJson = {
          fields: [
            {
              resourceName: intersperseNonAlphaNumericNoise(resourceName?.toLowerCase()),
              fieldName
            }
          ]
        };

        const { variations } = await computeVariations({ metadataReportJson: testMetadataReportJson, version: DD_1_7 });

        assert.equal(variations.resources.length, 1, 'Exactly one resource name should have matched!');
        assert.equal(variations.resourceName, testMetadataReportJson.resourceName);

        //the suggestions should have the resource name in them
        assert.equal(
          variations.resources[0].suggestions.some(x => x?.suggestedResourceName === resourceName),
          true,
          `Match for resource '${resourceName}' not found in suggestions!`
        );

        processedResources.add(resourceName);
      }
    }
  });

  it(`Should identify known ${DD_1_7} fields when the variation is lowercase with non-alphanumeric noise`, async () => {
    const metadataReportJson = await getReferenceMetadata(DD_1_7);

    const testMetadataReportJson = Object.values(metadataReportJson?.fields ?? []).reduce(
      (acc, { resourceName, fieldName, isExpansion }) => {
        if (isExpansion) return acc;
        acc.fields.push({ resourceName, fieldName: intersperseNonAlphaNumericNoise(fieldName?.toLowerCase()) });
        return acc;
      },
      { fields: [] }
    );

    const { variations = [] } = await computeVariations({ metadataReportJson: testMetadataReportJson, version: DD_1_7 });

    const { fields: metadataReportFields = [] } = metadataReportJson,
      { fields: fieldVariations = [] } = variations;

    //items are concatenated for comparisons
    const metadataReportFieldsSet = new Set(
      metadataReportFields.flatMap(({ resourceName, fieldName, isExpansion = false }) => {
        if (isExpansion) return [];
        return `${resourceName}${fieldName}`;
      })
    );

    const unmatchedItems = fieldVariations.flatMap(({ resourceName, fieldName, suggestions = [] }) => {
      if (suggestions.some(({ suggestedFieldName }) => metadataReportFieldsSet.has(`${resourceName}${suggestedFieldName}`))) {
        return [];
      } else {
        return {
          resourceName,
          fieldName
        };
      }
    });

    assert.equal(unmatchedItems?.length, 0, 'Each field should have been matched to at least one match in the reference metadata!');

    const noExactMatches = fieldVariations.flatMap(({ resourceName, fieldName, suggestions = [] }) => {
      if (suggestions.some(x => x?.exactMatch)) {
        return [];
      } else {
        return {
          resourceName,
          fieldName
        };
      }
    });

    assert.equal(noExactMatches.length, 0, 'Every item in the reference set should have matched exactly to one item in the suggestions!');
  });

  it(`Should have no variations flagged when using version ${DD_2_0} metadata`, async () => {
    try {
      const metadataReportJson = await getReferenceMetadata(DD_2_0);

      const { description, version, generatedOn, fuzziness, variations } = await computeVariations({
        metadataReportJson,
        fuzziness: TEST_FUZZINESS,
        version: DD_2_0
      });

      assert.notEqual(description.length, 0);
      assert.notEqual(version.length, 0);
      assert.notEqual(generatedOn.length, 0);

      //check that the variations object is present and has values
      assert.equal(!!Object.keys(variations).length, true);

      const { resources, fields, lookups, expansions, complexTypes } = variations;

      assert.deepStrictEqual(resources, [], `'resources' is ${JSON.stringify(resources, null, ' ')} but expected []!`);
      assert.deepStrictEqual(fields, [], `'fields' is ${JSON.stringify(fields, null, ' ')} but expected []!!`);
      assert.deepStrictEqual(lookups, [], `'lookups' is ${JSON.stringify(lookups, null, ' ')} but expected []!!`);
      assert.deepStrictEqual(expansions, [], `'expansions' is ${JSON.stringify(expansions, null, ' ')} but expected []!!`);
      assert.deepStrictEqual(complexTypes, [], `'complexTypes' is ${JSON.stringify(complexTypes, null, ' ')} but expected []!!`);

      //check version and fuzziness
      assert.equal(version, DD_2_0, `'${version}' does not match version specified: '${DD_2_0}'`);
      assert.equal(fuzziness, TEST_FUZZINESS, `'${fuzziness}' does not match version specified: '${TEST_FUZZINESS}'`);
    } catch (err) {
      assert.ok(false, err);
    }
  });

  it(`Should have no variations flagged when using version ${DD_2_0} metadata with 100% fuzziness`, async () => {
    try {
      const MAX_FUZZINESS = 1.0;
      const metadataReportJson = await getReferenceMetadata(DD_2_0);

      const { description, version, generatedOn, fuzziness, variations } = await computeVariations({
        metadataReportJson,
        fuzziness: MAX_FUZZINESS,
        version: DD_2_0
      });

      assert.notEqual(description.length, 0);
      assert.notEqual(version.length, 0);
      assert.notEqual(generatedOn.length, 0);

      //check that the variations object is present and has values
      assert.equal(!!Object.keys(variations).length, true);

      const { resources, fields, lookups, expansions, complexTypes } = variations;

      assert.deepStrictEqual(resources, [], '"resources" is non-empty but expected []!');
      assert.deepStrictEqual(fields, [], '"fields" is non-empty but expected []!!');
      assert.deepStrictEqual(lookups, [], '"lookups" is non-empty but expected []!!');
      assert.deepStrictEqual(expansions, [], '"expansions" is non-empty but expected []!!');
      assert.deepStrictEqual(complexTypes, [], '"complexTypes" is non-empty but expected []!!');

      assert.equal(fuzziness, MAX_FUZZINESS, `Expected fuzziness to be 1.0 but was: ${fuzziness}`);
    } catch (err) {
      assert.ok(false, err?.message);
    }
  });

  it(`Should identify known ${DD_2_0} resources when the variation is lowercase with non-alphanumeric noise`, async () => {
    const metadataReportJson = await getReferenceMetadata(DD_2_0);

    const processedResources = new Set();

    for await (const { resourceName, fieldName } of Object.values(metadataReportJson.fields)) {
      if (!processedResources.has(resourceName)) {
        const testMetadataReportJson = {
          fields: [
            {
              resourceName: intersperseNonAlphaNumericNoise(resourceName?.toLowerCase()),
              fieldName
            }
          ]
        };

        const { variations } = await computeVariations({ metadataReportJson: testMetadataReportJson, version: DD_2_0 });

        assert.equal(
          variations.resources.length,
          1,
          'Exactly one resource name should have matched! Variations: ' + JSON.stringify(variations, null, ' ')
        );
        assert.equal(variations.resourceName, testMetadataReportJson.resourceName);

        assert.equal(
          variations.resources[0].suggestions.some(x => x?.suggestedResourceName === resourceName),
          true,
          `Match for resource '${resourceName}' not found in suggestions!`
        );

        processedResources.add(resourceName);
      }
    }
  });

  it(`Should identify known ${DD_2_0} fields when the variation is lowercase with non-alphanumeric noise`, async () => {
    const metadataReportJson = await getReferenceMetadata(DD_2_0);

    const testMetadataReportJson = Object.values(metadataReportJson?.fields ?? []).reduce(
      (acc, { resourceName, fieldName, isExpansion }) => {
        if (isExpansion) return acc;

        acc.fields.push({ resourceName, fieldName: intersperseNonAlphaNumericNoise(fieldName?.toLowerCase()) });
        return acc;
      },
      { fields: [] }
    );

    const { variations = [] } = await computeVariations({ metadataReportJson: testMetadataReportJson, version: DD_2_0 });

    const { fields: metadataReportFields = [] } = metadataReportJson,
      { fields: fieldVariations = [] } = variations;

    //items are concatenated for comparisons
    const metadataReportFieldsSet = new Set(
      metadataReportFields.flatMap(({ resourceName, fieldName, isExpansion = false }) => {
        if (isExpansion) return [];
        return `${resourceName}${fieldName}`;
      })
    );

    const unmatchedItems = fieldVariations.flatMap(({ resourceName, fieldName, suggestions = [] }) => {
      if (suggestions.some(({ suggestedFieldName }) => metadataReportFieldsSet.has(`${resourceName}${suggestedFieldName}`))) {
        return [];
      } else {
        return {
          resourceName,
          fieldName
        };
      }
    });

    assert.equal(unmatchedItems?.length, 0, 'Each field should have been matched to at least one match in the reference metadata!');

    const noExactMatches = fieldVariations.flatMap(({ resourceName, fieldName, suggestions = [] }) => {
      if (suggestions.some(x => x?.exactMatch)) {
        return [];
      } else {
        return {
          resourceName,
          fieldName
        };
      }
    });

    assert.equal(noExactMatches.length, 0, 'Every item in the reference set should have matched exactly to one item in the suggestions!');
  });

  describe('Variations Service special test cases - fields', async () => {
    it('Should identify known fields as a close match when an item is one character different', async () => {
      //close matches
      const metadataReportJson = {
        fields: [
          {
            resourceName: 'Property',
            fieldName: 'ListtPrice'
          },
          {
            resourceName: 'Property',
            fieldName: 'CancelationDate'
          },
          {
            resourceName: 'Office',
            fieldName: 'MoodificationTimestamp'
          },
          {
            resourceName: 'Member',
            fieldName: 'MemmberEmail'
          }
        ]
      };

      const { variations = [] } = await computeVariations({ metadataReportJson });

      const { fields: fieldVariations = [] } = variations;

      const noCloseMatches = fieldVariations.flatMap(({ resourceName, fieldName, suggestions = [] }) => {
        if (suggestions.some(x => x?.closeMatch)) {
          return [];
        } else {
          return {
            resourceName,
            fieldName
          };
        }
      });

      assert.equal(noCloseMatches.length, 0, 'Every item should have a close match!');
      assert.equal(fieldVariations?.length, metadataReportJson?.fields?.length, 'All items should have been matched!');
    });

    it('Should suggest standard fields if not already present in the metadata', async () => {
      const localTestFieldName = 'APIModificationTimestamp',
        standardTestFieldName = 'ModificationTimestamp';

      //close matches
      const metadataReportJson = {
        fields: [
          {
            resourceName: 'Property',
            fieldName: localTestFieldName
          }
        ]
      };

      const { variations = [] } = await computeVariations({ metadataReportJson });

      const { fields: fieldVariations = [] } = variations;

      const testItems = fieldVariations.filter(item => item?.fieldName === localTestFieldName);

      //ensure there is exactly one match and no duplication of items
      assert.equal(testItems?.length, 1, `There should be one suggestion for '${localTestFieldName}'!`);

      //the suggestion should contain the standard field
      assert.equal(
        testItems[0]?.suggestions?.some(suggestion => suggestion?.suggestedFieldName === standardTestFieldName),
        true,
        `Suggestion for standard field '${standardTestFieldName}' must be present in the suggestions!`
      );
    });

    it('Should not suggest standard fields if already present in the metadata', async () => {
      const localTestFieldName = 'APIModificationTimestamp',
        standardTestFieldName = 'ModificationTimestamp';

      //close matches
      const metadataReportJson = {
        fields: [
          {
            resourceName: 'Property',
            fieldName: localTestFieldName
          },
          {
            resourceName: 'Property',
            fieldName: standardTestFieldName
          }
        ]
      };

      const { variations = [] } = await computeVariations({ metadataReportJson });

      const { fields: fieldVariations = [] } = variations;

      const testItems = fieldVariations.filter(item => item?.fieldName === localTestFieldName);

      //ensure there is exactly one match and no duplication of items
      assert.equal(
        testItems?.length,
        0,
        `There should be no suggestions for '${localTestFieldName}' with the standard field '${standardTestFieldName}' present!`
      );
    });

    it('Should not suggest standard fields if already present in the metadata - multiple suggestions', async () => {
      const localTestFieldName = 'Price',
        standardTestFieldName = 'ListPrice';

      //close matches
      const metadataReportJson = {
        fields: [
          {
            resourceName: 'Property',
            fieldName: localTestFieldName
          },
          {
            resourceName: 'Property',
            fieldName: standardTestFieldName
          }
        ]
      };

      const { variations = [] } = await computeVariations({ metadataReportJson });

      const { fields: fieldVariations = [] } = variations;

      const testItems = fieldVariations.filter(item => item?.fieldName === localTestFieldName);

      //ensure there is exactly one match and no duplication of items
      assert.equal(testItems?.length, 1, `There should be exactly one element with fieldName '${localTestFieldName}'`);

      const [testItem] = testItems;

      //ensure that there was at least one suggestion
      assert.equal(testItem.suggestions?.length > 0, true, 'There should be at least one suggestion!');

      //ensure that the existing standard field does not show up in the suggestions
      assert.equal(
        testItem.suggestions.some(suggestion => suggestion?.suggestedFieldName === standardTestFieldName),
        false,
        `Suggestions should not contain the test standard field name '${standardTestFieldName}'`
      );
    });
  });
});

describe('Variations Service suggestion tests', () => {
  it('Should flag resource suggestions when they are found in the metadata', async () => {
    const suggestionsMap = {
      LocalProperty: {
        suggestions: [
          {
            suggestedResourceName: 'Property'
          }
        ]
      }
    };

    const metadataReportJson = {
      fields: [
        {
          resourceName: 'LocalProperty',
          fieldName: 'ohai'
        }
      ]
    };

    const {
      variations: { resources = [], fields = [], lookups = [] }
    } = await computeVariations({ metadataReportJson, suggestionsMap });

    assert.equal(resources.length, 1, 'There should be exactly one resource suggestion');
    assert.equal(fields?.length, 0, 'No fields should be flagged when there are no suggestions');
    assert.equal(lookups?.length, 0, 'No lookups should be flagged when there are no suggestions');

    const [{ resourceName, suggestions }, ...rest] = resources;

    assert.equal(rest?.length, 0, 'There should only be one resource');
    assert.equal(resourceName, 'LocalProperty', '"LocalProperty" Resource should be flagged');
    assert.equal(suggestions?.length, 1, 'There should be exactly one suggestion');

    const [{ suggestedResourceName, strategy }, ...remainingSuggestions] = suggestions;

    assert.equal(suggestedResourceName, 'Property', '"LocalProperty" should be a suggestion for "Property"');
    assert.equal(strategy, 'Suggestion', `Strategy should be "Suggestion" but found "${strategy}"`);
    assert.equal(remainingSuggestions?.length, 0, 'There should be no remaining suggestions');
  });

  it('Should not flag resource suggestions when they are found in the metadata and the standard resource exists', async () => {
    const suggestionsMap = {
      LocalProperty: {
        suggestions: [
          {
            suggestedResourceName: 'Property'
          }
        ]
      }
    };

    const metadataReportJson = {
      fields: [
        {
          resourceName: 'Property',
          fieldName: 'ohai'
        },
        {
          resourceName: 'LocalProperty',
          fieldName: 'ohai'
        }
      ]
    };

    const {
      variations: { resources = [], fields = [], lookups = [] }
    } = await computeVariations({ metadataReportJson, suggestionsMap });

    assert.equal(resources.length, 0, 'There should be no resource suggestions');
    assert.equal(fields?.length, 0, 'No fields should be flagged when there are no suggestions');
    assert.equal(lookups?.length, 0, 'No lookups should be flagged when there are no suggestions');
  });

  it('Should flag field suggestions when they are found in the metadata', async () => {
    const suggestionsMap = {
      Property: {
        Price: {
          suggestions: [
            {
              suggestedResourceName: 'Property',
              suggestedFieldName: 'ListPrice'
            }
          ]
        }
      }
    };

    const metadataReportJson = {
      fields: [
        {
          resourceName: 'Property',
          fieldName: 'Price'
        }
      ]
    };

    const {
      variations: { resources = [], fields = [], lookups = [] }
    } = await computeVariations({ metadataReportJson, suggestionsMap });

    assert.equal(resources?.length, 0, 'No resources should be flagged when there are no suggestions');
    assert.equal(fields?.length, 1, 'There should be exactly one field suggestion');
    assert.equal(lookups?.length, 0, 'No lookups should be flagged when there are no suggestions');

    const [{ resourceName, fieldName, suggestions }, ...rest] = fields;

    assert.equal(resourceName, 'Property', 'The field should be flagged in the "Property" Resource');
    assert.equal(fieldName, 'Price', 'The flagged field name should be "Price"');
    assert.equal(rest?.length, 0, 'There should be no other field suggestions');

    const [{ suggestedResourceName, suggestedFieldName, strategy }, ...remainingSuggestions] = suggestions;

    assert.equal(suggestedResourceName, 'Property', 'The suggested resource name should be "Property"');
    assert.equal(suggestedFieldName, 'ListPrice', '"ListPrice" should be suggested for "Price"');
    assert.equal(strategy, 'Suggestion', 'Strategy should be "Suggestion"');
    assert.equal(remainingSuggestions?.length, 0, 'There should be no remaining suggestions');
  });

  it('Should not flag field suggestions when they are found in the metadata and the standard field exists', async () => {
    const suggestionsMap = {
      Property: {
        Price: {
          suggestions: [
            {
              suggestedResourceName: 'Property',
              suggestedFieldName: 'ListPrice'
            }
          ]
        }
      }
    };

    const metadataReportJson = {
      fields: [
        {
          resourceName: 'Property',
          fieldName: 'Price'
        },
        {
          resourceName: 'Property',
          fieldName: 'ListPrice'
        }
      ]
    };

    const {
      variations: { resources = [], fields = [], lookups = [] }
    } = await computeVariations({ metadataReportJson, suggestionsMap });

    assert.equal(resources?.length, 0, 'No resources should be flagged when there are no suggestions');
    assert.equal(fields?.length, 0, 'No fields should be flagged when there are suggestions for an existing item');
    assert.equal(lookups?.length, 0, 'No lookups should be flagged when there are no suggestions');
  });

  it('Should flag lookup value suggestions when they are found in the metadata', async () => {
    const suggestionsMap = {
      Property: {
        StandardStatus: {
          'Active UC': {
            suggestions: [
              {
                suggestedResourceName: 'Property',
                suggestedFieldName: 'StandardStatus',
                suggestedLookupValue: 'Active Under Contract'
              }
            ]
          }
        }
      }
    };

    const metadataReportJson = {
      fields: [
        {
          resourceName: 'Property',
          fieldName: 'StandardStatus',
          type: 'StandardStatusLookups'
        }
      ],
      lookups: [
        {
          lookupName: 'StandardStatusLookups',
          type: 'Edm.String',
          lookupValue: 'Active UC'
        }
      ]
    };

    const {
      variations: { resources = [], fields = [], lookups = [] }
    } = await computeVariations({ metadataReportJson, suggestionsMap });

    assert.equal(resources?.length, 0, 'No resources should be flagged when there are no suggestions');
    assert.equal(fields?.length, 0, 'No field should be flagged when there are no suggestions');
    assert.equal(lookups?.length, 1, 'There should be exactly one lookup suggestion');

    const [{ resourceName, fieldName, legacyODataValue, lookupValue, suggestions }, ...rest] = lookups;

    assert.equal(resourceName, 'Property', 'The field should be flagged in the "Property" Resource');
    assert.equal(fieldName, 'StandardStatus', 'The flagged field name should be "StandardStatus"');
    assert.equal(lookupValue, 'Active UC', 'The flagged field name should be "Active UC"');
    assert.equal(!legacyODataValue, true, 'There should be no legacyODataValue');
    assert.equal(rest?.length, 0, 'There should be no other lookup suggestions');

    const [
      { suggestedResourceName, suggestedFieldName, suggestedLookupValue, suggestedLegacyODataValue, strategy },
      ...remainingSuggestions
    ] = suggestions;

    assert.equal(suggestedResourceName, 'Property', 'The suggested resource name should be "Property"');
    assert.equal(suggestedFieldName, 'StandardStatus', 'The suggested field name should be "StandardStatus"');
    assert.equal(suggestedLookupValue, 'Active Under Contract', 'The suggested lookup value should be "Active Under Contract"');
    assert.equal(!suggestedLegacyODataValue, true, 'There should be no suggested legacy OData value');
    assert.equal(strategy, 'Suggestion', 'Strategy should be "Suggestion"');
    assert.equal(remainingSuggestions?.length, 0, 'There should be no remaining suggestions');
  });

  it('Should not flag lookup value suggestions when they are found in the metadata and the standard lookup value exists', async () => {
    const suggestionsMap = {
      Property: {
        ExteriorFeatures: {
          Grill: {
            suggestions: [
              {
                suggestedResourceName: 'Property',
                suggestedFieldName: 'ExteriorFeatures',
                suggestedLookupValue: 'Gas Grill'
              }
            ]
          }
        }
      }
    };

    const metadataReportJson = {
      fields: [
        {
          resourceName: 'Property',
          fieldName: 'ExteriorFeatures',
          type: 'ExteriorFeatures'
        }
      ],
      lookups: [
        {
          lookupName: 'ExteriorFeatures',
          type: 'Edm.String',
          lookupValue: 'Gas Grill'
        },
        {
          lookupName: 'ExteriorFeatures',
          type: 'Edm.String',
          lookupValue: 'Grill'
        }
      ]
    };

    const {
      variations: { resources = [], fields = [], lookups = [] }
    } = await computeVariations({ metadataReportJson, suggestionsMap });

    assert.equal(resources?.length, 0, 'No resources should be flagged when there are no suggestions');
    assert.equal(fields?.length, 0, 'No fields should be flagged when there are no suggestions');
    assert.equal(lookups?.length, 0, 'No lookups should be flagged when there are suggestions but the standard lookup value exists');
  });

  it('Should flag legacyODataValue suggestions when they are found in the metadata', async () => {
    const suggestionsMap = {
      Property: {
        ExteriorFeatures: {
          Grill: {
            suggestions: [
              {
                suggestedResourceName: 'Property',
                suggestedFieldName: 'ExteriorFeatures',
                suggestedLegacyODataValue: 'GasGrill'
              }
            ]
          }
        }
      }
    };

    const metadataReportJson = {
      fields: [
        {
          resourceName: 'Property',
          fieldName: 'ExteriorFeatures',
          type: 'ExteriorFeaturesLookups.ExteriorFeatures'
        }
      ],
      lookups: [
        {
          lookupName: 'ExteriorFeaturesLookups.ExteriorFeatures',
          type: 'Edm.Int64',
          lookupValue: 'Grill'
        }
      ]
    };

    const {
      variations: { resources = [], fields = [], lookups = [] }
    } = await computeVariations({ metadataReportJson, suggestionsMap });

    assert.equal(resources?.length, 0, 'No resources should be flagged when there are no suggestions');
    assert.equal(fields?.length, 0, 'No field should be flagged when there are no suggestions');
    assert.equal(lookups?.length, 1, 'There should be exactly one lookup suggestion');

    const [{ resourceName, fieldName, legacyODataValue, lookupValue, suggestions }, ...rest] = lookups;

    assert.equal(resourceName, 'Property', 'The field should be flagged in the "Property" Resource');
    assert.equal(fieldName, 'ExteriorFeatures', 'The flagged field name should be "StandardStatus"');
    assert.equal(legacyODataValue, 'Grill', 'The flagged legacyODataValue should be "Grill"');
    assert.equal(!lookupValue, true, 'There should be no legacyODataValue');
    assert.equal(rest?.length, 0, 'There should be no other lookup suggestions');

    const [
      { suggestedResourceName, suggestedFieldName, suggestedLookupValue, suggestedLegacyODataValue, strategy },
      ...remainingSuggestions
    ] = suggestions;

    assert.equal(suggestedResourceName, 'Property', 'The suggested resource name should be "Property"');
    assert.equal(suggestedFieldName, 'ExteriorFeatures', 'The suggested field name should be "StandardStatus"');
    assert.equal(suggestedLegacyODataValue, 'GasGrill', 'The suggested lookup value should be "GasGrill"');
    assert.equal(!suggestedLookupValue, true, 'There should be no suggested lookup value');
    assert.equal(strategy, 'Suggestion', 'Strategy should be "Suggestion"');
    assert.equal(remainingSuggestions?.length, 0, 'There should be no remaining suggestions');
  });

  it('Should not flag lookup value suggestions when they are found in the metadata and the standard lookup value exists', async () => {
    const suggestionsMap = {
      Property: {
        ExteriorFeatures: {
          Grill: {
            suggestions: [
              {
                suggestedResourceName: 'Property',
                suggestedFieldName: 'ExteriorFeatures',
                suggestedLookupValue: 'Gas Grill'
              }
            ]
          }
        }
      }
    };

    const metadataReportJson = {
      fields: [
        {
          resourceName: 'Property',
          fieldName: 'ExteriorFeatures',
          type: 'ExteriorFeatures'
        }
      ],
      lookups: [
        {
          lookupName: 'ExteriorFeatures',
          type: 'Edm.String',
          lookupValue: 'Gas Grill'
        },
        {
          lookupName: 'ExteriorFeatures',
          type: 'Edm.String',
          lookupValue: 'Grill'
        }
      ]
    };

    const {
      variations: { resources = [], fields = [], lookups = [] }
    } = await computeVariations({ metadataReportJson, suggestionsMap });

    assert.equal(resources?.length, 0, 'No resources should be flagged when there are no suggestions');
    assert.equal(fields?.length, 0, 'No fields should be flagged when there are no suggestions');
    assert.equal(lookups?.length, 0, 'No lookups should be flagged when there are suggestions but the standard lookup value exists');
  });

  it('Should not suggest lookup values that are less than the minimum matching length when using machine matching', async () => {
    const metadataReportJson = {
      fields: [
        {
          resourceName: 'Property',
          fieldName: 'StateOrProvince',
          type: 'StateOrProvince'
        }
      ],
      lookups: [
        {
          lookupName: 'StateOrProvince',
          type: 'Edm.String',
          lookupValue: 'California'
        }
      ]
    };

    const {
      variations: { resources = [], fields = [], lookups = [] }
    } = await computeVariations({ metadataReportJson });

    assert.equal(resources?.length, 0, 'No resources should be flagged');
    assert.equal(fields?.length, 0, 'No fields should be flagged');
    assert.equal(lookups?.length, 0, 'No lookups should be flagged');
  });

  it('Should not flag ignored resources', async () => {
    const metadataReportJson = {
      fields: [{
        resourceName: 'Offices',
        fieldName: 'ModificationTimestamp',
        type: 'Edm.DateTimeOffset'
      }],
      lookups: []
    };

    const suggestionsMap = {
      Offices: {
        ignored: true
      }
    };

    const {
      variations: { resources = [], fields = [], lookups = [] }
    } = await computeVariations({ metadataReportJson, suggestionsMap });

    assert.equal(resources?.length, 0, 'No resources should be flagged');
    assert.equal(fields?.length, 0, 'No fields should be flagged');
    assert.equal(lookups?.length, 0, 'No lookups should be flagged');
  });

  it('Should not flag ignored fields', async () => {
    const metadataReportJson = {
      fields: [{
        resourceName: 'Property',
        fieldName: 'ListPrices',
        type: 'Edm.Decimal'
      }],
      lookups: []
    };

    const suggestionsMap = {
      Property: {
        ListPrices: {
          ignored: true
        }
      }
    };

    const {
      variations: { resources = [], fields = [], lookups = [] }
    } = await computeVariations({ metadataReportJson, suggestionsMap });

    assert.equal(resources?.length, 0, 'No resources should be flagged');
    assert.equal(fields?.length, 0, 'No fields should be flagged');
    assert.equal(lookups?.length, 0, 'No lookups should be flagged');
  });

  it('Should not flag ignored enumerations', async () => {
    const metadataReportJson = {
      fields: [{
        resourceName: 'Property',
        fieldName: 'ArchitecturalStyle',
        type: 'ArchitecturalStyles'
      }],
      lookups: [{
        lookupName: 'ArchitecturalStyles',
        lookupValue: 'Ranch/1 Story',
        type: 'Edm.String'
      }, {
        lookupName: 'ArchitecturalStyles',
        lookupValue: 'BsmtRanch',
        type: 'Edm.String'
      }]
    };

    const suggestionsMap = {
      Property: {
        ArchitecturalStyle: {
          'Ranch/1 Story': { ignored: true },
          BsmtRanch: { ignored: true }
        }
      }
    };

    const {
      variations: { resources = [], fields = [], lookups = [] }
    } = await computeVariations({ metadataReportJson, suggestionsMap });

    assert.equal(resources?.length, 0, 'No resources should be flagged');
    assert.equal(fields?.length, 0, 'No fields should be flagged');
    assert.equal(lookups?.length, 0, 'No lookups should be flagged');
  });

  it('Should flag Fast Track resource suggestions when present', async () => {
    const metadataReportJson = {
      fields: [{
        resourceName: 'Offices',
        fieldName: 'ModificationTimestamp',
        type: 'Edm.DateTimeOffset'
      }],
      lookups: []
    };

    const suggestionsMap = {
      Offices: {
        suggestions: [{
          suggestedResourceName: 'Office',
          isFastTrack: true
        }]
      }
    };

    const {
      variations: { resources = [], fields = [], lookups = [] }
    } = await computeVariations({ metadataReportJson, suggestionsMap });

    assert.equal(resources?.length, 1, 'Exactly one resource should be flagged');
    assert.equal(resources?.[0]?.suggestions?.[0].strategy, MATCHING_STRATEGIES.FAST_TRACK, 'Matching strategy should be Fast Track');
    assert.equal(fields?.length, 0, 'No fields should be flagged');
    assert.equal(lookups?.length, 0, 'No lookups should be flagged');
  });

  it('Should flag Fast Track field suggestions when present', async () => {
    const metadataReportJson = {
      fields: [{
        resourceName: 'Property',
        fieldName: 'ListPrices',
        type: 'Edm.Decimal'
      }],
      lookups: []
    };

    const suggestionsMap = {
      Property: {
        ListPrices: {
          suggestions: [{
            suggestedResourceName: 'Property',
            suggestedFieldName: 'ListPrice',
            isFastTrack: true
          }]
        }
      }
    };

    const {
      variations: { resources = [], fields = [], lookups = [] }
    } = await computeVariations({ metadataReportJson, suggestionsMap });

    assert.equal(resources?.length, 0, 'No resources should be flagged');
    assert.equal(fields?.length, 1, 'Exactly one field should be flagged');
    assert.equal(fields?.[0]?.suggestions?.[0].strategy, MATCHING_STRATEGIES.FAST_TRACK, 'Matching strategy should be Fast Track');
    assert.equal(lookups?.length, 0, 'No lookups should be flagged');
  });

  it('Should flag Fast Track enumerations when present', async () => {
    const metadataReportJson = {
      fields: [{
        resourceName: 'Property',
        fieldName: 'ArchitecturalStyle',
        type: 'ArchitecturalStyles'
      }],
      lookups: [{
        lookupName: 'ArchitecturalStyles',
        lookupValue: 'Ranch/1 Story',
        type: 'Edm.String'
      }]
    };

    const suggestionsMap = {
      Property: {
        ArchitecturalStyle: {
          'Ranch/1 Story': {
            suggestions: [{
              suggestedResourceName: 'Property',
              suggestedFieldName: 'ArchitecturalStyle',
              suggestedLookupValue: 'Ranch',
              isFastTrack: true
            }]
          }
        }
      }
    };

    const {
      variations: { resources = [], fields = [], lookups = [] }
    } = await computeVariations({ metadataReportJson, suggestionsMap });

    assert.equal(resources?.length, 0, 'No resources should be flagged');
    assert.equal(fields?.length, 0, 'No fields should be flagged');
    assert.equal(lookups?.length, 1, 'Exactly one lookup should be flagged');
    assert.equal(lookups?.[0]?.suggestions?.[0].strategy, MATCHING_STRATEGIES.FAST_TRACK, 'Matching strategy should be Fast Track');
  });

  it('Should flag Admin resource suggestions when present', async () => {
    const metadataReportJson = {
      fields: [{
        resourceName: 'Offices',
        fieldName: 'ModificationTimestamp',
        type: 'Edm.DateTimeOffset'
      }],
      lookups: []
    };

    const suggestionsMap = {
      Offices: {
        suggestions: [{
          suggestedResourceName: 'Office',
          isAdminReview: true
        }]
      }
    };

    const {
      variations: { resources = [], fields = [], lookups = [] }
    } = await computeVariations({ metadataReportJson, suggestionsMap });

    assert.equal(resources?.length, 1, 'Exactly one resource should be flagged');
    assert.equal(resources?.[0]?.suggestions?.[0].strategy, MATCHING_STRATEGIES.ADMIN_REVIEW, 'Matching strategy should be Fast Track');
    assert.equal(fields?.length, 0, 'No fields should be flagged');
    assert.equal(lookups?.length, 0, 'No lookups should be flagged');
  });

  it('Should flag Admin field suggestions when present', async () => {
    const metadataReportJson = {
      fields: [{
        resourceName: 'Property',
        fieldName: 'ListPrices',
        type: 'Edm.Decimal'
      }],
      lookups: []
    };

    const suggestionsMap = {
      Property: {
        ListPrices: {
          suggestions: [{
            suggestedResourceName: 'Property',
            suggestedFieldName: 'ListPrice',
            isAdminReview: true
          }]
        }
      }
    };

    const {
      variations: { resources = [], fields = [], lookups = [] }
    } = await computeVariations({ metadataReportJson, suggestionsMap });

    assert.equal(resources?.length, 0, 'No resources should be flagged');
    assert.equal(fields?.length, 1, 'Exactly one field should be flagged');
    assert.equal(fields?.[0]?.suggestions?.[0].strategy, MATCHING_STRATEGIES.ADMIN_REVIEW, 'Matching strategy should be Fast Track');
    assert.equal(lookups?.length, 0, 'No lookups should be flagged');
  });

  it('Should flag Admin lookup suggestions when present', async () => {
    const metadataReportJson = {
      fields: [{
        resourceName: 'Property',
        fieldName: 'ArchitecturalStyle',
        type: 'ArchitecturalStyles'
      }],
      lookups: [{
        lookupName: 'ArchitecturalStyles',
        lookupValue: 'Ranch/1 Story',
        type: 'Edm.String'
      }]
    };

    const suggestionsMap = {
      Property: {
        ArchitecturalStyle: {
          'Ranch/1 Story': {
            suggestions: [{
              suggestedResourceName: 'Property',
              suggestedFieldName: 'ArchitecturalStyle',
              suggestedLookupValue: 'Ranch',
              isAdminReview: true
            }]
          }
        }
      }
    };

    const {
      variations: { resources = [], fields = [], lookups = [] }
    } = await computeVariations({ metadataReportJson, suggestionsMap });

    assert.equal(resources?.length, 0, 'No resources should be flagged');
    assert.equal(fields?.length, 0, 'No fields should be flagged');
    assert.equal(lookups?.length, 1, 'Exactly one lookup should be flagged');
    assert.equal(lookups?.[0]?.suggestions?.[0].strategy, MATCHING_STRATEGIES.ADMIN_REVIEW, 'Matching strategy should be Fast Track');
  });
});
