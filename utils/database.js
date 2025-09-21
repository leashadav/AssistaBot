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

// Save data function
async function saveData(userId, data) {
  const dataDir = path.join(__dirname, '../data');
  const userDataPath = path.join(dataDir, `${userId}.json`);
  
  // Check if the 'data' directory exists, if not, create it
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir);
  }

  // Save data to the user's JSON file
  try {
    fs.writeFileSync(userDataPath, JSON.stringify(data, null, 2));
    console.log(`Data saved for user ${userId}`);
  } catch (error) {
    console.error('Error saving data:', error);
  }
}

module.exports = { saveData, loadData };