const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, '..', 'data', 'selfAssignableRoles.json');
let store = {};

function ensureFile() {
  try {
    if (!fs.existsSync(DATA_PATH)) {
      fs.writeFileSync(DATA_PATH, JSON.stringify({}, null, 2), 'utf8');
    }
  } catch (error) {
    console.error('selfAssignableRoles: failed to ensure data file', error?.message || error);
  }
}

function load() {
  ensureFile();
  try {
    const raw = fs.readFileSync(DATA_PATH, 'utf8');
    store = JSON.parse(raw || '{}');
  } catch (error) {
    console.error('selfAssignableRoles: failed to load data file', error?.message || error);
    store = {};
  }
}

function save() {
  try {
    fs.writeFileSync(DATA_PATH, JSON.stringify(store, null, 2), 'utf8');
  } catch (error) {
    console.error('selfAssignableRoles: failed to save data file', error?.message || error);
  }
}

function normalizeEmojiKey(emoji) {
  if (!emoji) return null;

  if (typeof emoji === 'string') {
    const match = emoji.match(/^<(a?):([a-zA-Z0-9_]+):(\d+)>$/);
    if (match) {
      return `${match[2]}:${match[3]}`;
    }
    return emoji;
  }

  if (typeof emoji.identifier === 'string' && emoji.identifier) {
    return emoji.identifier;
  }

  if (emoji.id) {
    return `${emoji.name}:${emoji.id}`;
  }

  return emoji.name || String(emoji);
}

function resolveEmojiKey(messageConfig, emoji) {
  if (!messageConfig || !messageConfig.emojiRoles) return null;

  const directKey = normalizeEmojiKey(emoji);
  if (directKey && messageConfig.emojiRoles[directKey]) {
    return directKey;
  }

  const name = typeof emoji === 'string'
    ? (emoji.match(/^<(?:a?):([a-zA-Z0-9_]+):(\d+)>$/) ? emoji.match(/^<(?:a?):([a-zA-Z0-9_]+):(\d+)>$/)[1] : emoji.replace(/^:|:$/g, ''))
    : emoji?.name;

  if (!name) return directKey;

  return Object.keys(messageConfig.emojiRoles).find(key =>
    key === name ||
    key.startsWith(`${name}:`) ||
    key === `:${name}:`
  ) || directKey;
}

function emojiToString(emoji) {
  if (!emoji) return '';
  if (typeof emoji === 'string') return emoji;
  if (typeof emoji.toString === 'function') return emoji.toString();
  return normalizeEmojiKey(emoji);
}

function getGuildData(guildId) {
  if (!store[guildId]) {
    store[guildId] = { messages: {} };
  }
  return store[guildId];
}

function getMessageConfig(guildId, messageId) {
  const guildData = getGuildData(guildId);
  return guildData.messages[messageId] || null;
}

function addReactionRole(guildId, messageId, channelId, emoji, roleId, displayEmoji = null) {
  const key = normalizeEmojiKey(emoji);
  if (!key) throw new Error('Invalid emoji');
  const guildData = getGuildData(guildId);
  if (!guildData.messages[messageId]) {
    guildData.messages[messageId] = { channelId, emojiRoles: {} };
  }
  guildData.messages[messageId].channelId = channelId || guildData.messages[messageId].channelId;
  guildData.messages[messageId].emojiRoles[key] = {
    roleId,
    emoji: displayEmoji || emojiToString(emoji)
  };
  save();
  return guildData.messages[messageId];
}

function getRoleForReaction(guildId, messageId, emoji) {
  const messageConfig = getMessageConfig(guildId, messageId);
  if (!messageConfig) return null;
  const key = resolveEmojiKey(messageConfig, emoji);
  if (!key) return null;
  return messageConfig.emojiRoles[key] || null;
}

function removeReactionRole(guildId, messageId, emoji) {
  const guildData = store[guildId];
  if (!guildData || !guildData.messages[messageId]) return false;
  const messageConfig = guildData.messages[messageId];
  const key = resolveEmojiKey(messageConfig, emoji);
  if (!key || !messageConfig.emojiRoles[key]) return false;
  delete messageConfig.emojiRoles[key];
  if (Object.keys(messageConfig.emojiRoles).length === 0) {
    delete guildData.messages[messageId];
  }
  save();
  return true;
}

function deleteMessageConfig(guildId, messageId) {
  const guildData = store[guildId];
  if (!guildData || !guildData.messages[messageId]) return false;
  delete guildData.messages[messageId];
  save();
  return true;
}

function getRoleForReaction(guildId, messageId, emoji) {
  const messageConfig = getMessageConfig(guildId, messageId);
  if (!messageConfig) return null;
  const key = resolveEmojiKey(messageConfig, emoji);
  if (!key) return null;
  return messageConfig.emojiRoles[key] || null;
}

function listGuildMessages(guildId) {
  const guildData = getGuildData(guildId);
  return Object.entries(guildData.messages).map(([messageId, config]) => ({ messageId, ...config }));
}

load();

module.exports = {
  getMessageConfig,
  addReactionRole,
  removeReactionRole,
  deleteMessageConfig,
  getRoleForReaction,
  listGuildMessages,
  normalizeEmojiKey,
  emojiToString
};