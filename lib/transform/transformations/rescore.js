const rescore = data => {
  const fieldsMap = data.fields.reduce((acc, field) => {
    const { resourceName, fieldName } = field;
    if (!acc[resourceName]) acc[resourceName] = {};
    acc[resourceName][fieldName] = field;
    return acc;
  }, {});

  // const lookupValuesMap = data.lookupValues.reduce((acc, lookup) => {
  //   const { fieldName, resourceName, frequency, availability } = lookup;
  //   if (!acc[resourceName]) acc[resourceName] = {};
  //   if (!acc[resourceName][fieldName])
  //     acc[resourceName][fieldName] = {
  //       frequency: 0,
  //       availability: 0
  //     };
  //   acc[resourceName][fieldName].frequency += frequency;
  //   acc[resourceName][fieldName].availability += availability;
  //   return acc;
  // }, {});

  // TODO: verify that this is correct
  // sanity check values
  // Object.entries(lookupValuesMap).forEach(([rName, value]) => {
  //   Object.entries(value).forEach(([fName, { frequency, availability }]) => {
  //     if (fieldsMap[rName][fName].frequency !== frequency) {
  //       console.log(
  //         `Frequency mistmatch [${rName}-${fName}]\n Count: ${fieldsMap[rName][fName].frequency}\nActual: ${frequency}`
  //       );
  //     }
  //     if (fieldsMap[rName][fName].availability !== availability) {
  //       console.log(
  //         `Availability mistmatch.\n Count: ${fieldsMap[rName][fName].availability}\nActual: ${availability}`
  //       );
  //     }
  //   });
  // });

  // adjust frequency and availability values
  data.lookupValues.forEach(lookup => {
    const { fieldName, frequency, resourceName, availability, lookupValue } = lookup;
    if (lookupValue === 'EMPTY_LIST' || lookupValue === 'NULL_VALUE') {
      // only adjust counts if not adjusted already (prevents multiple count adjustments)
      if (fieldsMap[resourceName][fieldName].frequency > frequency)
        fieldsMap[resourceName][fieldName].frequency -= frequency;
      if (fieldsMap[resourceName][fieldName].availability > availability)
        fieldsMap[resourceName][fieldName].availability -= availability;
    }
  });

  return data;
};

module.exports = { rescore };
