'use strict';

const assert = require('assert');
const {
  fetchSingleDDReport,
  fetchAllWebApiReports,
  fetchDataAvailabilityReport,
  fetchDataDictionaryReportIds,
  restoreBackedUpReport
} = require('../lib/misc/data-access/cert-api-client');

// Store original fetch so we can restore it
const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

describe('fetchSingleDDReport tests', () => {
  it('Should return report data on success', async () => {
    const mockReport = { id: '123', type: 'data_dictionary' };
    global.fetch = async () => ({
      ok: true,
      json: async () => mockReport
    });

    const result = await fetchSingleDDReport({ serverUrl: 'http://localhost', id: '123' });
    assert.deepStrictEqual(result, mockReport);
  });

  it('Should return null on fetch error', async () => {
    global.fetch = async () => ({
      ok: false,
      status: 404
    });

    const result = await fetchSingleDDReport({ serverUrl: 'http://localhost', id: 'bad-id' });
    assert.strictEqual(result, null);
  });
});

describe('fetchAllWebApiReports tests', () => {
  it('Should return array of reports on success', async () => {
    const mockReports = [{ id: '1' }, { id: '2' }];
    global.fetch = async () => ({
      ok: true,
      json: async () => mockReports
    });

    const result = await fetchAllWebApiReports({ serverUrl: 'http://localhost' });
    assert.deepStrictEqual(result, mockReports);
  });

  it('Should return null on fetch error', async () => {
    global.fetch = async () => ({
      ok: false,
      status: 500
    });

    const result = await fetchAllWebApiReports({ serverUrl: 'http://localhost' });
    assert.strictEqual(result, null);
  });
});

describe('fetchDataAvailabilityReport tests', () => {
  it('Should return report data on success', async () => {
    const mockReport = { id: '456', type: 'data_availability' };
    global.fetch = async () => ({
      ok: true,
      json: async () => mockReport
    });

    const result = await fetchDataAvailabilityReport({ serverUrl: 'http://localhost', reportId: '456' });
    assert.deepStrictEqual(result, mockReport);
  });

  it('Should return null when reportId is empty', async () => {
    const result = await fetchDataAvailabilityReport({ serverUrl: 'http://localhost', reportId: '' });
    assert.strictEqual(result, null);
  });

  it('Should return null on fetch error', async () => {
    global.fetch = async () => ({
      ok: false,
      status: 500
    });

    const result = await fetchDataAvailabilityReport({ serverUrl: 'http://localhost', reportId: '456' });
    assert.strictEqual(result, null);
  });
});

describe('fetchDataDictionaryReportIds tests', () => {
  it('Should return report IDs from paginated responses', async () => {
    let callCount = 0;
    global.fetch = async () => {
      callCount++;
      if (callCount === 1) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            lastUoiIndex: 1,
            reportsByOrgs: {
              org1: [
                { type: 'data_dictionary', id: 'dd-1' },
                { type: 'web_api_server_core', id: 'wapi-1' },
                { type: 'data_availability', id: 'da-1', extra: 'field' }
              ]
            }
          })
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ lastUoiIndex: 2, reportsByOrgs: {} })
      };
    };

    const [reportIds, otherReports] = await fetchDataDictionaryReportIds({
      serverUrl: 'http://localhost',
      endorsementsPath: '/api/endorsements',
      backup: true
    });

    assert.deepStrictEqual(reportIds, ['dd-1']);
    assert.strictEqual(otherReports.length, 1);
    assert.strictEqual(otherReports[0].id, 'da-1');
  });

  it('Should return empty arrays when server returns error', async () => {
    global.fetch = async () => ({
      ok: false,
      status: 500
    });

    const [reportIds, otherReports] = await fetchDataDictionaryReportIds({
      serverUrl: 'http://localhost',
      endorsementsPath: '/api/endorsements'
    });

    assert.deepStrictEqual(reportIds, []);
    assert.deepStrictEqual(otherReports, []);
  });
});

describe('restoreBackedUpReport tests', () => {
  it('Should return true on successful restore', async () => {
    global.fetch = async () => ({ ok: true });

    const result = await restoreBackedUpReport({
      serverUrl: 'http://localhost',
      report: { id: '123', type: 'data_dictionary' }
    });
    assert.strictEqual(result, true);
  });

  it('Should return false on server error', async () => {
    global.fetch = async () => ({ ok: false, status: 500 });

    const result = await restoreBackedUpReport({
      serverUrl: 'http://localhost',
      report: { id: '123' }
    });
    assert.strictEqual(result, false);
  });

  it('Should return false on network error', async () => {
    global.fetch = async () => { throw new Error('Network error'); };

    const result = await restoreBackedUpReport({
      serverUrl: 'http://localhost',
      report: { id: '123' }
    });
    assert.strictEqual(result, false);
  });
});
