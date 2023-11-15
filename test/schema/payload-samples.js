const valuePayload = {
  '@reso.context': 'urn:reso:metadata:1.7:resource:property',
  value: [
    {
      Country: 'CA',
      StateOrProvince: 'ON',
      City: 'SampleCityEnumValue',
      PostalCode: 'K2G 1Y9',
      StreetName: 'Starwood Rd',
      StreetNumber: '39',
      AboveGradeFinishedAreaSource: 'Appraiser'
    }
  ]
};

const nonValuePayload = {
  '@reso.context': 'urn:reso:metadata:1.7:resource:property',
  Country: 'CA',
  StateOrProvince: 'ON',
  City: 'SampleCityEnumValue',
  PostalCode: 'K2G 1Y9',
  StreetName: 'Starwood Rd',
  StreetNumber: '39',
  AboveGradeFinishedAreaSource: 'Appraiser'
};

const expansionPayload = {
  '@reso.context': 'urn:reso:metadata:1.7:resource:property',
  Country: 'CA',
  StateOrProvince: 'ON',
  City: 'SampleCityEnumValue',
  PostalCode: 'K2G 1Y9',
  StreetName: 'Starwood Rd',
  StreetNumber: '39',
  AboveGradeFinishedAreaSource: 'Appraiser',
  Media: [
    {
      ResourceName: 'Property',
      MediaCategory: 'BrandedVirtualTour',
      MediaURL: 'https://youriguide.com/39_starwood_rd_ottawa_on/'
    },
    {
      ResourceName: 'Property',
      MediaCategory: 'UnbrandedVirtualTour',
      MediaURL: 'https://unbranded.youriguide.com/39_starwood_rd_ottawa_on/'
    },
    {
      ResourceName: 'Property',
      MediaCategory: 'FloorPlan',
      MediaType: 'Pdf',
      MediaURL: 'https://youriguide.com/39_starwood_rd_ottawa_on/doc/floorplan_imperial.pdf',
      ShortDescription: 'imperial'
    },
    {
      ResourceName: 'Property',
      MediaCategory: 'FloorPlan',
      MediaType: 'Pdf',
      MediaURL: 'https://youriguide.com/39_starwood_rd_ottawa_on/doc/floorplan_metric.pdf',
      ShortDescription: 'metric'
    },
    {
      MediaObjectID: '39_starwood_rd_ottawa_on:2ANGWI9SPOJ5.jpg',
      PreferredPhotoYN: true,
      ResourceName: 'Property',
      MediaCategory: 'Photo',
      MediaType: 'Jpeg',
      MediaURL: 'https://youriguide.com/39_starwood_rd_ottawa_on/f/2ANGWI9SPOJ5.jpg',
      ImageHeight: 2456,
      ImageWidth: 3689
    }
  ]
};

const simpleTypeMismatchErrorPayload = {
  '@reso.context': 'urn:reso:metadata:1.7:resource:property',
  Country: 'CA',
  StateOrProvince: 'ON',
  City: 'SampleCityEnumValue',
  PostalCode: true,
  StreetName: 'Starwood Rd',
  StreetNumber: '39',
  AboveGradeFinishedAreaSource: 'Appraiser'
};

const enumMismatchPayload = {
  '@reso.context': 'urn:reso:metadata:1.7:resource:property',
  value: [
    {
      Country: 'CA',
      StateOrProvince: 'ON',
      City: 'SampleCityEnumValue',
      PostalCode: 'K2G 1Y9',
      StreetName: 'Starwood Rd',
      StreetNumber: '39',
      AboveGradeFinishedAreaSource: 'InvalidEnum'
    }
  ]
};

const odataKeyPayload = {
  '@odata.context': 'urn:reso:metadata:1.7:resource:property',
  Country: 'CA',
  StateOrProvince: 'ON',
  City: 'SampleCityEnumValue',
  PostalCode: 'K2G 1Y9',
  StreetName: 'Starwood Rd',
  StreetNumber: '39',
  AboveGradeFinishedAreaSource: 'Appraiser'
};

const invalidPayloadContext = {
  '@invalid.context': 'urn:reso:metadata:1.7:resource:property',
  Country: 'CA',
  StateOrProvince: 'ON',
  City: 'SampleCityEnumValue',
  PostalCode: 'K2G 1Y9',
  StreetName: 'Starwood Rd',
  StreetNumber: '39',
  AboveGradeFinishedAreaSource: 'Appraiser'
};

const stringListValidPayload = {
  '@reso.context': 'urn:reso:metadata:1.7:resource:property',
  value: [
    {
      Country: 'CA',
      StateOrProvince: 'ON',
      City: 'SampleCityEnumValue',
      PostalCode: 'K2G 1Y9',
      StreetName: 'Starwood Rd',
      StreetNumber: '39',
      AboveGradeFinishedAreaSource: 'Appraiser,Assessor'
    }
  ]
};

const stringListInvalidPayload = {
  '@reso.context': 'urn:reso:metadata:1.7:resource:property',
  value: [
    {
      Country: 'CA',
      StateOrProvince: 'ON',
      City: 'SampleCityEnumValue',
      PostalCode: 'K2G 1Y9',
      StreetName: 'Starwood Rd',
      StreetNumber: '39',
      AboveGradeFinishedAreaSource: 'Appraiser,InvalidEnum'
    }
  ]
};

const additionalPropertyPayload = {
  '@reso.context': 'urn:reso:metadata:1.7:resource:property',
  Country: 'CA',
  StateOrProvince: 'ON',
  City: 'SampleCityEnumValue',
  PostalCode: 'K2G 1Y9',
  StreetName: 'Starwood Rd',
  StreetNumber: '39',
  AboveGradeFinishedAreaSource: 'Appraiser',
  AdditionalProperty: 'foo'
};

module.exports = {
  valuePayload,
  nonValuePayload,
  expansionPayload,
  simpleTypeMismatchErrorPayload,
  enumMismatchPayload,
  odataKeyPayload,
  invalidPayloadContext,
  stringListValidPayload,
  stringListInvalidPayload,
  additionalPropertyPayload
};
