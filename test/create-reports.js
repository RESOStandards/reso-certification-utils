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
  [
    replicationInstance.getMetadataMap(),
    replicationInstance.getRecordCountHashMap(),
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

describe('Schema validation tests', async () => {
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
});
