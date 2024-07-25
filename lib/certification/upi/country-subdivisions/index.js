'use strict';

const DEFAULT_COUNTRY_CODE = 'US';

const getReferenceFiles = (countryCode = DEFAULT_COUNTRY_CODE) => {

  if (!(countryCode && countryCode?.length)) {
    throw new Error('ISO 3166 countryCode is required!');
  }

  if (countryCode === 'US') {
    return Object.freeze({
      statesOrProvinces: require(`./${countryCode?.toLowerCase()}/states`),
      countiesOrParishes: require(`./${countryCode?.toLowerCase()}/counties`),
      countySubdivisions: require(`./${countryCode?.toLowerCase()}/county-subdivisions`)
    });
  } else {
    throw new Error(`Country code '${countryCode}' is not currently supported or incorrect. Please contact dev@reso.org.`);
  }
};

/**
 * Parses a new-line delimited string which has rows separated by 
 * a given delimiter such as a comma or pipe character
 * 
 * @param {String} data newline-delimited string data
 * @param {Array} fieldList list of JSON-based fields to map to
 * @param {Object} options set of parsing options
 * @returns JSON-based array of data in CSV
 * @throws Error if something can't be parsed or if the schema doesn't match the data
 */
const parseCsv = (data, fieldList, { separator = ',', hasHeader = true }) =>
  data.split('\n').reduce((acc, row) => {
    if (hasHeader) return acc;

    const rowData = row && row?.length ? row.split(separator) : [];

    if (rowData?.length !== fieldList?.length) {
      throw new Error('Schema mismatch. Number of columns in row is different from fieldList');
    }

    const data = {};
    fieldList.forEach(fieldName => (data[fieldName] = rowData[i]), i);
    acc.push(data);
  }, []);

/**
 * Parses the given county subdivision into its constituent parts, if valid, otherwise throws an error.
 * 
 * Country subdivision should either be 5 or 10 digits with the FIPS state code 
 * in the first 2 positions, the county code in the next 3, and the county subdivision as a 5-digit number
 *  
 *  states: https://www.census.gov/library/reference/code-lists/ansi.html#states
 *  counties: https://www.census.gov/library/reference/code-lists/ansi.html#cou
 *  county subdivisions: https://www.census.gov/library/reference/code-lists/ansi.html#cousub
 * 
 * @param {String} countySubdivision 
 * @returns a JSON payload of stateCode, countyCode, and countySubdivisionCode, if present
 * @throws Error if the county subdivision could not be parsed
 */
const parseCountySubdivision = (countySubdivision = '') => {


  return {

  };

};

/**
 * Returns the local set of reference states for the given ISO 3166 country code (default: US).
 * 
 * @returns JSON representation of the given pipe-delimited file
 * @see https://www.census.gov/library/reference/code-lists/ansi.html#states
 * @see https://en.wikipedia.org/wiki/List_of_ISO_3166_country_codes
 * 
 */
const getStatesOrProvincesForCountry = ( countryCode = DEFAULT_COUNTRY_CODE) => {
  // Header row: STATE|STATEFP|STATENS|STATE_NAME
  const FIELD_LIST = Object.freeze(['state', 'stateFipsCode', 'stateNsCode', 'stateName']);


};


/**
 * Returns the local set of reference counties or the given ISO 3166 country code.
 * 
 * @returns JSON representation of the given pipe-delimited file
 * @see https://www.census.gov/library/reference/code-lists/ansi.html#cou
 * @see https://en.wikipedia.org/wiki/List_of_ISO_3166_country_codes
 * 
 */
const getCountiesOrParishesForCountry = ( countryCode = DEFAULT_COUNTRY_CODE) => {
  // Header row: STATE|STATEFP|COUNTYFP|COUNTYNS|COUNTYNAME|CLASSFP|FUNCSTAT
  const FIELD_LIST = Object.freeze([
    'state',
    'stateFipsCode',
    'countyFipsCode',
    'countyNsCode',
    'countyName',
    'fipsClassCode',
    'functionalStatus'
  ]);

  let referenceData;

  try {
    referenceData = require(`./${countryCode?.toLowerCase()}/`);
  } catch (err) {
    throw new Error(`Could not find reference data for country code '${countryCode}'`);
  }

  try {
    return parseCsv(referenceData, FIELD_LIST, { separator: '|' });
  } catch (err) {
    throw new Error(`Could not get country subdivisions! Error: ${err}`);
  }

};

/**
 * Returns the local set of reference county subdivision files
 * 
 * @returns JSON representation of the given pipe-delimited file
 * @see https://www.census.gov/library/reference/code-lists/ansi.html#cousub
 * 
 */
const getCountySubdivisionsForCountry = ( countryCode = DEFAULT_COUNTRY_CODE) => {
  // Header row: STATE|STATEFP|COUNTYFP|COUNTYNAME|COUSUBFP|COUSUBNS|COUSUBNAME|CLASSFP|FUNCSTAT
  const FIELD_LIST = Object.freeze([
    'state',
    'stateFipsCode',
    'countyFipsCode',
    'countyName',
    'countySubdivisionFipsCode',
    'countySubdivisionNsCode',
    'countySubdivisionName',
    'fipsClassCode',
    'functionalStatus'
  ]);

  let referenceData;

  try {
    referenceData = require(`./${countryCode?.toLowerCase()}/county-subdivisions`);
  } catch (err) {
    throw new Error(`Could not find reference data for country code '${countryCode}'`);
  }

  try {
    return parseCsv(referenceData, FIELD_LIST, { separator: '|' });
  } catch (err) {
    throw new Error(`Could not get country subdivisions! Error: ${err}`);
  }

};

module.exports = {
  getStatesOrProvincesForCountry,
  getCountiesOrParishesForCountry,
  getCountySubdivisionsForCountry
};
