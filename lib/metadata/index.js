'use strict';
const { readFile, writeFile } = require('fs/promises');
const { XMLParser } = require('fast-xml-parser');

const METADATA_REPORT_JSON_FILE = 'metadata-report.json';

const convertMetadata = async ({ pathToXmlMetadata = '' }) => {
  try {
    const data = await readFile(pathToXmlMetadata);
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' });
    const parsed = parser.parse(data);
    await writeFile(METADATA_REPORT_JSON_FILE, JSON.stringify(parsed, null, '  '));
  } catch (err) {
    console.error(err);
  }
};

module.exports = {
  convertMetadata
};
