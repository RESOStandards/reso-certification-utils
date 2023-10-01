'use strict';

const wellKnownIdentifiers = [
  'country',
  'stateorprovince',
  'county',
  'subcounty',
  'propertytype',
  'subpropertytype',
  'parcelnumber',
  'subparcelnumber'
];

/*
  nss example: 

  ':country:us:stateorprovince:ca:county:06037:subcounty::propertytype:residential:subpropertytype::parcelnumber: [abc] 1-2 ::   3:456 :subparcelnumber:';

*/
const upiParser = ({ version = '2.0', nss = '' }) => {
  const regex = new RegExp(wellKnownIdentifiers.map(item => `:${item}:`).join('|'));
  const [, country, stateOrProvince, county, subCounty, propertyType, subPropertyType, parcelNumber, subParcelNumber] = nss.split(regex);
  return { country, stateOrProvince, county, subCounty, propertyType, subPropertyType, parcelNumber, subParcelNumber };
};

module.exports = {
  upiParser
};
