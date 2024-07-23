'use strict';

const { DEFAULT_UPI_VERSION, DEFAULT_DD_VERSION } = require('../../../common');

// const UPI_PAYLOAD_FIELDS = Object.freeze({
//   '2.0': {
//     US: {
//       CountrySubdivision,
//       ParcelNumber,
//       ParcelSubcomponent
//     }
//   }
// });

/**
 *
 * Parses the given UPI string. Uses the the default version of the UPI.
 *
 * @see https://upi.reso.org
 *
 * @param {String} upiString a correctly formatted UPI string for a given version and country
 * @returns A parsed payload for the given UPI if correctly-formed.
 * @throws Error if UPI isn't correctly formed for the given version and country.
 */
const parseUpi = upiString => {
  const UPI_STEM = 'urn:reso:upi:',
    UPI_SEPARATOR = ':',
    SUBCOMPONENT_SEPARATOR = ':sub:',
    US_COUNTRY_CODE = 'US',
    SUPPORTED_COUNTRIES = [US_COUNTRY_CODE];

  if (!(upiString && upiString?.startsWith(UPI_STEM))) {
    throw new Error(`Incorrectly formatted UPI! Must begin with '${UPI_SEPARATOR}'`);
  }

  const [, upiParts] = upiString.split(UPI_STEM);

  const [version, country, countrySubdivision, parcelNumberParts] = upiParts?.split(UPI_SEPARATOR) ?? [];

  if (!(version && version === DEFAULT_UPI_VERSION)) {
    throw new Error(`UPI version of '${version}' is not supported!`);
  }

  if (!(country && SUPPORTED_COUNTRIES.includes(country))) {
    throw new Error(`Country '${country}' is not supported for UPI version '${version}'!`);
  }

  if (!(countrySubdivision && countrySubdivision?.length)) {
    throw new Error('CountrySubdivision is required!');
  }

  // TODO: validate country subdivision "shape" for the given country...

  if (!(parcelNumberParts && parcelNumberParts?.length)) {
    throw new Error('ParcelNumber is required!');
  }

  const [parcelNumber, parcelSubcomponent] = parcelNumberParts && parcelNumberParts?.length ? parcelNumberParts.split(SUBCOMPONENT_SEPARATOR) : [];

  if (!(parcelNumber && parcelNumber?.length)) {
    throw new Error(`ParcelNumber is required for UPI version '${version}'`);
  }

  return {
    '@reso.context': `urn:reso:metadata:${DEFAULT_DD_VERSION}:resource:property`,
    Country: country,
    CountrySubdivision: countrySubdivision,
    ParcelNumber: parcelNumber,
    ParcelSubcomponent: parcelSubcomponent
  };
};

const runUpiTests = async ({ pathToResoCommonFormatJson, runAllTests = false, fromCli = false, version = DEFAULT_UPI_VERSION } = {}) => {
  // load JSON from path and normalize payload so single-valued items are nested in one array
  // construct UPIs from a payload and validate against provided ones
  // parse UPIs from a payload without additional data to verify the format

  return {
    pathToResoCommonFormatJson,
    runAllTests,
    fromCli,
    version
  };
};

module.exports = {
  runUpiTests,
  parseUpi
};
