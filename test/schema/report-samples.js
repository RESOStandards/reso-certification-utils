const expectDAReportSimple = {
  description: 'RESO Data Availability Report',
  version: '1.7',
  resources: [
    {
      resourceName: 'Property',
      dateField: 'ModificationTimestamp',
      dateHigh: null,
      dateLow: null,
      numUniqueRecordsFetched: 1,
      recordCount: 0,
      postalCodes: ['K2G 1Y9'],
      averageResponseBytes: 0,
      medianResponseBytes: 0,
      stdDevResponseBytes: 0,
      averageResponseTimeMs: 0,
      averageResponseTimeMillis: 0,
      medianResponseTimeMs: 0,
      stdDevResponseTimeMs: 0,
      numRecordsFetched: 0,
      numSamples: 0,
      pageSize: -Infinity,
      expansions: undefined
    }
  ],
  fields: [
    {
      resourceName: 'Property',
      fieldName: '@reso.context',
      frequency: 1
    },
    {
      resourceName: 'Property',
      fieldName: 'Country',
      frequency: 1
    },
    {
      resourceName: 'Property',
      fieldName: 'StateOrProvince',
      frequency: 1
    },
    {
      resourceName: 'Property',
      fieldName: 'City',
      frequency: 1
    },
    {
      resourceName: 'Property',
      fieldName: 'PostalCode',
      frequency: 1
    },
    {
      resourceName: 'Property',
      fieldName: 'StreetName',
      frequency: 1
    },
    {
      resourceName: 'Property',
      fieldName: 'StreetNumber',
      frequency: 1
    },
    {
      resourceName: 'Property',
      fieldName: 'Foo',
      frequency: 1
    }
  ],
  lookupValues: [
    {
      resourceName: 'Property',
      fieldName: 'Country',
      lookupValue: 'CA',
      frequency: 1
    },
    {
      resourceName: 'Property',
      fieldName: 'StateOrProvince',
      lookupValue: 'ON',
      frequency: 1
    },
    {
      resourceName: 'Property',
      fieldName: 'City',
      lookupValue: 'SampleCityEnumValue',
      frequency: 1
    }
  ]
};

const expectDDReportSimple = {
  description: 'RESO Data Dictionary Metadata Report',
  version: '1.7',
  fields: [
    {
      fieldName: 'Country',
      resourceName: 'Property',
      type: 'org.reso.metadata.enums.Country',
      typeName: 'Country',
      nullable: true,
      isExpansion: false,
      isComplexType: false,
      annotations: [
        {
          term: 'RESO.OData.Metadata.StandardName',
          value: 'Country'
        },
        {
          term: 'RESO.DDWikiUrl',
          value: 'https://ddwiki.reso.org/display/DDW17/Country+Field'
        },
        {
          term: 'Core.Description',
          value: 'The country abbreviation in a postal address.'
        }
      ]
    },
    {
      fieldName: 'StateOrProvince',
      resourceName: 'Property',
      type: 'org.reso.metadata.enums.StateOrProvince',
      typeName: 'StateOrProvince',
      nullable: true,
      isExpansion: false,
      isComplexType: false,
      annotations: [
        {
          term: 'RESO.OData.Metadata.StandardName',
          value: 'State Or Province'
        },
        {
          term: 'RESO.DDWikiUrl',
          value: 'https://ddwiki.reso.org/display/DDW17/StateOrProvince+Field'
        },
        {
          term: 'Core.Description',
          value: 'Text field containing the accepted postal abbreviation for the state or province.'
        },
        {
          term: 'RESO.OData.Metadata.Payloads',
          value: 'IDX'
        }
      ]
    },
    {
      fieldName: 'City',
      resourceName: 'Property',
      type: 'org.reso.metadata.enums.City',
      typeName: 'City',
      nullable: true,
      isExpansion: false,
      isComplexType: false,
      annotations: [
        {
          term: 'RESO.OData.Metadata.StandardName',
          value: 'City'
        },
        {
          term: 'RESO.DDWikiUrl',
          value: 'https://ddwiki.reso.org/display/DDW17/City+Field'
        },
        {
          term: 'Core.Description',
          value: 'The city in listing address.'
        },
        {
          term: 'RESO.OData.Metadata.Payloads',
          value: 'IDX'
        }
      ]
    },
    {
      fieldName: 'PostalCode',
      resourceName: 'Property',
      type: 'Edm.String',
      typeName: '',
      nullable: true,
      isExpansion: false,
      isComplexType: false,
      annotations: [
        {
          term: 'RESO.OData.Metadata.StandardName',
          value: 'Postal Code'
        },
        {
          term: 'RESO.DDWikiUrl',
          value: 'https://ddwiki.reso.org/display/DDW17/PostalCode+Field'
        },
        {
          term: 'Core.Description',
          value: 'The postal code portion of a street or mailing address.'
        },
        {
          term: 'RESO.OData.Metadata.Payloads',
          value: 'IDX'
        }
      ],
      maxLength: 10
    },
    {
      fieldName: 'StreetName',
      resourceName: 'Property',
      type: 'Edm.String',
      typeName: '',
      nullable: true,
      isExpansion: false,
      isComplexType: false,
      annotations: [
        {
          term: 'RESO.OData.Metadata.StandardName',
          value: 'Street Name'
        },
        {
          term: 'RESO.DDWikiUrl',
          value: 'https://ddwiki.reso.org/display/DDW17/StreetName+Field'
        },
        {
          term: 'Core.Description',
          value: 'The street name portion of a listed property\'s street address.'
        },
        {
          term: 'RESO.OData.Metadata.Payloads',
          value: 'IDX'
        }
      ],
      maxLength: 50
    },
    {
      fieldName: 'StreetNumber',
      resourceName: 'Property',
      type: 'Edm.String',
      typeName: '',
      nullable: true,
      isExpansion: false,
      isComplexType: false,
      annotations: [
        {
          term: 'RESO.OData.Metadata.StandardName',
          value: 'Street Number'
        },
        {
          term: 'RESO.DDWikiUrl',
          value: 'https://ddwiki.reso.org/display/DDW17/StreetNumber+Field'
        },
        {
          term: 'Core.Description',
          value:
            'The street number portion of a listed property\'s street address.  In some areas the street number may contain non-numeric characters.  This field can also contain extensions and modifiers to the street number, such as "1/2" or "-B".  This street number field should not include Prefixes, Direction or Suffixes.'
        },
        {
          term: 'RESO.OData.Metadata.Payloads',
          value: 'IDX'
        }
      ],
      maxLength: 25
    },
    {
      resourceName: 'Property',
      fieldName: 'Foo',
      type: 'Edm.Int16'
    },
    {
      resourceName: 'Property',
      fieldName: 'OriginatingSystem',
      typeName: 'OUID',
      isCollection: false,
      isExpansion: true,
      type: 'org.reso.metadata.OUID'
    }
  ],
  lookups: [
    {
      lookupName: 'org.reso.metadata.enums.Country',
      lookupValue: 'CA',
      type: 'Edm.String',
      annotations: [
        {
          term: 'RESO.DDWikiUrl',
          value: 'https://ddwiki.reso.org/display/DDW17/CA'
        }
      ]
    },
    {
      lookupName: 'org.reso.metadata.enums.StateOrProvince',
      lookupValue: 'ON',
      type: 'Edm.String',
      annotations: [
        {
          term: 'RESO.DDWikiUrl',
          value: 'https://ddwiki.reso.org/display/DDW17/ON'
        }
      ]
    },
    {
      lookupName: 'org.reso.metadata.enums.City',
      lookupValue: 'SampleCityEnumValue',
      type: 'Edm.String'
    }
  ]
};

const expectDAReportMulti = {
  description: 'RESO Data Availability Report',
  version: '1.7',
  resources: [
    {
      resourceName: 'Property',
      dateField: 'ModificationTimestamp',
      dateHigh: null,
      dateLow: null,
      numUniqueRecordsFetched: 2,
      recordCount: 0,
      postalCodes: ['K2G 1Y9'],
      averageResponseBytes: 0,
      medianResponseBytes: 0,
      stdDevResponseBytes: 0,
      averageResponseTimeMs: 0,
      averageResponseTimeMillis: 0,
      medianResponseTimeMs: 0,
      stdDevResponseTimeMs: 0,
      numRecordsFetched: 0,
      numSamples: 0,
      pageSize: -Infinity,
      expansions: undefined
    }
  ],
  fields: [
    {
      resourceName: 'Property',
      fieldName: '@reso.context',
      frequency: 2
    },
    {
      resourceName: 'Property',
      fieldName: 'Country',
      frequency: 2
    },
    {
      resourceName: 'Property',
      fieldName: 'StateOrProvince',
      frequency: 2
    },
    {
      resourceName: 'Property',
      fieldName: 'City',
      frequency: 2
    },
    {
      resourceName: 'Property',
      fieldName: 'PostalCode',
      frequency: 2
    },
    {
      resourceName: 'Property',
      fieldName: 'StreetName',
      frequency: 2
    },
    {
      resourceName: 'Property',
      fieldName: 'StreetNumber',
      frequency: 2
    },
    {
      resourceName: 'Property',
      fieldName: 'Foo',
      frequency: 2
    }
  ],
  lookupValues: [
    {
      resourceName: 'Property',
      fieldName: 'Country',
      lookupValue: 'CA',
      frequency: 2
    },
    {
      resourceName: 'Property',
      fieldName: 'StateOrProvince',
      lookupValue: 'ON',
      frequency: 2
    },
    {
      resourceName: 'Property',
      fieldName: 'City',
      lookupValue: 'SampleCityEnumValue',
      frequency: 2
    }
  ]
};

const expectedMultiResourceDAReport = {
  description: 'RESO Data Availability Report',
  version: '1.7',
  resources: [
    {
      resourceName: 'Property',
      dateField: 'ModificationTimestamp',
      dateHigh: null,
      dateLow: null,
      numUniqueRecordsFetched: 1,
      recordCount: 0,
      averageResponseBytes: NaN,
      medianResponseBytes: undefined,
      stdDevResponseBytes: NaN,
      averageResponseTimeMs: NaN,
      averageResponseTimeMillis: NaN,
      medianResponseTimeMs: undefined,
      stdDevResponseTimeMs: NaN,
      numRecordsFetched: 1,
      numSamples: 1,
      pageSize: 1,
      expansions: undefined
    },
    {
      resourceName: 'Lookup',
      dateField: 'ModificationTimestamp',
      dateHigh: null,
      dateLow: null,
      numUniqueRecordsFetched: 1,
      recordCount: 0,
      averageResponseBytes: NaN,
      medianResponseBytes: undefined,
      stdDevResponseBytes: NaN,
      averageResponseTimeMs: NaN,
      averageResponseTimeMillis: NaN,
      medianResponseTimeMs: undefined,
      stdDevResponseTimeMs: NaN,
      numRecordsFetched: 1,
      numSamples: 1,
      pageSize: 1,
      expansions: undefined
    }
  ],
  fields: [
    {
      resourceName: 'Property',
      fieldName: '@reso.context',
      frequency: 1
    },
    {
      resourceName: 'Property',
      fieldName: 'Country',
      frequency: 1
    },
    {
      resourceName: 'Property',
      fieldName: 'StateOrProvince',
      frequency: 1
    },
    {
      resourceName: 'Lookup',
      fieldName: '@reso.context',
      frequency: 1
    },
    {
      resourceName: 'Lookup',
      fieldName: 'LookupName',
      frequency: 1
    },
    {
      resourceName: 'Lookup',
      fieldName: 'LookupValue',
      frequency: 1
    }
  ],
  lookupValues: [
    {
      resourceName: 'Property',
      fieldName: 'Country',
      lookupValue: 'CA',
      frequency: 1
    },
    {
      resourceName: 'Property',
      fieldName: 'StateOrProvince',
      lookupValue: 'ON',
      frequency: 1
    }
  ]
};

const expectedMultiResourceDDReport = {
  description: 'RESO Data Dictionary Metadata Report',
  version: '1.7',
  fields: [
    {
      fieldName: 'Country',
      resourceName: 'Property',
      type: 'org.reso.metadata.enums.Country',
      typeName: 'Country',
      nullable: true,
      isExpansion: false,
      isComplexType: false,
      annotations: [
        {
          term: 'RESO.OData.Metadata.StandardName',
          value: 'Country'
        },
        {
          term: 'RESO.DDWikiUrl',
          value: 'https://ddwiki.reso.org/display/DDW17/Country+Field'
        },
        {
          term: 'Core.Description',
          value: 'The country abbreviation in a postal address.'
        }
      ]
    },
    {
      fieldName: 'StateOrProvince',
      resourceName: 'Property',
      type: 'org.reso.metadata.enums.StateOrProvince',
      typeName: 'StateOrProvince',
      nullable: true,
      isExpansion: false,
      isComplexType: false,
      annotations: [
        {
          term: 'RESO.OData.Metadata.StandardName',
          value: 'State Or Province'
        },
        {
          term: 'RESO.DDWikiUrl',
          value: 'https://ddwiki.reso.org/display/DDW17/StateOrProvince+Field'
        },
        {
          term: 'Core.Description',
          value: 'Text field containing the accepted postal abbreviation for the state or province.'
        },
        {
          term: 'RESO.OData.Metadata.Payloads',
          value: 'IDX'
        }
      ]
    },
    {
      fieldName: 'LookupName',
      resourceName: 'Lookup',
      type: 'Edm.String',
      typeName: '',
      nullable: true,
      isExpansion: false,
      isComplexType: false,
      annotations: [
        {
          term: 'RESO.OData.Metadata.StandardName',
          value: 'Lookup Name'
        },
        {
          term: 'RESO.DDWikiUrl',
          value: 'https://ddwiki.reso.org/display/DDW17/LookupName+Field'
        },
        {
          term: 'Core.Description',
          value:
            'The name of the group of enumerations comprising the given lookup, aka picklist.  It is called a "LookupName" in this proposal because more than one field can have a given lookup, so it refers to the name of the lookup rather than a given field. For example, Listing with CountyOrParish and Office with OfficeCountyOrParish having the same CountyOrParish LookupName. This MUST match the Data Dictionary definition for in cases where the lookup is defined. Vendors MAY add their own enumerations otherwise. The LookupName a given field uses is required to be annotated at the field level in the OData XML Metadata, as outlined later in this proposal.'
        }
      ]
    },
    {
      fieldName: 'LookupValue',
      resourceName: 'Lookup',
      type: 'Edm.String',
      typeName: '',
      nullable: true,
      isExpansion: false,
      isComplexType: false,
      annotations: [
        {
          term: 'RESO.OData.Metadata.StandardName',
          value: 'Lookup Value'
        },
        {
          term: 'RESO.DDWikiUrl',
          value: 'https://ddwiki.reso.org/display/DDW17/LookupValue+Field'
        },
        {
          term: 'Core.Description',
          value:
            'The human-friendly display name the data consumer receives in the payload and uses in queries. This MAY be a local name or synonym for a given RESO Data Dictionary lookup item.'
        }
      ]
    }
  ],
  lookups: [
    {
      lookupName: 'org.reso.metadata.enums.Country',
      lookupValue: 'CA',
      type: 'Edm.String',
      annotations: [
        {
          term: 'RESO.DDWikiUrl',
          value: 'https://ddwiki.reso.org/display/DDW17/CA'
        }
      ]
    },
    {
      lookupName: 'org.reso.metadata.enums.StateOrProvince',
      lookupValue: 'ON',
      type: 'Edm.String',
      annotations: [
        {
          term: 'RESO.DDWikiUrl',
          value: 'https://ddwiki.reso.org/display/DDW17/ON'
        }
      ]
    }
  ]
};

module.exports = {
  expectDAReportSimple,
  expectDDReportSimple,
  expectDAReportMulti,
  expectedMultiResourceDAReport,
  expectedMultiResourceDDReport
};
