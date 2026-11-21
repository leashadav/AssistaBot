const fs = require('fs');
const path = require('path');
const { getBuiltInDirectory } = require('../modules/commandDirectory');

const outputPath = path.join(__dirname, '..', 'docs', 'commands', 'commands.json');
const directory = getBuiltInDirectory();

fs.writeFileSync(outputPath, `${JSON.stringify(directory, null, 2)}\n`, 'utf8');
console.info(`Generated built-in command directory at ${outputPath}`);
