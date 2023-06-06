'use strict';

const assert = require('assert');
const { computeVariations } = require('../index.js');
const { getReferenceMetadata } = require('../utils/misc/index.js');

const TEST_FUZZINESS = 0.25,
  DD_1_7 = '1.7',
  DD_2_0 = '2.0',
  DEFAULT_VERSION = DD_1_7;

describe('computeVariations reference metadata checks', () => {
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

  it(`Should identify known ${DD_1_7} resources when the variation is lowercase`, async () => {
    const metadataReportJson = await getReferenceMetadata(DD_1_7);

    const processedResources = new Set();

    for await (const { resourceName, fieldName } of Object.values(metadataReportJson.fields)) {
      if (!processedResources.has(resourceName)) {
        const testMetadataReportJson = {
          fields: [
            {
              resourceName: resourceName?.toLowerCase(),
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

  it(`Should identify known ${DD_2_0} resources when the variation is lowercase`, async () => {
    const metadataReportJson = await getReferenceMetadata(DD_2_0);

    const processedResources = new Set();

    for await (const { resourceName, fieldName } of Object.values(metadataReportJson.fields)) {
      if (!processedResources.has(resourceName)) {
        const testMetadataReportJson = {
          fields: [
            {
              resourceName: resourceName?.toLowerCase(),
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
});
