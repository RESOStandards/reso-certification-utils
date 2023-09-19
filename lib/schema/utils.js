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

module.exports = {
  processFiles
};
