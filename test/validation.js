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
  stringListWithSpacesAfterCommaValidPayload,
  specialEnumFieldsValidPayload,
  maxLengthPayload,
  maxLengthPayloadRCF,
  nestedPayloadError,
  nestedCollectionPayloadError,
  nestedPayloadErrorWithNullExpansion,
  nestedCollectionPayloadErrorWithNull,
  nestedExpansionTypeError,
  atFieldPayloadError,
  expansionErrorMultiValuePayload,
  expansionIgnoredItem,
  collectionExpansionError,
  singleValueExpansionError,
  topLevelUnadvertisedField,
  keyFieldPayloadMulti
} = require('./schema/payload-samples');

describe('Schema validation tests', async () => {
  const metadata = getReferenceMetadata('2.0');
  const schema = await generateJsonSchema({ metadataReportJson: metadata });

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

  it('Should convert expansion enum errors to warnings based on validation config', () => {
    let errorMap = {};
    const config = {
      '2.0': {
        Media: {
          ImageSizeDescription: {
            ignoreEnumerations: true
          }
        }
      }
    };
    const expectedEnumValue = 'Foo';
    const expectedErrorMessage =
      'The following enumerations in the ImageSizeDescription Field were not advertised. This will fail in Data Dictionary 2.1';

    errorMap = validate({
      jsonSchema: schema,
      jsonPayload: expansionIgnoredItem,
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

  it('Should not find errors in case of valid enums containing space after comma', async () => {
    let errorMap = {};
    metadata.fields.push({
      resourceName: 'Property',
      fieldName: 'StringListTestField',
      nullable: false,
      annotations: [],
      type: 'TestEnumType'
    });
    metadata.lookups.push({
      lookupName: 'TestEnumType',
      lookupValue: 'My Company, LLC',
      type: 'Edm.String'
    });
    const modifiedSchema = await generateJsonSchema({ metadataReportJson: metadata });
    errorMap = validate({
      jsonSchema: modifiedSchema,
      jsonPayload: stringListWithSpacesAfterCommaValidPayload,
      resourceName: 'Property',
      version: '2.0',
      errorMap
    });
    const report = combineErrors(errorMap);
    assert.equal(report.totalErrors, 0, 'Error counts did not match');
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

  it('Should not have lookup values for non-enum types', () => {
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
    assert.equal(
      Object.keys(report.items[0].errors[0]?.occurrences[0] || {}).indexOf('lookupValue'),
      -1,
      'Found lookup value on non enum type'
    );
  });

  it('Should find maxLength warnings and have proper message - RCF Testing', async () => {
    let errorMap = {};
    const expectedWarningMessage = 'SHOULD have a maximum suggested length of 5 characters';
    metadata.fields.push({
      resourceName: 'Property',
      fieldName: 'TestMaxLengthField',
      nullable: false,
      annotations: [],
      type: 'Edm.String',
      maxLength: 5
    });
    const modifiedSchema = await generateJsonSchema({ metadataReportJson: metadata });
    errorMap = validate({
      jsonSchema: modifiedSchema,
      jsonPayload: maxLengthPayloadRCF,
      resourceName: 'Property',
      version: '2.0',
      errorMap
    });
    const report = combineErrors(errorMap);
    assert.equal(report.totalWarnings, 1, 'Warning counts did not match');
    assert.equal(report.totalErrors, 0, 'Error counts did not match - Found non-zero errors');
    assert.equal(report.items[0].warnings[0].message, expectedWarningMessage, 'max length warning did not match');

    metadata.fields.pop();
  });

  it('Should find maxLength errors and have proper message - DD Testing', async () => {
    let errorMap = {};
    const expectedErrorMessage = 'MUST have a maximum advertised length of 5 characters';
    metadata.fields.push({
      resourceName: 'Property',
      fieldName: 'TestMaxLengthField',
      nullable: false,
      annotations: [],
      type: 'Edm.String',
      maxLength: 5
    });
    const modifiedSchema = await generateJsonSchema({ metadataReportJson: metadata });
    errorMap = validate({
      jsonSchema: modifiedSchema,
      jsonPayload: maxLengthPayload,
      resourceName: 'Property',
      version: '2.0',
      errorMap
    });
    const report = combineErrors(errorMap);
    assert.equal(report.totalErrors, 1, 'Error counts did not match');
    assert.equal(report.items[0].errors[0].message, expectedErrorMessage, 'max length message did not match');

    metadata.fields.pop();
  });

  it('Should not find errors in case where maxLength is present on non-string types', async () => {
    let errorMap = {};
    metadata.fields.find(f => f.type === 'Edm.Int64').maxLength = 5;
    const modifiedSchema = await generateJsonSchema({ metadataReportJson: metadata });

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

  it('should show the nested expansion resource and field when expansion field is invalid', async () => {
    let errorMap = {};
    const expectedErrorMessage = 'Fields MUST be advertised in the metadata';
    const expectedInvalidParentField = 'ListAgent';
    const expectedInvalidParentResource = 'Property';
    const expectedInvalidSourceModel = 'Member';
    const expectedInvalidSourceModelField = 'Foo';
    errorMap = validate({
      jsonSchema: schema,
      jsonPayload: nestedPayloadError,
      resourceName: 'Property',
      version: '2.0',
      errorMap
    });
    const report = combineErrors(errorMap);
    assert.equal(report.totalErrors, 1, 'Error counts did not match');
    assert.equal(report.items[0].errors[0].message, expectedErrorMessage, 'nested expansion error message did not match');
    assert.equal(report.items[0].fieldName, expectedInvalidParentField, 'nested expansion field did not match');
    assert.equal(report.items[0].resourceName, expectedInvalidParentResource, 'nested expansion resource did not match');
    assert.equal(report.items[0].errors[0].occurrences[0].sourceModel, expectedInvalidSourceModel, 'Expansion resource did not match');
    assert.equal(
      report.items[0].errors[0].occurrences[0].sourceModelField,
      expectedInvalidSourceModelField,
      'Expansion field did not match'
    );
  });

  it('should not change the payload object', async () => {
    let errorMap = {};
    const expectedErrorMessage = 'Fields MUST be advertised in the metadata';
    const expectedInvalidField = 'Media';
    const expectedInvalidResource = 'Property';
    const originalPayload = JSON.parse(JSON.stringify(nestedCollectionPayloadError));
    errorMap = validate({
      jsonSchema: schema,
      jsonPayload: nestedCollectionPayloadError,
      resourceName: 'Property',
      version: '2.0',
      errorMap
    });
    const report = combineErrors(errorMap);
    assert.equal(report.totalErrors, 1, 'Error counts did not match');
    assert.equal(report.items[0].errors[0].message, expectedErrorMessage, 'nested expansion error message did not match');
    assert.equal(report.items[0].fieldName, expectedInvalidField, 'nested expansion field did not match');
    assert.equal(report.items[0].resourceName, expectedInvalidResource, 'nested expansion resource did not match');
    assert.deepEqual(originalPayload, nestedCollectionPayloadError, 'Payload was modified during validation');
  });

  it('should show the nested expansion resource and field when collection expansion field is invalid', async () => {
    let errorMap = {};
    const expectedErrorMessage = 'Fields MUST be advertised in the metadata';
    const expectedInvalidField = 'Media';
    const expectedInvalidResource = 'Property';
    const expectedInvalidSourceModel = 'Media';
    const expectedInvalidSourceModelField = 'Foo';
    errorMap = validate({
      jsonSchema: schema,
      jsonPayload: nestedCollectionPayloadError,
      resourceName: 'Property',
      version: '2.0',
      errorMap
    });
    const report = combineErrors(errorMap);
    assert.equal(report.totalErrors, 1, 'Error counts did not match');
    assert.equal(report.items[0].errors[0].message, expectedErrorMessage, 'nested expansion error message did not match');
    assert.equal(report.items[0].fieldName, expectedInvalidField, 'nested expansion field did not match');
    assert.equal(report.items[0].resourceName, expectedInvalidResource, 'nested expansion resource did not match');
    assert.equal(report.items[0].errors[0].occurrences[0].sourceModel, expectedInvalidSourceModel, 'Expansion resource did not match');
    assert.equal(
      report.items[0].errors[0].occurrences[0].sourceModelField,
      expectedInvalidSourceModelField,
      'Expansion field did not match'
    );
  });

  it('should not find error when nested non-collection expansion is null', async () => {
    let errorMap = {};
    errorMap = validate({
      jsonSchema: schema,
      jsonPayload: nestedPayloadErrorWithNullExpansion,
      resourceName: 'Property',
      version: '2.0',
      errorMap
    });
    const report = combineErrors(errorMap);
    assert.equal(report.totalErrors, 0, 'Found non-zero errors');
  });

  it('should find error when nested collection expansion is null', async () => {
    let errorMap = {};
    const expectedInvalidField = 'Media';
    const expectedInvalidResource = 'Property';
    const expectedErrorMessage = 'MUST be array but found null';
    errorMap = validate({
      jsonSchema: schema,
      jsonPayload: nestedCollectionPayloadErrorWithNull,
      resourceName: 'Property',
      version: '2.0',
      errorMap
    });
    const report = combineErrors(errorMap);
    assert.equal(report.totalErrors, 1, 'Error counts did not match');
    assert.equal(report.items[0].errors[0].message, expectedErrorMessage, 'nested expansion error message did not match');
    assert.equal(report.items[0].fieldName, expectedInvalidField, 'nested expansion field did not match');
    assert.equal(report.items[0].resourceName, expectedInvalidResource, 'nested expansion resource did not match');
  });

  it('should find error when nested collection expansion has type error', async () => {
    let errorMap = {};
    const expectedInvalidField = 'ListAgent';
    const expectedInvalidResource = 'Property';
    const expectedInvalidSourceModel = 'Member';
    const expectedInvalidSourceModelField = 'MemberAlternateId';
    const expectedErrorMessage = 'MUST be string or null but found integer';
    errorMap = validate({
      jsonSchema: schema,
      jsonPayload: nestedExpansionTypeError,
      resourceName: 'Property',
      version: '2.0',
      errorMap
    });
    const report = combineErrors(errorMap);
    assert.equal(report.totalErrors, 1, 'Error counts did not match');
    assert.equal(report.items[0].errors[0].message, expectedErrorMessage, 'nested expansion error message did not match');
    assert.equal(report.items[0].fieldName, expectedInvalidField, 'nested expansion field did not match');
    assert.equal(report.items[0].resourceName, expectedInvalidResource, 'nested expansion resource did not match');
    assert.equal(report.items[0].errors[0].occurrences[0].sourceModel, expectedInvalidSourceModel, 'Expansion resource did not match');
    assert.equal(
      report.items[0].errors[0].occurrences[0].sourceModelField,
      expectedInvalidSourceModelField,
      'Expansion field did not match'
    );
  });

  it('should ignore errors for payload fields with @ in the middle of the string', async () => {
    let errorMap = {};
    errorMap = validate({
      jsonSchema: schema,
      jsonPayload: atFieldPayloadError,
      resourceName: 'Property',
      version: '2.0',
      errorMap
    });
    const report = combineErrors(errorMap);
    assert.equal(report.totalErrors, 0, 'Error counts did not match');
  });

  it('Should correctly classify resource and fields in case of errors with expansion fields', async () => {
    let errorMap = {};
    const expectedField1 = 'BuyerAgentAOR';
    const expectedField2 = 'Media';
    const expectedResource1 = 'Property';
    const expectedResource2 = 'Property';
    const expectedErrorMessage1 = 'MUST be string or null but found array';
    const expectedErrorMessage2 = 'Fields MUST be advertised in the metadata';
    const expectedInvalidSourceModel = 'Media';
    const expectedInvalidSourceModelField = 'Foo';
    errorMap = validate({
      jsonSchema: schema,
      jsonPayload: expansionErrorMultiValuePayload,
      resourceName: 'Property',
      version: '2.0',
      errorMap
    });
    const report = combineErrors(errorMap);
    assert.equal(report.totalErrors, 4, 'Error counts did not match');
    assert.equal(report.items[0].errors[0].message, expectedErrorMessage1, 'error message did not match');
    assert.equal(report.items[1].errors[0].message, expectedErrorMessage2, 'error message did not match');
    assert.equal(report.items[0].errors[0].occurrences[0].count, 2, 'error occurence count did not match');
    assert.equal(report.items[1].errors[0].occurrences[0].count, 2, 'error occurence count did not match');
    assert.equal(report.items[0].fieldName, expectedField1, 'field did not match');
    assert.equal(report.items[1].fieldName, expectedField2, 'nested expansion field did not match');
    assert.equal(report.items[0].resourceName, expectedResource1, 'resource did not match');
    assert.equal(report.items[1].resourceName, expectedResource2, 'nested expansion resource did not match');
    assert.equal(report.items[1].errors[0].occurrences[0].sourceModel, expectedInvalidSourceModel, 'expansion resource did not match');
    assert.equal(
      report.items[1].errors[0].occurrences[0].sourceModelField,
      expectedInvalidSourceModelField,
      'expansion field did not match'
    );
  });

  it('Should correctly classify resource and fields in case of errors in collection expansions', async () => {
    let errorMap = {};
    const expectedField1 = 'Media';
    const expectedResource1 = 'Property';
    const expectedErrorMessage1 = 'MUST be integer or null but found string';
    const expectedInvalidSourceModel = 'Media';
    const expectedInvalidSourceModelField = 'ImageHeight';
    errorMap = validate({
      jsonSchema: schema,
      jsonPayload: collectionExpansionError,
      resourceName: 'Property',
      version: '2.0',
      errorMap
    });
    const report = combineErrors(errorMap);
    assert.equal(report.totalErrors, 1, 'Error counts did not match');
    assert.equal(report.items[0].errors[0].message, expectedErrorMessage1, 'error message did not match');
    assert.equal(report.items[0].errors[0].occurrences[0].count, 1, 'error occurence count did not match');
    assert.equal(report.items[0].fieldName, expectedField1, 'field did not match');
    assert.equal(report.items[0].resourceName, expectedResource1, 'resource did not match');
    assert.equal(report.items[0].errors[0].occurrences[0].sourceModel, expectedInvalidSourceModel, 'expansion resource did not match');
    assert.equal(
      report.items[0].errors[0].occurrences[0].sourceModelField,
      expectedInvalidSourceModelField,
      'expansion field did not match'
    );
  });

  it('Should correctly parse single value expansion errors', () => {
    let errorMap = {};
    const expectedEnumValue = 'Foo';
    const expectedErrorMessage = 'MUST be equal to one of the allowed values';
    const expectedResource = 'Property';
    const expectedField = 'Media';
    const expectedSourceModel = 'Media';
    const expectedSourceModelField = 'ImageSizeDescription';
    errorMap = validate({
      jsonSchema: schema,
      jsonPayload: singleValueExpansionError,
      resourceName: 'Property',
      version: '2.0',
      errorMap
    });
    const report = combineErrors(errorMap);
    assert.equal(report.totalErrors, 1, 'Error counts did not match');
    assert.equal(report.items[0].resourceName, expectedResource, 'resource did not match');
    assert.equal(report.items[0].fieldName, expectedField, 'field did not match');
    assert.equal(report.items[0].errors[0].message, expectedErrorMessage, 'enum error message did not match');
    assert.equal(report.items[0].errors[0].occurrences[0].lookupValue, expectedEnumValue, 'enum lookup value did not match');
    assert.equal(report.items[0].errors[0].occurrences[0].sourceModel, expectedSourceModel, 'expanded resource did not match');
    assert.equal(report.items[0].errors[0].occurrences[0].sourceModelField, expectedSourceModelField, 'expanded field did not match');
  });

  it('should not find errors if there are extra properties on top-level alongside "value"', async () => {
    let errorMap = {};
    errorMap = validate({
      jsonSchema: await generateJsonSchema({ metadataReportJson: metadata, additionalProperties: true }),
      jsonPayload: topLevelUnadvertisedField,
      resourceName: 'Property',
      version: '1.7',
      errorMap
    });
    const report = combineErrors(errorMap);
    assert.equal(report.totalErrors, 0, 'Error counts did not match');
  });

  it('should accumulate key fields if they exist on the failed record', async () => {
    let errorMap = {};
    const mediaKeyField = 'MediaKey';
    const propertyKeyField = 'ListingKey';
    const roomKeyFIeld = 'RoomKey';

    const expectedMediaKeys = ['mediakey1', 'mediakey2'];
    const expectedRoomKeys = ['roomkey1', 'roomkey2'];
    const expectedPropertyKeys = ['listingkey1'];

    errorMap = validate({
      jsonSchema: schema,
      jsonPayload: keyFieldPayloadMulti,
      resourceName: 'Property',
      version: '2.0',
      errorMap
    });
    const report = combineErrors(errorMap);

    assert.equal(report.totalErrors, 5, 'Error counts did not match');

    const propertyErrors = report.items.find(x => x.resourceName === 'Property' && x.fieldName === 'City');
    assert.equal(propertyErrors.errors[0].occurrences[0].keyField, propertyKeyField, 'Property key field did not match');
    assert.deepEqual(propertyErrors.errors[0].occurrences[0].keys, expectedPropertyKeys, 'Property keys did not match');

    const mediaErrors = report.items.find(x => x.resourceName === 'Property' && x.fieldName === 'Media');
    assert.equal(mediaErrors.errors[0].occurrences[0].keyField, mediaKeyField, 'Media key field did not match');
    assert.deepEqual(mediaErrors.errors[0].occurrences[0].keys, expectedMediaKeys, 'Media keys did not match');

    const roomErrors = report.items.find(x => x.resourceName === 'Property' && x.fieldName === 'Rooms');
    assert.equal(roomErrors.errors[0].occurrences[0].keyField, roomKeyFIeld, 'Room key field did not match');
    assert.deepEqual(roomErrors.errors[0].occurrences[0].keys, expectedRoomKeys, 'Room keys did not match');
  });
});
