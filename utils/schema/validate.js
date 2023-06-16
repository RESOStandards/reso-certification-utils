const Ajv = require('ajv');
const addFormats = require('ajv-formats');

const ajv = new Ajv({ allErrors: true, coerceTypes: false, strict: true });
addFormats(ajv);

function validatePayload(schema, json) {
  const validate = ajv.compile(schema);
  const valid = validate(json);
  if (!valid) {
    return {
      errors: validate.errors
    };
  }
  return true;
}

module.exports = {
  validatePayload
};
