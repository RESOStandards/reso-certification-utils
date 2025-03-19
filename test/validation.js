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
    const resourceName = 'Property';
    const fieldName = 'PostalCode';
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
    assert(!!report.errors[expectedErrorMessage], 'Expected error message not found');
    assert(!!report.errors[expectedErrorMessage].resources?.Property?.fields?.PostalCode, 'Expected field not found');
    assert(report.errors[expectedErrorMessage].resources?.[resourceName]?.fields?.[fieldName]?.count === 1, 'Expected count did not match');
  });

  it('Should find errors in case of enum mismatch in complex types', () => {
    let errorMap = {};
    const resourceName = 'Property';
    const fieldName = 'AboveGradeFinishedAreaSource';
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
    assert(!!report.errors[expectedErrorMessage], 'Expected error message not found');
    assert(
      !!report.errors[expectedErrorMessage].resources?.[resourceName]?.fields?.[fieldName]?.lookups?.[expectedInvalidEnum],
      'Expected enum value not found'
    );
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
    const resourceName = 'Property';
    const fieldName = 'MLSAreaMinor';
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
    assert(!!report.warnings?.[expectedErrorMessage], 'Expected enum error message not found');
    assert(
      !!report.warnings[expectedErrorMessage].resources?.[resourceName]?.fields?.[fieldName]?.lookups?.[expectedEnumValue],
      'Expected enum value not found'
    );
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
    const resourceName = 'Property';
    const fieldName = 'Media';
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
    assert(!!report.warnings?.[expectedErrorMessage], 'Expected enum error message not found');
    assert(
      !!report.warnings[expectedErrorMessage].resources?.[resourceName]?.fields?.[fieldName]?.lookups?.[expectedEnumValue],
      'Expected enum value not found'
    );
  });

  it('Should find errors in case of invalid enums in string list', () => {
    let errorMap = {};
    const resourceName = 'Property';
    const fieldName = 'AboveGradeFinishedAreaSource';
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
    assert(!!report.errors?.[expectedErrorMessage], 'Expected enum error message not found');
    assert(
      !!report.errors[expectedErrorMessage].resources?.[resourceName]?.fields?.[fieldName]?.lookups?.[expectedInvalidEnum],
      'Expected enum value not found'
    );
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
    const resourceName = 'Property';
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
    assert(!!report.errors?.[expectedErrorMessage], 'Expected enum error message not found');
    assert(
      !!report.errors[expectedErrorMessage].resources?.[resourceName]?.fields?.[expectedInvalidField],
      'Expected field value not found'
    );
  });

  it('Should not have lookup values for non-enum types', () => {
    let errorMap = {};
    const resourceName = 'Property';
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
    assert(!!report.errors?.[expectedErrorMessage], 'Expected enum error message not found');
    assert(
      !!report.errors[expectedErrorMessage].resources?.[resourceName]?.fields?.[expectedInvalidField],
      'Expected field value not found'
    );
    assert(
      !('lookups' in report.errors[expectedErrorMessage].resources?.[resourceName]?.fields?.[expectedInvalidField]),
      'Enum value found when not expected'
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
    assert(!!report.warnings?.[expectedWarningMessage], 'Max length warning did not match');

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
    assert(!!report.errors?.[expectedErrorMessage], 'Max length error did not match');

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
    assert(!!report.errors?.[expectedErrorMessage], 'integer overflow error message did not match');
    metadata.fields.pop();
  });

  it('should show the nested expansion resource and field when expansion field is invalid', async () => {
    let errorMap = {};
    const expectedErrorMessage = 'Fields MUST be advertised in the metadata';
    const expectedErrorMessage2 = 'MUST be equal to one of the allowed values';
    const expectedInvalidParentField = 'ListAgent';
    const expectedInvalidParentResource = 'Property';
    const expectedInvalidSourceModel = 'Member';
    const expectedInvalidSourceModelField = 'Foo';
    const expectedInvalidSourceModelField2 = 'MemberDesignation';
    const expectedInvalidLookup = 'Graduate, REALTOR Institute / GRI';
    errorMap = validate({
      jsonSchema: schema,
      jsonPayload: nestedPayloadError,
      resourceName: 'Property',
      version: '2.0',
      errorMap
    });
    const report = combineErrors(errorMap);
    assert.equal(report.totalErrors, 2, 'Error counts did not match');
    assert(!!report.errors?.[expectedErrorMessage], 'nested expansion error message did not match');
    assert(!!report.errors?.[expectedErrorMessage2], 'nested expansion error message did not match');
    assert(
      !!report.errors[expectedErrorMessage].resources?.[expectedInvalidParentResource]?.fields?.[expectedInvalidParentField],
      'Expected field value not found'
    );
    assert(
      !!report.errors[expectedErrorMessage2].resources?.[expectedInvalidParentResource]?.fields?.[expectedInvalidParentField],
      'Expected field value not found'
    );
    assert.equal(
      report.errors[expectedErrorMessage].resources?.[expectedInvalidParentResource]?.fields?.[expectedInvalidParentField]?.sourceModel,
      expectedInvalidSourceModel,
      'Expansion resource did not match'
    );
    assert.equal(
      report.errors[expectedErrorMessage2].resources?.[expectedInvalidParentResource]?.fields?.[expectedInvalidParentField]?.sourceModel,
      expectedInvalidSourceModel,
      'Expansion resource did not match'
    );
    assert.equal(
      report.errors[expectedErrorMessage].resources?.[expectedInvalidParentResource]?.fields?.[expectedInvalidParentField]
        ?.sourceModelField,
      expectedInvalidSourceModelField,
      'Expansion field did not match'
    );
    assert.equal(
      report.errors[expectedErrorMessage2].resources?.[expectedInvalidParentResource]?.fields?.[expectedInvalidParentField]
        ?.sourceModelField,
      expectedInvalidSourceModelField2,
      'Expansion field did not match'
    );
    assert.equal(
      report.errors[expectedErrorMessage2].resources?.[expectedInvalidParentResource]?.fields?.[expectedInvalidParentField]?.lookups?.[
        expectedInvalidLookup
      ]?.count,
      1,
      'Invalid lookup count did not match'
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
    assert(!!report.errors?.[expectedErrorMessage], 'nested expansion error message did not match');
    assert(
      !!report.errors[expectedErrorMessage].resources?.[expectedInvalidResource]?.fields?.[expectedInvalidField],
      'Expected field value not found'
    );
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
    assert(!!report.errors?.[expectedErrorMessage], 'nested expansion error message did not match');
    assert(
      !!report.errors[expectedErrorMessage].resources?.[expectedInvalidResource]?.fields?.[expectedInvalidField],
      'Expected field value not found'
    );
    assert.equal(
      report.errors[expectedErrorMessage].resources?.[expectedInvalidResource]?.fields?.[expectedInvalidField]?.sourceModel,
      expectedInvalidSourceModel,
      'Expansion resource did not match'
    );
    assert.equal(
      report.errors[expectedErrorMessage].resources?.[expectedInvalidResource]?.fields?.[expectedInvalidField]?.sourceModelField,
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
    assert(!!report.errors?.[expectedErrorMessage], 'nested expansion error message did not match');
    assert(
      !!report.errors[expectedErrorMessage].resources?.[expectedInvalidResource]?.fields?.[expectedInvalidField],
      'Expected field value not found'
    );
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
    assert(!!report.errors?.[expectedErrorMessage], 'nested expansion error message did not match');
    assert(
      !!report.errors[expectedErrorMessage].resources?.[expectedInvalidResource]?.fields?.[expectedInvalidField],
      'Expected field value not found'
    );
    assert.equal(
      report.errors[expectedErrorMessage].resources?.[expectedInvalidResource]?.fields?.[expectedInvalidField]?.sourceModel,
      expectedInvalidSourceModel,
      'Expansion resource did not match'
    );
    assert.equal(
      report.errors[expectedErrorMessage].resources?.[expectedInvalidResource]?.fields?.[expectedInvalidField]?.sourceModelField,
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

    assert(!!report.errors?.[expectedErrorMessage1], 'error message did not match');
    assert(!!report.errors?.[expectedErrorMessage2], 'error message did not match');

    assert(
      !!report.errors[expectedErrorMessage1].resources?.[expectedResource1]?.fields?.[expectedField1],
      'Expected field value not found'
    );
    assert.equal(
      report.errors[expectedErrorMessage1].resources?.[expectedResource1]?.fields?.[expectedField1]?.count,
      2,
      'Error count did not match'
    );

    assert(
      !!report.errors[expectedErrorMessage2].resources?.[expectedResource2]?.fields?.[expectedField2],
      'Nested expansion field did not match'
    );
    assert.equal(
      report.errors[expectedErrorMessage2].resources?.[expectedResource2]?.fields?.[expectedField2]?.count,
      2,
      'Error count did not match'
    );

    assert.equal(
      report.errors[expectedErrorMessage2].resources?.[expectedResource2]?.fields?.[expectedField2]?.sourceModel,
      expectedInvalidSourceModel,
      'Expansion resource did not match'
    );

    assert.equal(
      report.errors[expectedErrorMessage2].resources?.[expectedResource2]?.fields?.[expectedField2]?.sourceModelField,
      expectedInvalidSourceModelField,
      'Expansion field did not match'
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
    assert(!!report.errors?.[expectedErrorMessage1], 'error message did not match');

    assert(
      !!report.errors[expectedErrorMessage1].resources?.[expectedResource1]?.fields?.[expectedField1],
      'Nested expansion field did not match'
    );
    assert.equal(
      report.errors[expectedErrorMessage1].resources?.[expectedResource1]?.fields?.[expectedField1]?.count,
      1,
      'Error count did not match'
    );

    assert.equal(
      report.errors[expectedErrorMessage1].resources?.[expectedResource1]?.fields?.[expectedField1]?.sourceModel,
      expectedInvalidSourceModel,
      'Expansion resource did not match'
    );

    assert.equal(
      report.errors[expectedErrorMessage1].resources?.[expectedResource1]?.fields?.[expectedField1]?.sourceModelField,
      expectedInvalidSourceModelField,
      'Expansion field did not match'
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
    assert(!!report.errors?.[expectedErrorMessage], 'enum error message did not match');
    assert(!!report.errors[expectedErrorMessage].resources?.[expectedResource]?.fields?.[expectedField], 'field did not match');
    assert(
      !!report.errors[expectedErrorMessage].resources?.[expectedResource]?.fields?.[expectedField]?.lookups?.[expectedEnumValue],
      'enum lookup value did not match'
    );
    assert.equal(
      report.errors[expectedErrorMessage].resources?.[expectedResource]?.fields?.[expectedField]?.sourceModel,
      expectedSourceModel,
      'expanded resource did not match'
    );
    assert.equal(
      report.errors[expectedErrorMessage].resources?.[expectedResource]?.fields?.[expectedField]?.sourceModelField,
      expectedSourceModelField,
      'expanded field did not match'
    );
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
    const resourceName = 'Property';

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
    const expectedErrorMessage = 'MUST be equal to one of the allowed values';

    assert.equal(report.totalErrors, 5, 'Error counts did not match');
    assert(!!report.errors?.[expectedErrorMessage], 'Error message did not match');

    assert.deepEqual(
      report.errors?.[expectedErrorMessage]?.resources?.[resourceName]?.keys,
      expectedPropertyKeys.concat(expectedMediaKeys).concat(expectedRoomKeys),
      'Record keys did not match'
    );
  });
});
