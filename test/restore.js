'use strict';

const assert = require('assert');
const { join } = require('path');
const { promises: fs } = require('fs');
const { restore } = require('../lib/restore');

const TEST_RESTORE_DIR = join(__dirname, 'tmp-restore-test');

const originalFetch = global.fetch;

beforeEach(async () => {
  try {
    await fs.rm(TEST_RESTORE_DIR, { recursive: true, force: true });
  } catch {
    // ignore
  }
  await fs.mkdir(TEST_RESTORE_DIR, { recursive: true });
});

afterEach(async () => {
  global.fetch = originalFetch;
  try {
    await fs.rm(TEST_RESTORE_DIR, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

describe('restore - restoreFromBackup mode', () => {
  it('Should return early for an invalid URL', async () => {
    const result = await restore({ url: 'not-a-url', pathToResults: TEST_RESTORE_DIR, restoreFromBackup: true });
    assert.strictEqual(result, undefined);
  });

  it('Should restore backed-up JSON files by POSTing to restore endpoint', async () => {
    // Create the backup directory structure:
    // TEST_RESTORE_DIR/P001-S001/R001/metadata-report.json
    const recipientDir = join(TEST_RESTORE_DIR, 'P001-S001', 'R001');
    await fs.mkdir(recipientDir, { recursive: true });

    const mockReport = { id: 'dd-1', type: 'data_dictionary', version: '2.0' };
    await fs.writeFile(join(recipientDir, 'metadata-report.json'), JSON.stringify(mockReport));

    const restoredReports = [];
    global.fetch = async (url, options) => {
      if (url.includes('/api/v1/restore')) {
        restoredReports.push(JSON.parse(options.body));
        return { ok: true };
      }
      return { ok: false, status: 404 };
    };

    await restore({
      url: 'http://localhost',
      pathToResults: TEST_RESTORE_DIR,
      restoreFromBackup: true
    });

    assert.strictEqual(restoredReports.length, 1);
    assert.strictEqual(restoredReports[0].id, 'dd-1');
  });

  it('Should handle multiple report files per recipient', async () => {
    const recipientDir = join(TEST_RESTORE_DIR, 'P001-S001', 'R001');
    await fs.mkdir(recipientDir, { recursive: true });

    await fs.writeFile(
      join(recipientDir, 'metadata-report.json'),
      JSON.stringify({ id: 'dd-1', type: 'data_dictionary' })
    );
    await fs.writeFile(
      join(recipientDir, 'data-availability-report.json'),
      JSON.stringify({ id: 'da-1', type: 'data_availability' })
    );

    const restoredReports = [];
    global.fetch = async (url, options) => {
      if (url.includes('/api/v1/restore')) {
        restoredReports.push(JSON.parse(options.body));
        return { ok: true };
      }
      return { ok: false, status: 404 };
    };

    await restore({
      url: 'http://localhost',
      pathToResults: TEST_RESTORE_DIR,
      restoreFromBackup: true
    });

    assert.strictEqual(restoredReports.length, 2);
  });

  it('Should track failed restores', async () => {
    const recipientDir = join(TEST_RESTORE_DIR, 'P001-S001', 'R001');
    await fs.mkdir(recipientDir, { recursive: true });

    await fs.writeFile(
      join(recipientDir, 'metadata-report.json'),
      JSON.stringify({ id: 'dd-fail', type: 'data_dictionary' })
    );

    global.fetch = async () => ({ ok: false, status: 500 });

    // Should not throw
    await restore({
      url: 'http://localhost',
      pathToResults: TEST_RESTORE_DIR,
      restoreFromBackup: true
    });
  });
});
