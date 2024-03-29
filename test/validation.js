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
  additionalPropertyPayload,
  integerOverflowPayload,
  specialEnumFieldsValidPayload
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

  it('Should convert enum errors to warnings based on validation config', () => {
    let errorMap = {};
    const config = {
      '2.0': {
        Property: {
          MLSAreaMinor: {
            ignoreEnumerations: true
          }
        }
      }
    };
    const expectedEnumValue = 'TestEnumValuer';
    const expectedErrorMessage =
      'The following enumerations in the MLSAreaMinor Field were not advertised. This will fail in Data Dictionary 2.1';

    errorMap = validate({
      jsonSchema: schema,
      jsonPayload: specialEnumFieldsValidPayload,
      resourceName: 'Property',
      version: '2.0',
      errorMap,
      validationConfig: config
    });
    const report = combineErrors(errorMap);
    assert.equal(report.totalErrors, 0, 'Error counts did not match');
    assert.equal(report.totalWarnings, 1, 'Warning counts did not match');
    assert.equal(report.items[0].warnings[0].message, expectedErrorMessage, 'enum error message did not match');
    assert.equal(report.items[0].warnings[0].occurrences[0].lookupValue, expectedEnumValue, 'enum lookup value did not match');
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
    const version = '2.0';
    const expectedErrorMessage = `ADDITIONAL fields found that are not part of Data Dictionary ${version}`;
    const expectedInvalidField = 'AdditionalProperty';
    errorMap = validate({
      jsonSchema: schema,
      jsonPayload: additionalPropertyPayload,
      resourceName: 'Property',
      version: '2.0',
      errorMap,
      isResoDataDictionarySchema: true
    });
    const report = combineErrors(errorMap);
    assert.equal(report.totalErrors, 1, 'Error counts did not match');
    assert.equal(report.items[0].errors[0].message, expectedErrorMessage, 'additional property error message did not match');
    assert.equal(report.items[0].fieldName, expectedInvalidField, 'Non advertised field did not match');
  });

  it('Should not find errors in case where maxLength is present on non-string types', async () => {
    let errorMap = {};
    metadata.fields.find(f => f.type === 'Edm.Int64').maxLength = 5;
    const modifiedSchema = await generateJsonSchema({ metadataReportJson: metadata });
    // eslint-disable-next-line no-unused-vars
    const { AdditionalProperty, ...payload } = additionalPropertyPayload;
    errorMap = validate({
      jsonSchema: modifiedSchema,
      jsonPayload: payload,
      resourceName: 'Property',
      version: '2.0',
      errorMap
    });
    const report = combineErrors(errorMap);
    assert.equal(report.totalErrors, 0, 'Error counts did not match - Found a non-zero count');
    delete metadata.fields.find(f => f.type === 'Edm.Int64').maxLength;
  });

  it('should find errors when Integer field exceeds its limit', async () => {
    let errorMap = {};
    metadata.fields.push({
      resourceName: 'Property',
      fieldName: 'Foo',
      nullable: false,
      annotations: [],
      type: 'Edm.Int32'
    });
    const modifiedSchema = await generateJsonSchema({ metadataReportJson: metadata });
    const expectedErrorMessage = `MUST be <= ${2 ** 32 - 1}`;
    errorMap = validate({
      jsonSchema: modifiedSchema,
      jsonPayload: integerOverflowPayload,
      resourceName: 'Property',
      version: '2.0',
      errorMap
    });
    const report = combineErrors(errorMap);
    assert.equal(report.totalErrors, 1, 'Error counts did not match');
    assert.equal(report.items[0].errors[0].message, expectedErrorMessage, 'integer overflow error message did not match');
    metadata.fields.pop();
  });
});
