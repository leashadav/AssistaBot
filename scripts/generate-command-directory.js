const fs = require('fs');
const path = require('path');
const { getDirectory } = require('../modules/commandDirectory');

const outputPath = path.join(__dirname, '..', 'docs', 'commands', 'commands.json');
const directory = getDirectory();

fs.writeFileSync(outputPath, `${JSON.stringify(directory, null, 2)}\n`, 'utf8');
console.info(`Generated prefix command directory at ${outputPath}`);
