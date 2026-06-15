'use strict';

const assert = require('assert');
const { runUpiTests } = require('../lib/certification/upi');
const { parseUpi, validateCountrySubdivision, buildCountrySubdivisionCaches } = require('../lib/upi');

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

  it('Should return undefined ParcelSubcomponent when subcomponent is not present', () => {
    const { ParcelSubcomponent } = parseUpi(KNOWN_GOOD_UPI);
    assert.strictEqual(ParcelSubcomponent, undefined);
  });

  it('Should throw when given null', () => {
    assert.throws(() => parseUpi(null), /Incorrectly formatted UPI/);
  });

  it('Should throw when given undefined', () => {
    assert.throws(() => parseUpi(undefined), /Incorrectly formatted UPI/);
  });

  it('Should throw when given an empty string', () => {
    assert.throws(() => parseUpi(''), /Incorrectly formatted UPI/);
  });

  it('Should throw when given a string that does not start with urn:reso:upi', () => {
    assert.throws(() => parseUpi('not:a:valid:upi'), /Incorrectly formatted UPI/);
  });

  it('Should throw when given an unsupported UPI version', () => {
    assert.throws(() => parseUpi('urn:reso:upi:1.0:US:48201:parcel'), /UPI version of '1.0' is not supported/);
  });

  it('Should throw when CountrySubdivision is missing', () => {
    assert.throws(() => parseUpi('urn:reso:upi:2.0:US::parcel'), /CountrySubdivision is required/);
  });

  it('Should throw when ParcelNumber is missing', () => {
    assert.throws(() => parseUpi('urn:reso:upi:2.0:US:48201:'), /ParcelNumber is required/);
  });

  it('Should preserve special characters in ParcelNumber (dashes, dots, slashes)', () => {
    const { ParcelNumber } = parseUpi('urn:reso:upi:2.0:US:48201:R000022230-A/B.1#2');
    assert.strictEqual(ParcelNumber, 'R000022230-A/B.1#2');
  });

  it('Should preserve special characters in ParcelSubcomponent per spec example (78 - 9.aB)', () => {
    const { ParcelNumber, ParcelSubcomponent } = parseUpi('urn:reso:upi:2.0:US:48201:R000022230:sub:78 - 9.aB');
    assert.strictEqual(ParcelNumber, 'R000022230');
    assert.strictEqual(ParcelSubcomponent, '78 - 9.aB');
  });

  it('Should preserve capitalization in ParcelNumber', () => {
    const { ParcelNumber } = parseUpi('urn:reso:upi:2.0:US:48201:aAbBcC');
    assert.strictEqual(ParcelNumber, 'aAbBcC');
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

  it('Should throw when called with no arguments', async () => {
    await assert.rejects(runUpiTests(), /One of resoCommonFormatJson or pathToResoCommonFormatJson are required/);
  });

  it('Should fail validation when ParcelNumber in the payload does not match the UPI', async () => {
    const records = {
      '@reso.context': 'urn:reso:metadata:2.0:resource:property',
      value: [
        {
          UniversalParcelId: KNOWN_GOOD_UPI,
          Country: 'US',
          CountrySubdivision: '48201',
          ParcelNumber: 'different parcel number'
        }
      ]
    };

    const { errors = [] } = await runUpiTests({ resoCommonFormatJson: records });
    assert(errors?.some(e => e.error === 'Parsed UPI mismatch with UPI data'));
  });

  it('Should pass validation with a known-good UPI and matching ParcelNumber in the payload', async () => {
    const records = {
      '@reso.context': 'urn:reso:metadata:2.0:resource:property',
      value: [
        {
          UniversalParcelId: KNOWN_GOOD_UPI,
          Country: 'US',
          CountrySubdivision: '48201',
          ParcelNumber: '12345 parcel number'
        }
      ]
    };

    const result = await runUpiTests({ resoCommonFormatJson: records });
    assert(!result.errors && result.numValidRecords === 1);
  });

  it('Should pass validation for a single record not wrapped in a value array', async () => {
    const record = {
      '@reso.context': 'urn:reso:metadata:2.0:resource:property',
      UniversalParcelId: KNOWN_GOOD_UPI,
      Country: 'US',
      CountrySubdivision: '48201',
      ParcelNumber: '12345 parcel number'
    };

    const result = await runUpiTests({ resoCommonFormatJson: record });
    assert(!result.errors);
  });

  it('Should pass validation when ParcelNumber contains special characters and matches the UPI', async () => {
    const upi = 'urn:reso:upi:2.0:US:48201:R000022230-A/B.1#2';
    const records = {
      '@reso.context': 'urn:reso:metadata:2.0:resource:property',
      value: [
        {
          UniversalParcelId: upi,
          Country: 'US',
          CountrySubdivision: '48201',
          ParcelNumber: 'R000022230-A/B.1#2'
        }
      ]
    };

    const result = await runUpiTests({ resoCommonFormatJson: records });
    assert(!result.errors && result.numValidRecords === 1);
  });

  it('Should fail validation when Country in the payload does not match the UPI', async () => {
    const records = {
      '@reso.context': 'urn:reso:metadata:2.0:resource:property',
      value: [
        {
          UniversalParcelId: KNOWN_GOOD_UPI,
          Country: 'CA',
          CountrySubdivision: '48201',
          ParcelNumber: '12345 parcel number'
        }
      ]
    };

    const { errors = [] } = await runUpiTests({ resoCommonFormatJson: records });
    assert(errors?.some(e => e.error === 'Parsed UPI mismatch with UPI data'));
  });

  it('Should fail validation when CountrySubdivision in the payload does not match the UPI', async () => {
    const records = {
      '@reso.context': 'urn:reso:metadata:2.0:resource:property',
      value: [
        {
          UniversalParcelId: KNOWN_GOOD_UPI,
          Country: 'US',
          CountrySubdivision: '99999',
          ParcelNumber: '12345 parcel number'
        }
      ]
    };

    const { errors = [] } = await runUpiTests({ resoCommonFormatJson: records });
    assert(errors?.some(e => e.error === 'Parsed UPI mismatch with UPI data'));
  });

  it('Should report only the invalid records when processing a mix of valid and invalid records', async () => {
    const records = {
      '@reso.context': 'urn:reso:metadata:2.0:resource:property',
      value: [
        {
          UniversalParcelId: KNOWN_GOOD_UPI,
          Country: 'US',
          CountrySubdivision: '48201',
          ParcelNumber: '12345 parcel number'
        },
        {
          UniversalParcelId: 'urn:reso:upi:2.0:US:ABCDE:ohai',
          Country: 'US',
          CountrySubdivision: 'ABCDE',
          ParcelNumber: 'ohai'
        }
      ]
    };

    const { errors = [] } = await runUpiTests({ resoCommonFormatJson: records });
    assert(errors.length === 1 && errors[0].error === 'Invalid country subdivision \'ABCDE\'');
  });
});

describe('validateCountrySubdivision Tests', () => {
  let subdivisionCache;

  before(async () => {
    subdivisionCache = await buildCountrySubdivisionCaches('US');
  });

  it('Should return true for a valid US county FIPS code (Harris County, TX = 48201)', () => {
    assert(validateCountrySubdivision('48201', subdivisionCache));
  });

  it('Should return false for an unrecognized subdivision code', () => {
    assert(!validateCountrySubdivision('ABCDE', subdivisionCache));
  });

  it('Should return false when countrySubdivision is null', () => {
    assert(!validateCountrySubdivision(null, subdivisionCache));
  });

  it('Should return false when countrySubdivision is an empty string', () => {
    assert(!validateCountrySubdivision('', subdivisionCache));
  });

  it('Should return false when the cache is null', () => {
    assert(!validateCountrySubdivision('48201', null));
  });

  it('Should return false when the cache is empty', () => {
    assert(!validateCountrySubdivision('48201', {}));
  });
});
