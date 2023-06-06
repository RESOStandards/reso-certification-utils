'use strict';

const assert = require('assert');
const { computeVariations } = require('../index.js');
const { getReferenceMetadata } = require('../utils/misc/index.js');

const TEST_FUZZINESS = 0.25,
  DD_1_7 = '1.7', DD_2_0 = '2.0',
  DEFAULT_VERSION = DD_1_7;

describe('findVariations', () => {
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

      assert.deepStrictEqual(resources, [], `'resources' is non-empty but expected []!`);
      assert.deepStrictEqual(fields, [], `'fields' is non-empty but expected []!!`);
      assert.deepStrictEqual(lookups, [], `'lookups' is non-empty but expected []!!`);
      assert.deepStrictEqual(expansions, [], `'expansions' is non-empty but expected []!!`);
      assert.deepStrictEqual(complexTypes, [], `'complexTypes' is non-empty but expected []!!`);

      //check version and fuzziness
      assert.equal(version, DEFAULT_VERSION, `'${version}' does not match version specified: '${DEFAULT_VERSION}'`);
      assert.equal(fuzziness, TEST_FUZZINESS, `'${fuzziness}' does not match version specified: '${TEST_FUZZINESS}'`);
    } catch (err) {
      assert.ok(false, err?.message);
    }
  });

  it(`Should have no variations flagged when using the reference metadata for version ${DD_1_7}`, async () => {
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

      assert.deepStrictEqual(resources, [], `'resources' is non-empty but expected []!`);
      assert.deepStrictEqual(fields, [], `'fields' is non-empty but expected []!!`);
      assert.deepStrictEqual(lookups, [], `'lookups' is non-empty but expected []!!`);
      assert.deepStrictEqual(expansions, [], `'expansions' is non-empty but expected []!!`);
      assert.deepStrictEqual(complexTypes, [], `'complexTypes' is non-empty but expected []!!`);

      //check version and fuzziness
      assert.equal(version, DD_1_7, `Version '${version}' does not match version specified: '${DD_1_7}'`);
      assert.equal(fuzziness, TEST_FUZZINESS, `Fuzziness '${fuzziness}' does not match fuzziness specified: '${TEST_FUZZINESS}'`);
    } catch (err) {
      assert.ok(false, err?.message);
    }
  });

  it(`Should have no variations flagged when using the reference metadata for version ${DD_2_0}`, async () => {
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
});
