'use strict';

const assert = require('assert');
const { join } = require('path');
const { promises: fs } = require('fs');
const { checkFileExists, isValidUrl } = require('../common');

describe('checkFileExists tests', () => {
  it('Should return true for a file that exists', async () => {
    assert.strictEqual(await checkFileExists(join(__dirname, '..', 'common.js')), true);
  });

  it('Should return true for a directory that exists', async () => {
    assert.strictEqual(await checkFileExists(__dirname), true);
  });

  it('Should return false for a path that does not exist', async () => {
    assert.strictEqual(await checkFileExists(join(__dirname, 'nonexistent-file.xyz')), false);
  });

  it('Should return false for an empty string', async () => {
    assert.strictEqual(await checkFileExists(''), false);
  });

  it('Should return false when called with no arguments', async () => {
    assert.strictEqual(await checkFileExists(), false);
  });
});

describe('isValidUrl tests', () => {
  it('Should return true for a valid http URL', () => {
    assert.strictEqual(isValidUrl('http://localhost'), true);
  });

  it('Should return true for a valid https URL', () => {
    assert.strictEqual(isValidUrl('https://example.com'), true);
  });

  it('Should return true for a URL with port', () => {
    assert.strictEqual(isValidUrl('http://localhost:3000'), true);
  });

  it('Should return true for a URL with path', () => {
    assert.strictEqual(isValidUrl('https://example.com/api/v1'), true);
  });

  it('Should return false for an empty string', () => {
    assert.strictEqual(isValidUrl(''), false);
  });

  it('Should return false for a random string', () => {
    assert.strictEqual(isValidUrl('not-a-url'), false);
  });

  it('Should return false when called with no arguments', () => {
    assert.strictEqual(isValidUrl(), false);
  });
});
