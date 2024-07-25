'use strict';

const assert = require('assert');
const { parseUpi } = require('../index.js');

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
    const {
      Country,
      CountrySubdivision,
      ParcelNumber,
      ParcelSubcomponent
    } = parseUpi(KNOWN_GOOD_UPI);

    assert(Country === 'US');
    assert(CountrySubdivision === '48201');
    assert(ParcelNumber === '12345 parcel number');
    assert(!ParcelSubcomponent);
  });

  it('Should produce correct components when parsed with a known-good UPI with Parcel Subcomponent', async () => {
    const {
      Country,
      CountrySubdivision,
      ParcelNumber,
      ParcelSubcomponent
    } = parseUpi(KNOWN_GOOD_UPI_WITH_SUBCOMPONENT);

    assert(Country === 'US');
    assert(CountrySubdivision === '48201');
    assert(ParcelNumber === '12345 parcel number');
    assert(ParcelSubcomponent === 'test parcel subcomponent');
  });
});
