'use strict';

const assert = require('assert');
const { generateRcfData } = require('../lib/datagenerator');

// const metadataNoLookups = require('./datagenerator/metadata-empty-lookup-data.json'),
//   metadataWithStringLookups = require('./datagenerator/metadata-string-enumerations.json');

// describe('Data Generator Tests - String Enumerations', () => {
//   it('Should generate one valid record for one resourceName parameter without expansions', async () => {
//     const TEST_RESOURCE_NAME = 'Property';

//     [metadataNoLookups, metadataWithStringLookups].forEach(async (metadataReportJson, index) => {
//       const data = await generateRcfData({
//         resourceNames: [TEST_RESOURCE_NAME, 'Media'],
//         metadataReportJson,
//         outputPath: 'testData' + index
//       });

//       if (!data || !Object.keys(data)?.length) {
//         assert.fail('Data generator returned no records when there should have been ');
//       }

//       assert(Array.isArray(data?.[TEST_RESOURCE_NAME]) && data?.[TEST_RESOURCE_NAME]?.length === 1);
//     });
//   });
// });

describe('Data Generator Tests - Expansion Scenarios', () => {
  it('Should generate 5 Property records (no expansions)', async () => {
    const TEST_RESOURCE_NAME = 'Property';
    const RESOURCE_COUNTS = {
      Property: 6,
      Media: 38,
      Member: 4,
      Office: 1,
      Teams: 2,
      OUID: 1,
      TeamMembers: 4,
      Contacts: 5
    };

    const data = await generateRcfData({
      resourceNames: [TEST_RESOURCE_NAME],
      resourceRecordCounts: RESOURCE_COUNTS,
      useExpansions: false
    });

    assert(data, 'Data generator did not return any data.');
    assert(data[TEST_RESOURCE_NAME], `No records found for resource: ${TEST_RESOURCE_NAME}`);
    assert(
      data[TEST_RESOURCE_NAME].length === RESOURCE_COUNTS[TEST_RESOURCE_NAME],
      `Expected ${RESOURCE_COUNTS[TEST_RESOURCE_NAME]} ${TEST_RESOURCE_NAME} records, but found ${data[TEST_RESOURCE_NAME].length}`
    );
  });

  it('Should generate 5 Property records with nested expansions', async () => {
    const TEST_RESOURCE_NAME = 'Property';
    const RESOURCE_COUNTS = {
      Property: 6,
      Media: 38,
      Member: 4,
      Office: 1,
      Teams: 2,
      OUID: 1,
      TeamMembers: 4,
      Contacts: 5
    };

    const data = await generateRcfData({
      resourceNames: [TEST_RESOURCE_NAME],
      resourceRecordCounts: RESOURCE_COUNTS,
      relatedRecordCounts: {
        Media: 2
      },
      useExpansions: true
    });

    assert(data, 'Data generator did not return any data.');
    assert(data[TEST_RESOURCE_NAME], `No records found for resource: ${TEST_RESOURCE_NAME}`);
    assert(
      data[TEST_RESOURCE_NAME].length === RESOURCE_COUNTS[TEST_RESOURCE_NAME],
      `Expected ${RESOURCE_COUNTS[TEST_RESOURCE_NAME]} ${TEST_RESOURCE_NAME} records, but found ${data[TEST_RESOURCE_NAME].length}`
    );

    // Check that expansions values are included on records
    data[TEST_RESOURCE_NAME].forEach(record => {
      assert(record.Media, 'Media is missing.');
      assert(record.ListingKey, 'ListingKey is missing.');

      if (record.Media) {
        assert(Array.isArray(record.Media), 'Media is not an array.');
        record.Media.forEach(media => {
          assert(media.MediaKey, 'MediaKey is missing in Media record.');
          assert(media.ResourceName === TEST_RESOURCE_NAME, 'ResourceName is incorrect in Media record.');

          assert(media.ResourceRecordKey === record.ListingKey, 'ResourceRecordKey is incorrect in Media record.');
        });
      }
    });
  });

  it('Should generate multiple top-level resources (Property, Member, Office)', async () => {
    const RESOURCE_COUNTS = {
      Property: 6,
      Media: 38,
      Member: 4,
      Office: 1,
      Teams: 2,
      OUID: 1,
      TeamMembers: 4,
      Contacts: 5
    };

    const data = await generateRcfData({
      resourceNames: ['Property', 'Media', 'Member', 'Office', 'Teams', 'OUID', 'TeamMembers', 'Contacts'],
      resourceRecordCounts: RESOURCE_COUNTS,
      useExpansions: false
    });

    assert(data, 'Data generator did not return any data.');

    for (const [resourceName, count] of Object.entries(RESOURCE_COUNTS)) {
      assert(data[resourceName], `No records found for resource: ${resourceName}`);
      assert(data[resourceName].length === count, `Expected ${count} ${resourceName} records, but found ${data[resourceName].length}`);
    }
  });

  it('Should validate relationships between Property and related records', async () => {
    const TEST_RESOURCE_NAME = 'Property';
    const RESOURCE_COUNTS = {
      Property: 6,
      Media: 38,
      Member: 4,
      Office: 1,
      Teams: 2,
      OUID: 1,
      TeamMembers: 4,
      Contacts: 5
    };
    const data = await generateRcfData({
      resourceNames: [TEST_RESOURCE_NAME, 'Member', 'Office', 'Teams', 'TeamMembers'],
      resourceRecordCounts: RESOURCE_COUNTS,
      useExpansions: false
    });

    assert(data, 'Data generator did not return any data.');
    assert(data[TEST_RESOURCE_NAME], `No records found for resource: ${TEST_RESOURCE_NAME}`);
    assert(
      data[TEST_RESOURCE_NAME].length === RESOURCE_COUNTS[TEST_RESOURCE_NAME],
      `Expected ${RESOURCE_COUNTS[TEST_RESOURCE_NAME]} ${TEST_RESOURCE_NAME} records, but found ${data[TEST_RESOURCE_NAME].length}`
    );

    const memberKeys = new Set(data.Member.map(member => member.MemberKey));
    const teamKeys = new Set(data.Teams.map(team => team.TeamKey));
    const officeKeys = new Set(data.Office.map(office => office.OfficeKey));

    data[TEST_RESOURCE_NAME].forEach(record => {
      if (record.ListAgentKey) {
        assert(
          memberKeys.has(record.ListAgentKey),
          'ListAgentKey ' + record.ListAgentKey + ' for record ' + record.ListingKey + ' does not point to a valid Member.'
        );
      }
      if (record.ListTeamKey) {
        assert(teamKeys.has(record.ListTeamKey), 'ListTeamKey does not point to a valid Team.');
      }
      if (record.ListOfficeKey) {
        assert(officeKeys.has(record.ListOfficeKey), 'ListOfficeKey does not point to a valid Office.');
      }
    });
  });
});
