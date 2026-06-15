'use strict';

const assert = require('assert');
const { pascalCase } = require('../lib/misc');

describe('pascalCase tests', () => {
  it('Should convert a simple lowercase word to PascalCase', () => {
    assert.strictEqual(pascalCase('property'), 'Property');
  });

  it('Should convert multiple lowercase words separated by spaces', () => {
    assert.strictEqual(pascalCase('postal code'), 'PostalCode');
  });

  it('Should convert hyphen-separated words to PascalCase', () => {
    assert.strictEqual(pascalCase('some-field-name'), 'SomeFieldName');
  });

  it('Should convert underscore-separated words to PascalCase', () => {
    assert.strictEqual(pascalCase('some_field_name'), 'SomeFieldName');
  });

  it('Should handle mixed delimiters', () => {
    assert.strictEqual(pascalCase('some-field_name here'), 'SomeFieldNameHere');
  });

  it('Should preserve a string that is already PascalCase', () => {
    assert.strictEqual(pascalCase('PostalCode'), 'Postalcode');
  });

  it('Should handle a single character', () => {
    assert.strictEqual(pascalCase('a'), 'A');
  });

  it('Should return an empty string when given an empty string', () => {
    assert.strictEqual(pascalCase(''), '');
  });

  it('Should return an empty string when called with no arguments', () => {
    assert.strictEqual(pascalCase(), '');
  });

  it('Should strip non-alphanumeric characters', () => {
    assert.strictEqual(pascalCase('hello!@#world'), 'HelloWorld');
  });

  it('Should handle strings with numbers', () => {
    assert.strictEqual(pascalCase('version2update'), 'Version2update');
  });

  it('Should handle strings with leading/trailing non-alphanumeric characters', () => {
    assert.strictEqual(pascalCase('--hello-world--'), 'HelloWorld');
  });

  it('Should convert an ALL CAPS string', () => {
    assert.strictEqual(pascalCase('POSTAL CODE'), 'PostalCode');
  });

  it('Should handle a fully qualified lookup name after extracting the suffix', () => {
    const lookupName = 'org.reso.metadata.enums.CountryCode';
    const suffix = lookupName.substring(lookupName.lastIndexOf('.') + 1);
    assert.strictEqual(pascalCase(suffix), 'Countrycode');
  });
});
