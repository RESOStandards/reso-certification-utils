const fs = require('fs');
const fsPromises = fs.promises;
const path = require('path');
const { extractFilesFromZip } = require('../../common');

const processFiles = async ({ inputPath, outputPath }) => {
  try {
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
  } catch (error) {
    console.log(error);
    return { error };
  }
};

const processFile = async ({ filePath, outputPath }) => {
  const ext = path.extname(filePath);

  if (ext === '.json') {
    await fsPromises.copyFile(filePath, path.join(outputPath, path.basename(filePath)));
  } else if (ext === '.zip') {
    await extractFilesFromZip({
      zipPath: filePath,
      outputPath
    });
  } else {
    console.error(`Unsupported file type: ${filePath}`);
  }
};

const readFile = async filePath => {
  try {
    return await fs.readFile(filePath);
  } catch (err) {
    console.error(`Could not read file from path '${filePath}'! Error: ${err}`);
    return null;
  }
};

const createDirectoryIfNotPresent = async dirName => {
  try {
    await fs.stat(dirName);
  } catch (error) {
    try {
      await fs.mkdir(dirName);
    } catch (error) {
      return null;
    }
  }
  return true;
};

const writeFile = async (path, data) => {
  try {
    await fs.writeFile(path, data);
    return true;
  } catch (error) {
    console.log(error);
    return false;
  }
};

module.exports = {
  processFiles,
  readFile,
  createDirectoryIfNotPresent,
  writeFile
};
