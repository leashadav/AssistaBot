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
 * @property {string} id - The streamer's ID on the platform
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
    // Load existing data if file exists
    if (fs.existsSync(DATA_PATH)) {
      const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
      
      // Migrate old format if needed
      if (data._presence) {
        presence = data._presence;
        delete data._presence;
      } else {
        presence = {};
      }
      
      // Set db to the remaining data (which should be guild-specific)
      db = data;
    } else {
      // Initialize with empty data if file doesn't exist
      db = {};
      presence = {};
      fs.writeFileSync(DATA_PATH, JSON.stringify({ _presence: {} }, null, 2), 'utf8');
    }
    
    // Ensure all guilds have arrays in db
    for (const guildId in db) {
      if (Array.isArray(db[guildId])) continue;
      if (typeof db[guildId] === 'object' && db[guildId] !== null) {
        // Convert old format to array
        const entries = Object.values(db[guildId]);
        db[guildId] = entries;
      } else {
        // If it's not in the expected format, initialize as empty array
        db[guildId] = [];
      }
    }
  } catch (error) {
    console.error('streamRegistry load error:', error?.message || 'Unknown error');
    db = {};
    presence = {};
  }
}

function save() {
  try {
    // Create a clean copy of the data to save
    const toWrite = { _presence: presence };
    
    // Only include valid guild data
    for (const guildId in db) {
      if (Array.isArray(db[guildId])) {
        toWrite[guildId] = db[guildId];
      }
    }
    
    fs.writeFileSync(DATA_PATH, JSON.stringify(toWrite, null, 2), 'utf8');
  } catch (error) {
    console.error('streamRegistry save error:', error?.message || 'Unknown error');
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
  const id = toId(entry.id);
  
  if (!platform || !id) return { ok: false, reason: 'missing platform or id' };
  if (!isPlatform(platform)) return { ok: false, reason: 'invalid platform' };
  
  // Check for duplicates
  const key = (s) => `${s.platform}:${toLower(s.id)}`;
  if (arr.some(e => key(e) === key({ platform, id }))) {
    return { ok: false, reason: 'duplicate' };
  }
  
  // Create new entry with only the fields we want to keep
  const newEntry = {
    platform,
    id,
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

function remove(guildId, platform, id) {
  const gid = toStr(guildId);
  const arr = ensureGuild(gid);
  const p = toLower(platform);
  const i = toLower(id);
  const before = arr.length;
  db[gid] = arr.filter(e => !(e.platform === p && toLower(e.id) === i));
  save();
  return { removed: before - db[gid].length };
}

function update(guildId, platform, id, patch) {
  const gid = toStr(guildId);
  const arr = ensureGuild(gid);
  const idx = arr.findIndex(e => toLower(e.platform) === toLower(platform) && toLower(e.id) === toLower(id));
  
  if (idx === -1) return { ok: false, reason: 'not found' };
  
  // Update the entry with the new values
  const entry = arr[idx];
  if (patch.channelId !== undefined) entry.channelId = patch.channelId;
  if (patch.message !== undefined) entry.message = patch.message;
  if (patch.vodMessage !== undefined) entry.vodMessage = patch.vodMessage;
  if (patch.liveRoleIds) entry.liveRoleIds = cleanIds(patch.liveRoleIds);
  if (patch.whitelistRoleIds) entry.whitelistRoleIds = cleanIds(patch.whitelistRoleIds);
  
  // Clean up any legacy fields
  if (Object.prototype.hasOwnProperty.call(entry, 'discordUser')) delete entry.discordUser;
  if (Object.prototype.hasOwnProperty.call(entry, 'liveRoleId')) delete entry.liveRoleId;
  
  save();
  return { ok: true, entry };
}

function getPresence(guildId) {
  const gid = toStr(guildId);
  return presence[gid] || {};
}

function setPresence(guildId, platform, rule) {
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
