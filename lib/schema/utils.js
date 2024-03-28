'use strict';

const fs = require('fs/promises');
const fsPromises = fs;
const path = require('path');
const { readZipFileContents } = require('../../common');

/**
 * @param {Object} obj
 * @param {string} obj.inputPath
 * @param {{}} obj.fileContentsMap
 *
 * @description Takes an input path as a JSON file, directory, or zip file. Flattens all nested JSON files into the output directory.
 */
const processFiles = async ({ inputPath, fileContentsMap }) => {
  const stats = await fsPromises.stat(inputPath);

  if (stats.isFile()) {
    const fileName = inputPath.slice(inputPath.lastIndexOf('/') + 1, inputPath.length);
    const contents = await processFile({ filePath: inputPath });
    if (fileName.endsWith('.zip')) {
      Object.keys(contents).forEach(file => {
        contents[file] = JSON.parse(contents[file]);
      });
      Object.assign(fileContentsMap, contents);
    } else {
      fileContentsMap[fileName] = contents;
    }
  } else if (stats.isDirectory()) {
    const files = await fsPromises.readdir(inputPath);
    for (const file of files) {
      const fileName = file.slice(file.lastIndexOf('/') + 1, file.length);
      const content = await processFile({
        filePath: path.join(inputPath, file)
      });
      if (fileName.endsWith('.zip')) {
        Object.keys(content).forEach(file => {
          content[file] = JSON.parse(content[file]);
        });
        Object.assign(fileContentsMap, content);
      } else {
        fileContentsMap[fileName] = content;
      }
    }
  } else {
    console.error(`Unsupported file type: ${inputPath}`);
  }
};

/**
 * @param {Object} obj
 * @param {string} obj.filePath
 *
 * @description Process JSON and zip files and copy them to the output path
 */
const processFile = async ({ filePath }) => {
  const ext = path.extname(filePath);

  if (ext === '.json') {
    return JSON.parse((await readFile(filePath)).toString());
  } else if (ext === '.zip') {
    return readZipFileContents(filePath);
  } else {
    console.error(`Unsupported file type: ${filePath}`);
  }
};

/**
 *
 * TODO: this already exists elsewhere - move to common
 *
 * @param {string} filePath
 * @returns Contents read from the file. Returns null if file isn't present.
 */
const readFile = async filePath => {
  try {
    return await fs.readFile(filePath);
  } catch (err) {
    console.error(`Could not read file from path '${filePath}'! Error: ${err}`);
    return null;
  }
};

/**
 * @param {string} dirName
 *
 * @description Checks if a directory exists. If not it creates the directory. If there was an error creating the directory, it returns null otherwise a truthy value.
 */
const createDirectoryIfNotPresent = async dirName => {
  try {
    await fs.stat(dirName);
  } catch (err) {
    try {
      await fs.mkdir(dirName);
    } catch (err) {
      return null;
    }
  }
  return true;
};

/**
 * @param {string} path
 * @param {string} data
 *
 * @description Attempts to write data intp a given file path. Returns tru on success and false in case of a failure.
 */
const writeFile = async (path, data) => {
  await fs.writeFile(path, data);
  return true;
};

/**
 *
 * @param {Object} obj
 * @param {string[]} obj.arr
 * @param {boolean} obj.isValueArray
 * @returns
 */
const parseNestedPropertyForResourceAndField = ({ arr, isValueArray }) => {
  if (isValueArray) {
    let arrIndexCount = 0;
    arr.forEach(a => {
      if (typeof Number(a) === 'number' && !isNaN(Number(a))) arrIndexCount++;
    });
    if (arrIndexCount >= 2) {
      const lastElement = arr.at(-1);
      if (typeof Number(lastElement) === 'number' && !isNaN(Number(lastElement))) {
        return {
          fieldName: arr[2]
        };
      }
      return {
        resourceName: arr[2],
        fieldName: arr[4]
      };
    } else {
      return {
        fieldName: arr[2]
      };
    }
  } else {
    if (arr.length === 3) {
      return {
        resourceName: arr[0],
        fieldName: arr[2]
      };
    } else {
      return {
        fieldName: arr[0]
      };
    }
  }
};

module.exports = {
  processFiles,
  readFile,
  createDirectoryIfNotPresent,
  writeFile,
  parseNestedPropertyForResourceAndField
};
