'use strict';

const assert = require('assert');
const { generateJsonSchema, validate, combineErrors, VALIDATION_ERROR_MESSAGES } = require('..');
const { getReferenceMetadata } = require('@reso/reso-certification-etl');

const {
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
} = require('./schema/payload-samples');

const { beforeEach } = require('mocha');

describe('Schema validation tests', () => {
  const metadata = getReferenceMetadata('2.0');
  let schema;
  beforeEach(async () => {
    schema = await generateJsonSchema({ metadataReportJson: metadata });
  });

  it('Should validate a valid array type payload', () => {
    let errorMap = {};
    errorMap = validate({
      jsonSchema: schema,
      jsonPayload: valuePayload,
      resourceName: 'Property',
      version: '2.0',
      errorMap
    });
    const report = combineErrors(errorMap);
    assert(report.totalErrors === 0);
  });

  it('Should validate valid non-array type payload', () => {
    let errorMap = {};
    errorMap = validate({
      jsonSchema: schema,
      jsonPayload: nonValuePayload,
      resourceName: 'Property',
      version: '2.0',
      errorMap
    });
    const report = combineErrors(errorMap);
    assert(report.totalErrors === 0);
  });

  it('Should validate valid payload containing expansions', () => {
    let errorMap = {};
    errorMap = validate({
      jsonSchema: schema,
      jsonPayload: expansionPayload,
      resourceName: 'Property',
      version: '2.0',
      errorMap
    });
    const report = combineErrors(errorMap);
    assert(report.totalErrors === 0);
  });

  it('Should find errors in case of type mismatch in simple types', () => {
    let errorMap = {};
    errorMap = validate({
      jsonSchema: schema,
      jsonPayload: simpleTypeMismatchErrorPayload,
      resourceName: 'Property',
      version: '2.0',
      errorMap
    });
    const report = combineErrors(errorMap);
    const expectedErrorMessage = `MUST be string or null but found ${typeof simpleTypeMismatchErrorPayload.PostalCode}`;
    assert(report.totalErrors === 1);
    assert(report.items[0].errors[0].message === expectedErrorMessage);
  });

  it('Should find errors in case of enum mismatch in complex types', () => {
    let errorMap = {};
    const expectedErrorMessage = 'MUST be equal to one of the allowed values';
    const expectedInvalidEnum = enumMismatchPayload.value[0].AboveGradeFinishedAreaSource;
    errorMap = validate({
      jsonSchema: schema,
      jsonPayload: enumMismatchPayload,
      resourceName: 'Property',
      version: '2.0',
      errorMap
    });
    const report = combineErrors(errorMap);
    assert.equal(report.totalErrors, 1, 'Error counts did not match');
    assert.equal(report.items[0].errors[0].message, expectedErrorMessage, 'enum error message did not match');
    assert.equal(report.items[0].errors[0].occurrences[0].lookupValue, expectedInvalidEnum, 'enum lookup value did not match');
  });

  it('Should validate even when top level context is @odata instead of @reso', () => {
    let errorMap = {};
    errorMap = validate({
      jsonSchema: schema,
      jsonPayload: odataKeyPayload,
      resourceName: 'Property',
      version: '2.0',
      errorMap
    });
    const report = combineErrors(errorMap);
    assert.equal(report.totalErrors, 0, 'Error counts did not match');
  });

  it('Should find error even when top level context is invalid', () => {
    try {
      validate({
        jsonSchema: schema,
        jsonPayload: invalidPayloadContext,
        resourceName: 'Property',
        version: '2.0',
        errorMap: {}
      });
    } catch (err) {
      assert.equal(err.message, VALIDATION_ERROR_MESSAGES.NO_CONTEXT_PROPERTY);
    }
  });

  it('Should properly parse and validate valid string list lookup values', () => {
    let errorMap = {};
    errorMap = validate({
      jsonSchema: schema,
      jsonPayload: stringListValidPayload,
      resourceName: 'Property',
      version: '2.0',
      errorMap
    });
    const report = combineErrors(errorMap);
    assert.equal(report.totalErrors, 0, 'Error counts did not match');
  });

  it('Should find errors in case of invalid enums in string list', () => {
    let errorMap = {};
    const expectedErrorMessage = 'MUST be equal to one of the allowed values';
    const expectedInvalidEnum = 'InvalidEnum';
    errorMap = validate({
      jsonSchema: schema,
      jsonPayload: stringListInvalidPayload,
      resourceName: 'Property',
      version: '2.0',
      errorMap
    });
    const report = combineErrors(errorMap);
    assert.equal(report.totalErrors, 1, 'Error counts did not match');
    assert.equal(report.items[0].errors[0].message, expectedErrorMessage, 'enum error message did not match');
    assert.equal(report.items[0].errors[0].occurrences[0].lookupValue, expectedInvalidEnum, 'enum lookup value did not match');
  });

  it('Should find errors in case of additional properties not advertised in the metadata', () => {
    let errorMap = {};
    const expectedErrorMessage = 'Fields MUST be advertised in the metadata';
    const expectedInvalidField = 'AdditionalProperty';
    errorMap = validate({
      jsonSchema: schema,
      jsonPayload: additionalPropertyPayload,
      resourceName: 'Property',
      version: '2.0',
      errorMap
    });
    const report = combineErrors(errorMap);
    assert.equal(report.totalErrors, 1, 'Error counts did not match');
    assert.equal(report.items[0].errors[0].message, expectedErrorMessage, 'additional property error message did not match');
    assert.equal(report.items[0].fieldName, expectedInvalidField, 'Non advertised field did not match');
  });
});
