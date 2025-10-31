const fs = require('fs');
const path = require('path');

const dataPath = path.join(__dirname, '..', 'data', 'guildSettings.json');

let settings = {};

// Default settings template
const defaultSettings = {
  logChannels: {
    messageDelete: null,
    memberJoin: null,
    memberLeave: null,
    ticketCreated: null,
    ticketClosed: null,
    generalLog: null,
    inviteLog: null
  },
  birthdayInfo: {
    birthdayRole: null,
    birthdayChannel: null
  },
  supportChannelId: null,
  prefix: '!'
};

function load() {
  try {
    if (fs.existsSync(dataPath)) {
      const raw = fs.readFileSync(dataPath, 'utf8');
      settings = JSON.parse(raw || '{}');
    } else {
      settings = {};
      save();
    }
  } catch (err) {
    console.error('guildSettings: failed to load data file', err);
    settings = {};
  }
}

function save() {
  try {
    fs.writeFileSync(dataPath, JSON.stringify(settings, null, 2), 'utf8');
  } catch (err) {
    console.error('guildSettings: failed to save data file', err);
  }
}

function ensureGuild(guildId) {
  if (!settings[guildId]) {
    settings[guildId] = JSON.parse(JSON.stringify(defaultSettings));
    save();
  }
  return settings[guildId];
}

function getSettings(guildId) {
  return ensureGuild(guildId);
}

function updateSettings(guildId, newSettings) {
  const current = ensureGuild(guildId);
  // Deep merge the new settings
  Object.keys(newSettings).forEach(key => {
    if (typeof newSettings[key] === 'object' && newSettings[key] !== null) {
      current[key] = { ...current[key], ...newSettings[key] };
    } else {
      current[key] = newSettings[key];
    }
  });
  save();
  return current;
}

function getLogChannel(guildId, type) {
  const guild = ensureGuild(guildId);
  return guild.logChannels[type] || null;
}

function setLogChannel(guildId, type, channelId) {
  const guild = ensureGuild(guildId);
  if (type in guild.logChannels) {
    guild.logChannels[type] = channelId;
    save();
    return true;
  }
  return false;
}

// Initialize
load();

module.exports = {
  getSettings,
  updateSettings,
  getLogChannel,
  setLogChannel,
  defaultSettings
};