'use strict';

const columns = Object.freeze([
  { sheetColumnName: 'Resource Name', jsonName: 'resourceName' },
  { sheetColumnName: 'Field Name', jsonName: 'fieldName' },
  { sheetColumnName: 'Lookup Value', jsonName: 'lookupValue' },
  { sheetColumnName: 'Suggested Resource Name', jsonName: 'suggestedResourceName' },
  { sheetColumnName: 'Suggested Field Name', jsonName: 'suggestedFieldName' },
  { sheetColumnName: 'Suggested Lookup Value', jsonName: 'suggestedLookupValue' },
  { sheetColumnName: 'Suggested Parent Resource Name', jsonName: 'suggestedParentResourceName' },
  { sheetColumnName: 'Suggested Parent Field Name', jsonName: 'suggestedParentFieldName' },
  { sheetColumnName: 'Suggested Parent Lookup Value', jsonName: 'suggestedParentLookupValue' }
]);

const convertVariationsCsvToJson = csvData => {
  const DELIMITER = ',';

  const [headerRow, ...suggestions] = csvData.split(`\n`);

  if (!(headerRow && headerRow?.length && headerRow.includes(DELIMITER))) {
    throw new Error(`Header row isn't in the correct format!`);
  }

  const columnIndexMap = headerRow.split(DELIMITER).reduce((acc, cur, i) => {
    if (columns.some(column => column?.sheetColumnName?.includes(cur))) {
      acc[i] = columns[i];
    }
    return acc;
  }, {});

  return suggestions.map(suggestion => {
    const values = suggestion.split(DELIMITER) ?? [];
    return values.reduce((acc, value, i) => {
      if (!!value && !!columnIndexMap[i]?.jsonName) {
        acc[columnIndexMap[i].jsonName] = value;
      }
      return acc;
    }, {});
  });
};

module.exports = {
  convertVariationsCsvToJson
};
