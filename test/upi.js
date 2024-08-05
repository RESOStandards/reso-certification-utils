'use strict';

const assert = require('assert');
const { parseUpi, runUpiTests } = require('../index.js');

const KNOWN_GOOD_UPI = 'urn:reso:upi:2.0:US:48201:12345 parcel number',
  KNOWN_GOOD_UPI_WITH_SUBCOMPONENT = `${KNOWN_GOOD_UPI}:sub:test parcel subcomponent`;

describe('UPI Parsing Tests', () => {
  it('Should have required properties with a known-good UPI', async () => {
    assert.ok(parseUpi(KNOWN_GOOD_UPI));
  });

  it('Should have required properties with a known-good UPI with Parcel Subcomponent', async () => {
    assert.ok(parseUpi(KNOWN_GOOD_UPI_WITH_SUBCOMPONENT));
  });

  it('Should produce correct components when parsed with a known-good UPI', async () => {
    const { Country, CountrySubdivision, ParcelNumber, ParcelSubcomponent } = parseUpi(KNOWN_GOOD_UPI);

    assert(Country === 'US');
    assert(CountrySubdivision === '48201');
    assert(ParcelNumber === '12345 parcel number');
    assert(!ParcelSubcomponent);
  });

  it('Should produce correct components when parsed with a known-good UPI with Parcel Subcomponent', async () => {
    const { Country, CountrySubdivision, ParcelNumber, ParcelSubcomponent } = parseUpi(KNOWN_GOOD_UPI_WITH_SUBCOMPONENT);

    assert(Country === 'US');
    assert(CountrySubdivision === '48201');
    assert(ParcelNumber === '12345 parcel number');
    assert(ParcelSubcomponent === 'test parcel subcomponent');
  });
});

describe('UPI Validation Tests', () => {
  it('Should fail validation with an unknown country and country subdivision', async () => {
    const records = {
      '@reso.context': 'urn:reso:metadata:2.0:resource:property',
      value: [
        {
          UniversalParcelId: 'urn:reso:upi:2.0:UK:ABCDE:ohai',
          Country: 'UK',
          CountrySubdivision: 'ABCDE',
          ParcelNumber: 'ohai'
        }
      ]
    };

    const { errors = [] } = await runUpiTests({ resoCommonFormatJson: records });
    assert(errors && !!errors?.[0] && errors[0].error === 'Country \'UK\' is not supported for UPI version \'2.0\'!');
  });

  it('Should fail validation with an unknown country and known country subdivision', async () => {
    const records = {
      '@reso.context': 'urn:reso:metadata:2.0:resource:property',
      value: [
        {
          UniversalParcelId: 'urn:reso:upi:2.0:UK:48201:ohai',
          Country: 'UK',
          CountrySubdivision: '48201',
          ParcelNumber: 'ohai'
        }
      ]
    };

    const { errors = [] } = await runUpiTests({ resoCommonFormatJson: records });
    assert(errors && !!errors?.[0] && errors[0].error === 'Country \'UK\' is not supported for UPI version \'2.0\'!');
  });

  it('Should fail validation with an known country and unknown country subdivision', async () => {
    const records = {
      '@reso.context': 'urn:reso:metadata:2.0:resource:property',
      value: [
        {
          UniversalParcelId: 'urn:reso:upi:2.0:US:ABCDE:ohai',
          Country: 'US',
          CountrySubdivision: 'ABCDE',
          ParcelNumber: 'ohai'
        }
      ]
    };
    
    const { errors = [] } = await runUpiTests({ resoCommonFormatJson: records });
    assert(errors && !!errors?.[0] && errors[0].error === 'Invalid country subdivision \'ABCDE\'');
  });
});
