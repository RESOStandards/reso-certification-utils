'use strict';

const assert = require('assert');
const { generateJsonSchema } = require('..');

const {
  collectionFields,
  enumFieldsAndLookups,
  expansionFields,
  fieldsWithImplicitNullable,
  fieldsWithMaxLength,
  nonNullableField,
  nullableCollectionFields,
  simpleNonEnumFields
} = require('./schema/metadata-samples');
const {
  collectionFieldsSchema,
  enumFieldsAndLookupsSchema,
  expansionFieldsSchema,
  nonNullableSchema,
  nullableCollectionFieldsSchema,
  schemaWithImplicitNullable,
  schemaWithMaxLength,
  simpleNonEnumSchema
} = require('./schema/schema-samples');

describe('Schema generation tests', () => {
  it('Should generate valid schema for simple non enum fields', async () => {
    const generatedSchema = await generateJsonSchema({ metadataReportJson: simpleNonEnumFields });
    assert.deepEqual(generatedSchema, simpleNonEnumSchema);
  });

  it('Should generate valid schema for collection fields', async () => {
    // TODO: is this correct?
    // const generatedSchema = await generateJsonSchema({ metadataReportJson: collectionFields });
    // assert.deepEqual(generatedSchema, collectionFieldsSchema);
  });

  it('Should generate valid schema for enum fields and lookups', async () => {
    // TODO: is this correct?
    // const generatedSchema = await generateJsonSchema({ metadataReportJson: enumFieldsAndLookups });
    // assert.deepEqual(generatedSchema, enumFieldsAndLookupsSchema);
  });

  it('Should generate valid schema for expansion fields', async () => {
    const generatedSchema = await generateJsonSchema({ metadataReportJson: expansionFields });
    assert.deepEqual(generatedSchema, expansionFieldsSchema);
  });

  it('Should generate valid schema for fields with implicit nullable', async () => {
    const generatedSchema = await generateJsonSchema({ metadataReportJson: fieldsWithImplicitNullable });
    assert.deepEqual(generatedSchema, schemaWithImplicitNullable);
  });

  it('Should generate valid schema for fields with max length', async () => {
    const generatedSchema = await generateJsonSchema({ metadataReportJson: fieldsWithMaxLength });
    assert.deepEqual(generatedSchema, schemaWithMaxLength);
  });

  it('Should generate valid schema for non-nullable field', async () => {
    const generatedSchema = await generateJsonSchema({ metadataReportJson: nonNullableField });
    assert.deepEqual(generatedSchema, nonNullableSchema);
  });

  it('Should generate valid schema for nullable collection fields', async () => {
    // TODO: is this correct?
    // const generatedSchema = await generateJsonSchema({ metadataReportJson: nullableCollectionFields });
    // assert.deepEqual(generatedSchema, nullableCollectionFieldsSchema);
  });
});
