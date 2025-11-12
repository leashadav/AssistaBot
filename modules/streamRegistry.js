const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_PATH = path.join(DATA_DIR, 'streams.json');

// Fresh data structure
let db = {}; // { [guildId]: Array<StreamEntry> }
let presence = {}; // { [guildId]: { [platform]: PresenceRule } }

// Helper utilities
const toStr = (v) => (v === undefined || v === null ? '' : String(v));
const toLower = (v) => toStr(v).toLowerCase();
const toId = (v) => toStr(v).trim();
const isPlatform = (p) => ['twitch', 'youtube', 'rumble', 'tiktok', 'kick', 'instagram', 'discord', 'facebook', 'x'].includes(toLower(p));
const uniq = (arr) => Array.from(new Set(arr));
const cleanIds = (ids) => uniq((Array.isArray(ids) ? ids : [ids]).filter(Boolean).map(toId).filter(Boolean));

/**
 * @typedef {Object} StreamEntry
 * @property {string} platform - The platform (twitch, youtube, etc.)
 * @property {string} name - The streamer's name on the platform
 * @property {string|null} channelId - Discord channel ID for notifications
 * @property {string|null} message - Custom notification message
 * @property {string[]} liveRoleIds - Array of role IDs to assign when live
 * @property {string[]} whitelistRoleIds - Array of role IDs that can trigger notifications
 */

/**
 * @typedef {Object} PresenceRule
 * @property {string} channelId - Discord channel ID for notifications
 * @property {string|null} message - Custom notification message
 * @property {string[]} liveRoleIds - Array of role IDs to assign when live
 * @property {string[]} whitelistRoleIds - Array of role IDs that can trigger notifications
 */

function ensureFiles() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(DATA_PATH)) {
      fs.writeFileSync(DATA_PATH, JSON.stringify({ _presence: {} }, null, 2), 'utf8');
    }
  } catch (error) {
    console.error('streamRegistry ensureFiles error:', error?.message || 'Unknown error');
  }
}

function load() {
  ensureFiles();
  try {
    // Initialize with empty data
    db = {};
    presence = {};
    
    // Only try to load if file exists
    if (fs.existsSync(DATA_PATH)) {
      try {
        const rawData = fs.readFileSync(DATA_PATH, 'utf8');
        if (rawData && rawData.trim()) {
          const data = JSON.parse(rawData);
          
          // Handle presence data
          if (data._presence) {
            presence = data._presence;
            delete data._presence;
          }
          
          // Handle guild data
          for (const [guildId, guildData] of Object.entries(data)) {
            if (Array.isArray(guildData)) {
              // Already in array format
              db[guildId] = guildData;
            } else if (guildData && typeof guildData === 'object') {
              // Convert old object format to array
              db[guildId] = Object.values(guildData);
            } else {
              // Invalid format, initialize as empty array
              db[guildId] = [];
            }
          }
        }
      } catch (parseError) {
        console.error('Error parsing streams.json:', parseError);
        // If there's an error parsing, initialize with empty data
        db = {};
        presence = {};
      }
    }
    
    // Ensure presence is always an object
    if (!presence || typeof presence !== 'object') {
      presence = {};
    }
    
    // Save the cleaned up data
    save();
  } catch (error) {
    console.error('streamRegistry load error:', error?.message || 'Unknown error');
    db = {};
    presence = {};
  }
}

function save() {
  try {
    ensureFiles();
    
    // Create a clean copy of the data to save
    const toWrite = { _presence: presence || {} };
    
    // Only include valid guild data
    for (const guildId in db) {
      if (db.hasOwnProperty(guildId) && Array.isArray(db[guildId])) {
        // Filter out any invalid entries
        toWrite[guildId] = db[guildId].filter(entry => 
          entry && 
          typeof entry === 'object' && 
          entry.platform && 
          entry.name
        );
      }
    }
    
    // Write to a temporary file first, then rename to prevent corruption
    const tempPath = DATA_PATH + '.tmp';
    fs.writeFileSync(tempPath, JSON.stringify(toWrite, null, 2), 'utf8');
    
    // On Windows, we need to remove the destination file first if it exists
    if (process.platform === 'win32' && fs.existsSync(DATA_PATH)) {
      fs.unlinkSync(DATA_PATH);
    }
    
    // Rename the temp file to the actual file
    fs.renameSync(tempPath, DATA_PATH);
  } catch (error) {
    console.error('streamRegistry save error:', error?.message || 'Unknown error');
    // Try to ensure we don't leave a corrupted file
    try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch (e) {}
  }
}

function ensureGuild(guildId) {
  const gid = String(guildId);
  if (!db[gid]) db[gid] = [];
  return db[gid];
}

function list(guildId) {
  return ensureGuild(toStr(guildId));
}

function add(guildId, entry) {
  const gid = toStr(guildId);
  const arr = ensureGuild(gid);
  const platform = toLower(entry.platform);
  const name = toId(entry.name);
  
  if (!platform || !name) return { ok: false, reason: 'missing platform or name' };
  if (!isPlatform(platform)) return { ok: false, reason: 'invalid platform' };
  
  // Check for duplicates
  const key = (s) => `${s.platform}:${toLower(s.name)}`;
  if (arr.some(e => key(e) === key({ platform, name }))) {
    return { ok: false, reason: 'duplicate' };
  }
  
  // Create new entry with only the fields we want to keep
  const newEntry = {
    platform,
    name,
    channelId: entry.channelId || null,
    message: entry.message || null,
    vodMessage: entry.vodMessage || null,
    liveRoleIds: cleanIds(entry.liveRoleIds || []),
    whitelistRoleIds: cleanIds(entry.whitelistRoleIds || [])
  };
  
  arr.push(newEntry);
  save();
  return { ok: true, entry: newEntry };
}

function remove(guildId, platform, name) {
  const gid = toStr(guildId);
  const arr = ensureGuild(gid);
  const p = toLower(platform);
  const n = toLower(name);
  const before = arr.length;
  db[gid] = arr.filter(e => !(e.platform === p && toLower(e.name) === n));
  save();
  return { removed: before - db[gid].length };
}

function update(guildId, platform, name, patch) {
  const gid = toStr(guildId);
  const arr = ensureGuild(gid);
  
  // Normalize platform and name to lowercase for comparison
  const normalizedPlatform = toLower(platform);
  const normalizedName = toLower(name);
  
  // Find the entry with case-insensitive comparison
  const idx = arr.findIndex(e => 
    toLower(e.platform) === normalizedPlatform && 
    toLower(e.name) === normalizedName
  );
  
  if (idx === -1) return { ok: false, reason: 'not found' };
  
  // Update the entry with the new values
  const entry = arr[idx];
  
  // Ensure platform is always stored in lowercase for consistency
  entry.platform = normalizedPlatform;
  
  if (patch.channelId !== undefined) entry.channelId = patch.channelId;
  if (patch.message !== undefined) entry.message = patch.message;
  if (patch.vodMessage !== undefined) entry.vodMessage = patch.vodMessage;
  if (patch.liveRoleIds) entry.liveRoleIds = cleanIds(patch.liveRoleIds);
  if (patch.whitelistRoleIds) entry.whitelistRoleIds = cleanIds(patch.whitelistRoleIds);
  if (patch.discordUser !== undefined) entry.discordUser = patch.discordUser;
  
  // Clean up any legacy fields
  if (Object.prototype.hasOwnProperty.call(entry, 'liveRoleId')) delete entry.liveRoleId;
  
  save();
  return { ok: true, entry };
}

function getPresence(guildId) {
  const gid = toStr(guildId);
  return presence[gid] || {};
}

/**
 * Set presence-based live role configuration
 * @param {string} guildId - The Discord guild ID
 * @param {string} platform - The platform (e.g., 'discord', 'youtube')
 * @param {Object} rule - The rule configuration
 * @param {string} [rule.channelId] - Channel ID for notifications
 * @param {string} [rule.message] - Custom notification message
 * @param {string[]} [rule.liveRoleIds] - Array of role IDs to assign when live
 * @param {string[]} [rule.whitelistRoleIds] - Array of role IDs that can receive the live role
 * @returns {{ok: boolean, rule: Object}} Result object
 */
function setPresenceLiveRoles(guildId, platform, rule) {
  const gid = toStr(guildId);
  if (!presence[gid]) presence[gid] = {};
  
  // Only keep the fields we care about
  const norm = {
    channelId: rule.channelId || null,
    message: rule.message || null,
    liveRoleIds: cleanIds(rule.liveRoleIds || []),
    whitelistRoleIds: cleanIds(rule.whitelistRoleIds || [])
  };
  
  // Update or create the platform entry
  presence[gid][toLower(platform)] = norm;
  save();
  
  return { ok: true, rule: norm };
}

/**
 * Set API-based live role configuration for a specific streamer
 * @param {string} guildId - The Discord guild ID
 * @param {string} platform - The platform (e.g., 'twitch', 'youtube')
 * @param {string} streamerId - The streamer's ID on the platform
 * @param {Object} config - The configuration object
 * @param {string[]} [config.liveRoleIds] - Array of role IDs to assign when live
 * @param {string[]} [config.whitelistRoleIds] - Array of role IDs that can receive the live role
 * @returns {{ok: boolean, entry: Object}} Result object with updated entry
 */
function setApiLiveRoles(guildId, platform, streamerId, config) {
  const gid = toStr(guildId);
  const arr = ensureGuild(gid);
  const normalizedPlatform = toLower(platform);
  const normalizedId = toLower(streamerId);
  
  // Find the entry with case-insensitive comparison
  const idx = arr.findIndex(e => 
    toLower(e.platform) === normalizedPlatform && 
    toLower(e.id) === normalizedId
  );
  
  if (idx === -1) return { ok: false, reason: 'not found' };
  
  // Update the entry with the new values
  const entry = arr[idx];
  
  // Update live role configuration
  if (config.liveRoleIds) {
    entry.liveRoleIds = cleanIds(config.liveRoleIds);
  }
  
  if (config.whitelistRoleIds) {
    entry.whitelistRoleIds = cleanIds(config.whitelistRoleIds);
  }
  
  save();
  return { ok: true, entry };
}

// For backward compatibility
const setPresence = setPresenceLiveRoles;

function clearPresence(guildId, platform) {
  const gid = toStr(guildId);
  if (presence[gid]) {
    if (platform) delete presence[gid][toLower(platform)]; else delete presence[gid];
    save();
  }
  return { ok: true };
}

load();

module.exports = { list, add, remove, update, getPresence, setPresence, clearPresence };
