const fs = require('fs');
const path = require('path');

function saveData(file, data) {
  fs.writeFileSync(path.join(__dirname, '..', file), JSON.stringify(data, null, 2));
}

function loadData(file) {
  const filePath = path.join(__dirname, '..', file);
  if (!fs.existsSync(filePath)) return {};
  return JSON.parse(fs.readFileSync(filePath));
}

module.exports = { saveData, loadData };