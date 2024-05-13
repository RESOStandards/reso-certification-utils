const createValidationContext = () => {
  // TODO: add more general info related to the currently processing schema/payload here so that it could be use across the
  // process w/o passing around states
  let activeResource = '';
  let isRCF = false;
  let ddVersion = '';
  let schema = null;
  /**
   * @type {'SINGLE'|'MULTI'|null}
   */
  let payloadType = null;
  let validationConfig = null;
  return {
    getActiveResource: () => activeResource,
    setActiveResource: resource => {
      activeResource = resource;
    },
    setRCF: rcf => {
      isRCF = rcf;
    },
    isRCF: () => isRCF,
    getVersion: () => ddVersion,
    setVersion: version => {
      ddVersion = version;
    },
    getSchema: () => schema,
    setSchema: s => {
      schema = s;
    },
    getPayloadType: () => payloadType,
    /**
     *
     * @param {'SINGLE'|'MULTI'|null} p
     */
    setPayloadType: p => {
      payloadType = p;
    },
    getValidationConfig: () => validationConfig,
    setValidationConfig: config => {
      validationConfig = config;
    },
    reset: () => {
      activeResource = '';
      isRCF = false;
      ddVersion = '';
      schema = null;
      payloadType = null;
      validationConfig = null;
    }
  };
};

const validationContext = createValidationContext();

module.exports = {
  validationContext
};
