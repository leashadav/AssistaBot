const fs = require('fs');
const path = require('path');

// Utilities
function ensureDirSync(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function atomicWriteSync(filePath, dataStr) {
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, dataStr);
  fs.renameSync(tmp, filePath);
}

// Generic load/save for arbitrary file under project root (..)
function loadData(file) {
  const filePath = path.join(__dirname, '..', file);
  if (!fs.existsSync(filePath)) return {};
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw || '{}');
  } catch (e) {
    console.error('database.loadData error:', e);
    return {};
  }
}

function saveData(file, data) {
  const filePath = path.join(__dirname, '..', file);
  try {
    ensureDirSync(path.dirname(filePath));
    const str = JSON.stringify(data, null, 2);
    atomicWriteSync(filePath, str);
  } catch (e) {
    console.error('database.saveData error:', e);
  }
}

// Per-user helpers reading/writing to data/{userId}.json
function saveUserData(userId, data) {
  const dataDir = path.join(__dirname, '..', 'data');
  ensureDirSync(dataDir);
  const userDataPath = path.join(dataDir, `${userId}.json`);
  try {
    const str = JSON.stringify(data, null, 2);
    atomicWriteSync(userDataPath, str);
    if (process.env.DEBUG === 'true') {
      console.log(`Data saved for user ${userId}`);
    }
  } catch (error) {
    console.error('database.saveUserData error:', error);
  }
}

function loadUserData(userId) {
  const userDataPath = path.join(__dirname, '..', 'data', `${userId}.json`);
  if (!fs.existsSync(userDataPath)) return {};
  try {
    const raw = fs.readFileSync(userDataPath, 'utf8');
    return JSON.parse(raw || '{}');
  } catch (e) {
    console.error('database.loadUserData error:', e);
    return {};
  }
}

module.exports = { saveData, loadData, saveUserData, loadUserData };