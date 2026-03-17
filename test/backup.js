'use strict';

const assert = require('assert');
const { join } = require('path');
const { promises: fs } = require('fs');
const { backup } = require('../lib/backup');

const TEST_BACKUP_DIR = join(__dirname, 'tmp-backup-test');

// Store original fetch so we can restore it
const originalFetch = global.fetch;

beforeEach(async () => {
  try {
    await fs.rm(TEST_BACKUP_DIR, { recursive: true, force: true });
  } catch {
    // ignore
  }
  await fs.mkdir(TEST_BACKUP_DIR, { recursive: true });
});

afterEach(async () => {
  global.fetch = originalFetch;
  try {
    await fs.rm(TEST_BACKUP_DIR, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

describe('backup tests', () => {
  it('Should return early for an invalid URL', async () => {
    const result = await backup({ url: 'not-a-url', pathToBackup: TEST_BACKUP_DIR });
    assert.strictEqual(result, undefined);
  });

  it('Should create backup directory structure', async () => {
    // Mock fetch to return web api reports
    global.fetch = async (url) => {
      if (url.includes('/web_api/all')) {
        return {
          ok: true,
          json: async () => ([
            {
              id: 'wapi-1',
              type: 'web_api_server_core',
              version: '2.0.0',
              providerUoi: 'P001',
              providerUsi: 'S001',
              recipientUoi: 'R001'
            }
          ])
        };
      }
      // endorsements endpoint - return empty to stop pagination
      if (url.includes('endorsements') || url.includes('/api/')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ lastUoiIndex: 0, reportsByOrgs: {} })
        };
      }
      return { ok: false, status: 404 };
    };

    const stats = await backup({
      url: 'http://localhost',
      pathToBackup: TEST_BACKUP_DIR,
      webApi: true
    });

    assert.ok(stats);
    assert.strictEqual(stats.web_api_server_core, 1);

    // Check the file was created
    const reportPath = join(
      TEST_BACKUP_DIR,
      'reso-server-backup',
      'web-api-core-report.json-2.0.0',
      'P001-S001',
      'R001',
      'web-api-core-report.json'
    );
    const fileContent = JSON.parse(await fs.readFile(reportPath, 'utf8'));
    assert.strictEqual(fileContent.id, 'wapi-1');
  });

  it('Should handle DD-only backup mode', async () => {
    let fetchCount = 0;
    global.fetch = async (url) => {
      // endorsements endpoint - return one DD report then empty
      if (!url.includes('/full/')) {
        fetchCount++;
        if (fetchCount === 1) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              lastUoiIndex: 1,
              reportsByOrgs: {
                org1: [{ type: 'data_dictionary', id: 'dd-1' }]
              }
            })
          };
        }
        if (fetchCount === 2) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ lastUoiIndex: 2, reportsByOrgs: {} })
          };
        }
      }
      // Full DD report
      if (url.includes('/full/data_dictionary/')) {
        return {
          ok: true,
          json: async () => ({
            id: 'dd-1',
            type: 'data_dictionary',
            version: '2.0',
            providerUoi: 'P001',
            providerUsi: 'S001',
            recipientUoi: 'R001'
          })
        };
      }
      // DA report
      if (url.includes('/full/data_availability/')) {
        return {
          ok: true,
          json: async () => ({
            id: 'da-1',
            type: 'data_availability',
            version: '2.0',
            providerUoi: 'P001',
            providerUsi: 'S001',
            recipientUoi: 'R001'
          })
        };
      }
      return { ok: false, status: 404 };
    };

    const stats = await backup({
      url: 'http://localhost',
      pathToBackup: TEST_BACKUP_DIR,
      dataDictionary: true
    });

    assert.ok(stats);
    assert.strictEqual(stats.data_dictionary, 1);
    assert.strictEqual(stats.data_availability, 1);
  });
});
