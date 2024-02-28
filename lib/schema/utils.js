'use strict';

const fs = require('fs/promises');
const fsPromises = fs;
const path = require('path');
const { extractFilesFromZip } = require('../../common');

/**
 * @param {Object} obj
 * @param {string} obj.inputPath
 * @param {string} obj.outputPath
 *
 * @description Takes an input path as a JSON file, directory, or zip file. Flattens all nested JSON files into the output directory.
 */
const processFiles = async ({ inputPath, outputPath }) => {
  const stats = await fsPromises.stat(inputPath);

  if (stats.isFile()) {
    await processFile({ filePath: inputPath, outputPath });
  } else if (stats.isDirectory()) {
    const files = await fsPromises.readdir(inputPath);

    for (const file of files) {
      await processFile({
        filePath: path.join(inputPath, file),
        outputPath
      });
    }
  } else {
    console.error(`Unsupported file type: ${inputPath}`);
  }
  const outputFiles = await fsPromises.readdir(outputPath);
  const promises = [];
  for (const path of outputFiles) {
    promises.push(
      new Promise((res, rej) => {
        fsPromises.stat(`${outputPath}/${path}`).then(async stats => {
          try {
            if (stats.isDirectory()) {
              if (path.includes('__MACOSX')) {
                await fs.rm(`${outputPath}/${path}`, { recursive: true, force: true });
              } else if (!path.includes('__processed__')) {
                await fs.rename(`${outputPath}/${path}`, `${outputPath}/${path}__processed__`);
                await processFiles({ inputPath: `${outputPath}/${path}__processed__`, outputPath });
                await fs.rm(`${outputPath}/${path}__processed__`, { recursive: true, force: true });
              }
            }
            res();
          } catch (error) {
            rej(error);
          }
        });
      })
    );
  }
  await Promise.allSettled(promises);
};

/**
 * @param {Object} obj
 * @param {string} obj.filePath
 * @param {string} obj.outputPath
 *
 * @description Process JSON and zip files and copy them to the output path
 */
const processFile = async ({ filePath, outputPath }) => {
  const ext = path.extname(filePath);

  if (ext === '.json') {
    await fsPromises.copyFile(filePath, path.join(outputPath, path.basename(filePath)));
  } else if (ext === '.zip') {
    await extractFilesFromZip({
      zipPath: filePath,
      outputPath: path.resolve(outputPath)
    });
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
