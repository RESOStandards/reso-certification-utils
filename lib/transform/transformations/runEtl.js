const {
  processDataAvailability: { processDataAvailability }
} = require('@reso/reso-certification-etl');
const runEtlOnReport = async data => {
  try {
    // recover the raw availability report
    const {
      description = 'RESO Data Availability Report',
      version,
      generatedOn,
      resources,
      fields,
      lookupValues,
      lookups,
      optInStatus
    } = data;

    const rawAvailabilityReport = {
      resources,
      fields: fields.map(({ resourceName, fieldName, frequency }) => ({
        resourceName,
        fieldName,
        frequency
      })),
      lookupValues: lookupValues.map(({ resourceName, fieldName, lookupValue, frequency }) => ({
        resourceName,
        fieldName,
        lookupValue,
        frequency
      })),
      lookups
    };

    const rescoredReport = await processDataAvailability(rawAvailabilityReport);

    return {
      ...rescoredReport,
      description,
      version,
      generatedOn,
      optInStatus
    };
  } catch (error) {
    console.log(error);
    return null;
  }
};

module.exports = {
  runEtlOnReport
};
