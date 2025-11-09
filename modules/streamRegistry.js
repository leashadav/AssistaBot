const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_PATH = path.join(DATA_DIR, 'streams.json');

let db = {};
let presence = {}; // { [guildId]: { twitch?: { channelId, message, liveRoleIds, whitelistRoleIds }, youtube?: { ... } } }

// Helper utilities
const toStr = (v) => (v === undefined || v === null ? '' : String(v));
const toLower = (v) => toStr(v).toLowerCase();
const toId = (v) => toStr(v).trim();
const isPlatform = (p) => ['twitch', 'youtube', 'rumble', 'tiktok', 'kick', 'instagram', 'discord', 'facebook', 'x'].includes(toLower(p));
const uniq = (arr) => Array.from(new Set(arr));
const cleanIds = (ids) => uniq((Array.isArray(ids) ? ids : [ids]).filter(Boolean).map(toId).filter(Boolean));

function ensureFiles() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(DATA_PATH)) {
      fs.writeFileSync(DATA_PATH, JSON.stringify({ _presence: {} }, null, 2), 'utf8');
    }
  } catch (error) {
    console.error('streamRegistry ensureFiles error:', e?.message || 'Unknown error');
  }
}

function load() {
  ensureFiles();
  try {
    const raw = fs.readFileSync(DATA_PATH, 'utf8');
    const parsed = JSON.parse(raw || '{}');
    presence = parsed._presence || {};
    // If top-level keys other than _presence are arrays, keep them as guild entries list
    delete parsed._presence;
    db = parsed;

    // Migrate: remove legacy per-user coupling and normalize liveRoleId -> liveRoleIds
    let mutated = false;
    for (const [gid, arr] of Object.entries(db)) {
      if (!Array.isArray(arr)) continue;
      for (const entry of arr) {
        if (Object.prototype.hasOwnProperty.call(entry, 'discordUser')) {
          delete entry.discordUser; // presence rules no longer require per-user coupling
          mutated = true;
        }
        if (entry.liveRoleId && !entry.liveRoleIds) {
          entry.liveRoleIds = [entry.liveRoleId];
          delete entry.liveRoleId;
          mutated = true;
        }
      }
    }
    if (mutated) save();
  } catch (error) {
    console.error('streamRegistry load error:', e?.message || 'Unknown error');
    db = {};
    presence = {};
  }
}

function save() {
  try {
    const toWrite = { ...db, _presence: presence };
    fs.writeFileSync(DATA_PATH, JSON.stringify(toWrite, null, 2), 'utf8');
  } catch (error) {
    console.error('streamRegistry save error:', e?.message || 'Unknown error');
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
  const key = (s) => `${s.platform}:${toLower(s.id)}`;
  if (arr.find(e => key(e) === key({ platform, id }))) return { ok: false, reason: 'duplicate' };
  const row = {
    platform,
    id,
    channelId: entry.channelId || null,
    message: entry.message || null,
    vodMessage: entry.vodMessage || null,
    discordUser: entry.discordUser || null, // user ID
    // Support both single and multiple live roles; normalize to array
    liveRoleIds: cleanIds(entry.liveRoleIds.length !== undefined ? entry.liveRoleIds : entry.liveRoleId),
    // Optional whitelist roles; if set, member must have at least one to trigger role/notification
    whitelistRoleIds: cleanIds(entry.whitelistRoleIds)
  };
  arr.push(row);
  save();
  return { ok: true, entry: row };
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
  const p = toLower(platform);
  const i = toLower(id);
  const entry = arr.find(e => e.platform === p && toLower(e.id) === i);
  if (!entry) return { ok: false, reason: 'not_found' };
  if (patch) {
    if (Object.prototype.hasOwnProperty.call(patch, 'channelId')) entry.channelId = patch.channelId || null;
    if (Object.prototype.hasOwnProperty.call(patch, 'message')) entry.message = patch.message || null;
    if (Object.prototype.hasOwnProperty.call(patch, 'vodMessage')) entry.vodMessage = patch.vodMessage || null;
    if (Object.prototype.hasOwnProperty.call(patch, 'discordUser')) entry.discordUser = patch.discordUser || null;

    if (Object.prototype.hasOwnProperty.call(patch, 'liveRoleId')) {
      // normalize legacy single value into array field
      const single = patch.liveRoleId || null;
      entry.liveRoleIds = single ? [toId(single)] : [];
      delete entry.liveRoleId;
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'liveRoleIds')) entry.liveRoleIds = cleanIds(patch.liveRoleIds);
    if (Object.prototype.hasOwnProperty.call(patch, 'whitelistRoleIds')) entry.whitelistRoleIds = cleanIds(patch.whitelistRoleIds);
  }
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
  const norm = {
    channelId: rule.channelId || null,
    message: rule.message || null,
    liveRoleIds: cleanIds(rule.liveRoleIds),
    whitelistRoleIds: cleanIds(rule.whitelistRoleIds)
  };
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
