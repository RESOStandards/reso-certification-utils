'use strict';

const { DEFAULT_UPI_VERSION, DEFAULT_DD_VERSION } = require('../../../common');

const { readFile } = require('node:fs/promises');

const UPI_SEPARATOR = ':',
  SUBCOMPONENT_SEPARATOR = `${UPI_SEPARATOR}sub${UPI_SEPARATOR}`,
  UPI_STEM = `urn${UPI_SEPARATOR}reso${UPI_SEPARATOR}upi`;

const SUPPORTED_COUNTRIES = Object.freeze(['US']);

/**
 *
 * Parses the given UPI string. Uses the the default version of the UPI.
 *
 * @see https://upi.reso.org
 * @see https://www.census.gov/programs-surveys/geography/guidance/geo-identifiers.html
 *
 * @param {String} upiString a correctly formatted UPI string for a given version and country
 * @returns A parsed payload for the given UPI if correctly-formed.
 * @throws Error if UPI isn't correctly formed for the given version and country.
 */
const parseUpi = upiString => {
  if (!(upiString && upiString?.startsWith(UPI_STEM))) {
    throw new Error(`Incorrectly formatted UPI! Must begin with '${UPI_SEPARATOR}'`);
  }

  const [, upiParts] = upiString.split(`${UPI_STEM}${UPI_SEPARATOR}`);

  if (!(upiParts && upiParts?.length)) {
    throw new Error(`Malformed UPI! '${upiString}'`);
  }

  // parcelSubcomponent needs to be removed from main UPI string, if present, since it uses
  // a different delimiter (:sub:) from the normal UPI delimiter of colon
  const [primaryComponents, parcelSubcomponent] = upiParts.split(SUBCOMPONENT_SEPARATOR);

  const [version, country, countrySubdivision, parcelNumber] = primaryComponents.split(UPI_SEPARATOR) ?? [];

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

  if (!(pathToResoCommonFormatJson && pathToResoCommonFormatJson?.length)) {
    throw new Error('pathToResoCommonFormatJson was expected but was null or empty!');
  }

  const invalidIds = [];
  const upiData = [];

  // 1. load and validate results from RESO Common Format data
  try {
    const parsedJson = JSON.parse(await readFile(pathToResoCommonFormatJson));

    if (!parsedJson) {
      // TODO: need to handle when a path to a directory of individual RCF files is used
      throw new Error(`RESO Common Format JSON could not be loaded from path: '${pathToResoCommonFormatJson}'`);
    }

    const { value } = parsedJson;
  
    if (Array.isArray(parsedJson.value)) {
      upiData.push(...value);
    } else {
      upiData.push(parsedJson);
    }

    upiData.forEach(item => {
      const { UniversalParcelId, ParcelNumber: suppliedParcelNumber } = item;

      if (!(UniversalParcelId)) {
        throw new Error('UniversalParcelId not present in data!');
      }

      if (!UniversalParcelId?.length) {
        throw new Error('Empty UniversalParcelId in data!');
      }

      try {
        const { ParcelNumber: parsedParcelNumber } = parseUpi(UniversalParcelId);

        if (suppliedParcelNumber && suppliedParcelNumber !== parsedParcelNumber) {
          console.error(`Parsed parcel number '${parsedParcelNumber}' differs from the one provided in the payload: '${suppliedParcelNumber}'`);
          invalidIds.push({ upi: parsedParcelNumber, errorType: 'Parsed UPI mismatch with UPI data' });
        }
      } catch {
        invalidIds.push({ upi: UniversalParcelId, errorType: 'Parsing Error' });
      }
    });

  } finally {
    const testsPassed = invalidIds?.length === 0;
    
    if (testsPassed) {
      console.log('UPI tests passed!');
    } else {
      console.error(`UPI tests failed! The following UPIs contain errors: ${JSON.stringify(invalidIds, null, 2)}`);
    }
  }

};

module.exports = {
  runUpiTests,
  parseUpi
};
