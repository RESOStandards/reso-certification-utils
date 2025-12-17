const { generateReports } = require('..');
const assert = require('assert');
const {
  expectDAReportSimple,
  expectDDReportSimple,
  expectDAReportMulti,
  expectedMultiResourceDAReport,
  expectedMultiResourceDDReport
} = require('./schema/report-samples');
const { createReplicationStateServiceInstance } = require('../common');

const resetReplicationStateForTests = () => {
  const replicationInstance = createReplicationStateServiceInstance();
  replicationInstance.resetRecordCountHashMaps();
  [
    replicationInstance.getMetadataMap(),
    replicationInstance.getResourceAvailabilityMap(),
    replicationInstance.getResponses(),
    replicationInstance.getTopLevelResourceCounts()
  ].forEach(obj => {
    if (Array.isArray(obj)) {
      obj.length = 0;
    } else {
      Object.keys(obj).forEach(k => {
        if (obj.hasOwnProperty(k)) {
          delete obj[k];
        }
      });
    }
  });
};

describe('Schema report generation tests', async () => {
  beforeEach(resetReplicationStateForTests);

  it('Should generate valid reports for a simple payload', async () => {
    const payload = {
      '@reso.context': 'urn:reso:metadata:1.7:resource:property',
      Country: 'CA',
      StateOrProvince: 'ON',
      City: 'SampleCityEnumValue',
      PostalCode: 'K2G 1Y9',
      StreetName: 'Starwood Rd',
      StreetNumber: '39',
      Foo: 2,
      OriginatingSystem: null
    };
    const { daReport, ddReport } = await generateReports([payload]);
    delete daReport.generatedOn;
    delete ddReport.generatedOn;
    assert.deepEqual(daReport, expectDAReportSimple);
    assert.deepEqual(ddReport, expectDDReportSimple);
  });

  it('Should generate valid reports for multiple payloads', async () => {
    const payload1 = {
      '@reso.context': 'urn:reso:metadata:1.7:resource:property',
      Country: 'CA',
      StateOrProvince: 'ON',
      City: 'SampleCityEnumValue',
      PostalCode: 'K2G 1Y9',
      StreetName: 'Starwood Rd',
      StreetNumber: '39',
      Foo: 2,
      OriginatingSystem: null
    };
    const payload2 = {
      '@reso.context': 'urn:reso:metadata:1.7:resource:property',
      Country: 'CA',
      StateOrProvince: 'ON',
      City: 'SampleCityEnumValue',
      PostalCode: 'K2G 1Y9',
      StreetName: 'Starwood Rd',
      StreetNumber: '38',
      Foo: 2,
      OriginatingSystem: null
    };
    const { daReport, ddReport } = await generateReports([payload1, payload2]);
    delete daReport.generatedOn;
    delete ddReport.generatedOn;
    assert.deepEqual(daReport, expectDAReportMulti);
    assert.deepEqual(ddReport, expectDDReportSimple);
  });

  it('Should generate valid reports 2 payloads with different resources', async () => {
    const propertyPayload = {
      '@reso.context': 'urn:reso:metadata:1.7:resource:property',
      Country: 'CA',
      StateOrProvince: 'ON'
    };
    const lookupPayload = {
      '@reso.context': 'urn:reso:metadata:1.7:resource:lookup',
      LookupName: 'Cooling',
      LookupValue: 'Central Air'
    };
    const { daReport, ddReport } = await generateReports([propertyPayload, lookupPayload]);
    delete daReport.generatedOn;
    delete ddReport.generatedOn;
    assert.deepEqual(daReport, expectedMultiResourceDAReport);
    assert.deepEqual(ddReport, expectedMultiResourceDDReport);
  });

  it('Should correctly infer string data type and max length', async () => {
    const payload = {
      '@reso.context': 'urn:reso:metadata:1.7:resource:property',
      value: [
        {
          Country: 'CA',
          LocalStringValue: 'Foo'
        },
        {
          Country: 'US',
          LocalStringValue: 'Fooo'
        }
      ]
    };
    const { ddReport } = await generateReports([payload]);
    const field = ddReport.fields.find(f => f.fieldName === 'LocalStringValue');
    assert.equal(field.type, 'Edm.String');
    assert.equal(field.maxLength, 4);
  });

  it('Should correctly infer int data type', async () => {
    const payload = {
      '@reso.context': 'urn:reso:metadata:1.7:resource:property',
      value: [
        {
          Country: 'CA',
          LocalIntValue: 10
        },
        {
          Country: 'US',
          LocalIntValue: 68000
        }
      ]
    };
    const { ddReport } = await generateReports([payload]);
    const field = ddReport.fields.find(f => f.fieldName === 'LocalIntValue');
    assert.equal(field.type, 'Edm.Int32');
  });

  it('Should correctly infer data type for local expansion', async () => {
    const payload = {
      '@reso.context': 'urn:reso:metadata:1.7:resource:property',
      value: [
        {
          Country: 'CA',
          LocalIntValue: 10,
          LocalExpansion: {
            Foo: 'bar'
          }
        },
        {
          Country: 'US',
          LocalIntValue: 68000
        }
      ]
    };
    const { ddReport } = await generateReports([payload]);
    const field = ddReport.fields.find(f => f.fieldName === 'LocalExpansion');
    assert.equal(field.type, 'Custom Type');
    assert.equal(field.isExpansion, true);
    assert.equal(!!field.isCollection, false);
  });

  it('Should correctly classify for standard single value expansion', async () => {
    const payload = {
      '@reso.context': 'urn:reso:metadata:1.7:resource:property',
      value: [
        {
          Country: 'CA',
          LocalIntValue: 10,
          LocalExpansion: {
            Foo: 'bar'
          }
        },
        {
          Country: 'US',
          BuyerAgent: {
            JobTitle: 'Foo'
          }
        }
      ]
    };
    const { ddReport } = await generateReports([payload]);
    const field1 = ddReport.fields.find(f => f.fieldName === 'LocalExpansion');
    assert.equal(field1.type, 'Custom Type');
    assert.equal(field1.isExpansion, true);
    assert.equal(!!field1.isCollection, false);

    const field2 = ddReport.fields.find(f => f.fieldName === 'BuyerAgent');
    assert.equal(field2.type, 'org.reso.metadata.Member');
    assert.equal(field2.typeName, 'Member');
    assert.equal(field2.isExpansion, true);
    assert.equal(!!field2.isCollection, false);
  });

  it('Should classify enums as string when any value fails identifier regex', async () => {
    const payload = {
      '@reso.context': 'urn:reso:metadata:1.7:resource:property',
      value: [
        {
          Country: 'CA',
          StateOrProvince: 'ON',
          LocalCity: 'Sample City With Space'
        },
        {
          Country: 'CA',
          StateOrProvince: 'ON',
          LocalCity: 'SampleCityEnumValue'
        },
        {
          Country: 'CA',
          StateOrProvince: 'ON',
          LocalCity: 'Sample City With Space'
        }
      ]
    };

    const { ddReport } = await generateReports([payload]);
    const cityLookup = ddReport.lookups.find(l => l.lookupName === 'Property.LocalCity');
    assert.ok(cityLookup, 'Expected City lookup to be present');
    assert.equal(cityLookup.type, 'Edm.String');
  });

  it('Should infer local enum type from repeated string values', async () => {
    const payload = {
      '@reso.context': 'urn:reso:metadata:1.7:resource:property',
      value: [
        { Country: 'CA', LocalEnum: 'A' },
        { Country: 'US', LocalEnum: 'B' },
        { Country: 'CA', LocalEnum: 'A' }
      ]
    };

    const { ddReport } = await generateReports([payload]);
    const field = ddReport.fields.find(f => f.fieldName === 'LocalEnum');
    assert.ok(field, 'Expected LocalEnum field in DD report');
    assert.equal(field.type, 'Property.LocalEnum');
  });

  it('Should infer Edm.Date for ISO 8601 date strings', async () => {
    const payload = {
      '@reso.context': 'urn:reso:metadata:1.7:resource:property',
      value: [{ Country: 'CA', LocalDate: '2025-12-17' }, { Country: 'US', LocalDate: '2025-12-18' }, { Country: 'CA', LocalDate: '2025-12-17' }]
    };

    const { ddReport } = await generateReports([payload]);
    const field = ddReport.fields.find(f => f.fieldName === 'LocalDate');
    assert.ok(field, 'Expected LocalDate field in DD report');
    assert.equal(field.type, 'Edm.Date');
    const lookup = ddReport.lookups.find(l => l.lookupName === 'Property.LocalDate');
    assert.ok(!lookup, 'Did not expect LocalDate to be treated as a lookup');
  });

  it('Should infer Edm.DateTimeOffset for ISO 8601 datetime strings with offset', async () => {
    const payload = {
      '@reso.context': 'urn:reso:metadata:1.7:resource:property',
      value: [
        { Country: 'CA', LocalDateTime: '2025-12-17T13:45:30Z' },
        { Country: 'US', LocalDateTime: '2025-12-17T08:45:30-05:00' },
        { Country: 'CA', LocalDateTime: '2025-12-17T13:45:30Z' }
      ]
    };

    const { ddReport } = await generateReports([payload]);
    const field = ddReport.fields.find(f => f.fieldName === 'LocalDateTime');
    assert.ok(field, 'Expected LocalDateTime field in DD report');
    assert.equal(field.type, 'Edm.DateTimeOffset');
    const lookup = ddReport.lookups.find(l => l.lookupName === 'Property.LocalDateTime');
    assert.ok(!lookup, 'Did not expect LocalDateTime to be treated as a lookup');
  });
});
