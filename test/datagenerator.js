'use strict';

const assert = require('assert');
const { generateRcfData } = require('../lib/datagenerator');

const metadataNoLookups = require('./datagenerator/metadata-empty-lookup-data.json'),
  metadataWithStringLookups = require('./datagenerator/metadata-string-enumerations.json');

describe('Data Generator Tests - String Enumerations', () => {
  it('Should generate one valid record for one resourceName parameter without expansions', async () => {
    const TEST_RESOURCE_NAME = 'Property';

    [metadataNoLookups, metadataWithStringLookups].forEach(async metadataReportJson => {
      const data = await generateRcfData({ resources: [TEST_RESOURCE_NAME], metadataReportJson });

      if (!data || !Object.keys(data)?.length) {
        assert.fail('Data generator returned no records whin there should have been ');
      }

      assert(Array.isArray(data?.[TEST_RESOURCE_NAME]) && data?.[TEST_RESOURCE_NAME]?.length === 1);
    });
  });
});
