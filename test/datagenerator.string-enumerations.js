'use strict';

const assert = require('assert');
const { generateRcfData } = require('../lib/datagenerator');

const metadataReportJson = {
  fields: [
    {
      resourceName: 'Property',
      fieldName: 'ListingKey',
      type: 'Edm.String'
    },
    {
      resourceName: 'Property',
      fieldName: 'StandardStatus',
      type: 'Edm.String'
    },
    {
      resourceName: 'Property',
      fieldName: 'BedroomsTotal',
      type: 'Edm.Int32',
      nullable: true
    },
    {
      resourceName: 'Property',
      fieldName: 'ListPrice',
      type: 'Edm.Decimal',
      isCollection: true,
      scale: 2,
      precision: 14,
      nullable: true,
      isCollection: false
    },
    {
      resourceName: 'Property',
      fieldName: 'InteriorFeatures',
      type: 'Edm.String',
      isCollection: true
    },
    {
      resourceName: 'Property',
      fieldName: 'Media',
      type: 'Media',
      isExpansion: true
    },
    {
      resourceName: 'Property',
      fieldName: 'ModificationTimestamp',
      type: 'Edm.DateTimeOffset'
    }
  ],
  lookups: []
};

describe('Data Generator Tests - String Enumerations', () => {
  it('Should generate one valid record for one resourceName parameter without expansions', async () => {

    const TEST_RESOURCE_NAME = 'Property';

    const data = await generateRcfData({ resources: [TEST_RESOURCE_NAME], metadataReportJson });

    if (!data) assert.fail;

    assert(Array.isArray(data?.[TEST_RESOURCE_NAME]) && data?.[TEST_RESOURCE_NAME]?.length === 1);
  });
});
