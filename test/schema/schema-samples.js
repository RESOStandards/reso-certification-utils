const simpleNonEnumSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  oneOf: [
    { properties: { '@reso.context': { type: 'string' } }, additionalProperties: false },
    { properties: { '@reso.context': { type: 'string' }, value: { type: 'array' } }, additionalProperties: false }
  ],
  definitions: {
    Property: {
      type: 'object',
      properties: { AboveGradeFinishedArea: { type: ['number', 'null'] }, BuyerTeamName: { type: ['string', 'null'] } },
      additionalProperties: false
    }
  }
};

const schemaWithMaxLength = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  oneOf: [
    { properties: { '@reso.context': { type: 'string' } }, additionalProperties: false },
    { properties: { '@reso.context': { type: 'string' }, value: { type: 'array' } }, additionalProperties: false }
  ],
  definitions: {
    Property: {
      type: 'object',
      properties: {
        BuyerTeamName: {
          type: ['string', 'null'],
          maxLength: 50,
          errorMessage: { maxLength: 'SHOULD have a maximum suggested length of 50 characters' }
        }
      },
      additionalProperties: false
    }
  }
};

const schemaWithImplicitNullable = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  oneOf: [
    { properties: { '@reso.context': { type: 'string' } }, additionalProperties: false },
    { properties: { '@reso.context': { type: 'string' }, value: { type: 'array' } }, additionalProperties: false }
  ],
  definitions: {
    Property: {
      type: 'object',
      properties: {
        BuyerTeamName: {
          type: ['string', 'null'],
          maxLength: 50,
          errorMessage: { maxLength: 'SHOULD have a maximum suggested length of 50 characters' }
        }
      },
      additionalProperties: false
    }
  }
};

const nonNullableSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  oneOf: [
    { properties: { '@reso.context': { type: 'string' } }, additionalProperties: false },
    { properties: { '@reso.context': { type: 'string' }, value: { type: 'array' } }, additionalProperties: false }
  ],
  definitions: {
    Property: {
      type: 'object',
      properties: {
        BuyerTeamName: {
          type: 'string',
          maxLength: 50,
          errorMessage: { maxLength: 'SHOULD have a maximum suggested length of 50 characters' }
        }
      },
      additionalProperties: false
    }
  }
};

const enumFieldsAndLookupsSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  oneOf: [
    { properties: { '@reso.context': { type: 'string' } }, additionalProperties: false },
    { properties: { '@reso.context': { type: 'string' }, value: { type: 'array' } }, additionalProperties: false }
  ],
  definitions: {
    Property: {
      type: 'object',
      properties: {
        AboveGradeFinishedAreaSource: {
          type: ['string', 'null'],
          enum: ['Appraiser', 'Assessor', 'Builder', 'Estimated', 'Other', 'Owner', 'Plans', 'PublicRecords', 'SeeRemarks', null]
        }
      },
      additionalProperties: false
    }
  }
};

const collectionFieldsSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  oneOf: [
    { properties: { '@reso.context': { type: 'string' } }, additionalProperties: false },
    { properties: { '@reso.context': { type: 'string' }, value: { type: 'array' } }, additionalProperties: false }
  ],
  definitions: {
    Property: {
      type: 'object',
      properties: {
        AvailableLeaseType: {
          type: 'array',
          items: {
            type: ['string'],
            enum: ['AbsoluteNet', 'CpiAdjustment', 'EscalationClause', 'Gross', 'GroundLease', 'Net', 'Nn', 'Nnn', 'Oral']
          }
        }
      },
      additionalProperties: false
    }
  }
};

const expansionFieldsSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  oneOf: [
    { properties: { '@reso.context': { type: 'string' } }, additionalProperties: false },
    { properties: { '@reso.context': { type: 'string' }, value: { type: 'array' } }, additionalProperties: false }
  ],
  definitions: {
    Teams: {
      type: 'object',
      properties: { ModificationTimestamp: { type: ['string', 'null'] }, OriginalEntryTimestamp: { type: ['string', 'null'] } },
      additionalProperties: false
    },
    Property: { type: 'object', properties: { ListTeam: { $ref: '#/definitions/Teams' } }, additionalProperties: false }
  }
};

const nullableCollectionFieldsSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  oneOf: [
    { properties: { '@reso.context': { type: 'string' } }, additionalProperties: false },
    { properties: { '@reso.context': { type: 'string' }, value: { type: 'array' } }, additionalProperties: false }
  ],
  definitions: {
    Property: {
      type: 'object',
      properties: {
        AvailableLeaseType: {
          type: 'array',
          items: {
            type: ['string'],
            enum: ['AbsoluteNet', 'CpiAdjustment', 'EscalationClause', 'Gross', 'GroundLease', 'Net', 'Nn', 'Nnn', 'Oral', null]
          }
        }
      },
      additionalProperties: false
    }
  }
};

module.exports = {
  simpleNonEnumSchema,
  schemaWithMaxLength,
  schemaWithImplicitNullable,
  nonNullableSchema,
  enumFieldsAndLookupsSchema,
  collectionFieldsSchema,
  expansionFieldsSchema,
  nullableCollectionFieldsSchema
};
