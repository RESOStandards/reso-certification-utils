const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const chalk = require('chalk');
const { getReferenceMetadata } = require('@reso/reso-certification-etl');

const ajv = new Ajv({ allErrors: true, coerceTypes: false, strict: true });
addFormats(ajv);

/**
 We can maybe expose a method from ETL lib that gives us the current valid DD version.
 This would mean that we only have to update the ETL lib to support newer version of DD.
 * */
const VALID_DD_VERSIONS = ['1.7', '2.0'];

function validatePayload(json, schema) {
  /**
   * Step 1 - Analyze the payload and parse out the relevant data like the version, resourceName, etc.
   *
   * Using this additional info we can improve our generated schema by providing a resource against which
   * the payload should be validated.
   */
  try {
    if (!json['@reso.context']) {
      throw new Error('The required field "@reso.context" was not present in the payload');
    }
    const { resource, version } = parseResoUrn(json['@reso.context']);
    if (!VALID_DD_VERSIONS.includes(version))
      throw new Error(`Found invalid DD version ${version} - Supported versions are ${VALID_DD_VERSIONS}`);
    const referenceMetadata = getReferenceMetadata(version);
    if (
      !referenceMetadata?.resources.find(r => r.resourceName.toLowerCase() === resource.toLocaleLowerCase())
    )
      throw new Error(`Found invalid reource: ${resource}`);

    const { definitions } = schema;
    const singleValueSchema = schema?.oneOf?.find(s => !s.properties.value);
    const multiValueSchema = schema?.oneOf?.find(s => s.properties.value);

    const formattedResourceName = Object.keys(definitions).find(
      r => r.toLowerCase() === resource.toLowerCase()
    );

    if (!json.value) {
      schema.oneOf = [singleValueSchema];
      // extend the generated schema with new info from the specific payload
      Object.assign(singleValueSchema.properties, definitions[formattedResourceName].properties);
    } else {
      schema.oneOf = [multiValueSchema];
      multiValueSchema.properties.value.items = {
        $ref: `#/definitions/${formattedResourceName}`
      };
    }
  } catch (error) {
    console.error(chalk.redBright.bold('ERROR: ' + error.message));
    return {
      errors: error.message
    };
  }

  // Step 2 - Vlaidate with AJV
  const validate = ajv.compile(schema);
  const valid = validate(json);
  if (!valid) {
    return {
      errors: validate.errors
    };
  }
  return true;
}

function parseResoUrn(urn = '') {
  const parts = urn?.split?.(':') || '';

  if (parts.length < 6 || parts[0] !== 'urn' || parts[1] !== 'reso' || parts[2] !== 'metadata') {
    throw new Error('Invalid URN');
  }

  return {
    version: parts[3],
    resource: parts.slice(5)[0]
  };
}

module.exports = {
  validatePayload
};
