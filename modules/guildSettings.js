const fs = require('fs');
const path = require('path');
const dataPath = path.join(__dirname, '..', 'data', 'guildSettings.json');
let settings = {};

// Default settings template
const defaultSettings = {
  logChannels: {
    messageDelete: null,
    messageUpdate: null,
    messageUpdateEdited: null,
    memberJoin: null,
    memberLeave: null,
    ticketCreated: null,
    ticketClosed: null,
    generalLog: null,
    inviteLog: null,
    assistabotsayLog: null,
    assistabotLogging: null
  },
  birthdayInfo: {
    birthdayRole: null,
    birthdayChannel: null
  },
  welcome: {
    enabled: false,
    channelId: null,
    dm: false,
    message: 'Hey {user}, Welcome to {server}!',
    content: null
  },
  goodbye: {
    enabled: false,
    channelId: null,
    message: 'Goodbye {displayName}, we will miss you.',
    content: null
  },
  supportChannelId: null,
  prefix: '!',
  embedColor: '0xff6600'
};

function deepFill(target, template) {
  Object.keys(template).forEach((key) => {
    const tmplVal = template[key];
    const tgtVal = target[key];
    if (tmplVal && typeof tmplVal === 'object' && !Array.isArray(tmplVal)) {
      if (!tgtVal || typeof tgtVal !== 'object' || Array.isArray(tgtVal)) {
        target[key] = {};
      }
      deepFill(target[key], tmplVal);
    } else if (typeof tgtVal === 'undefined') {
      target[key] = tmplVal;
    }
  });
}

function load() {
  try {
    if (fs.existsSync(dataPath)) {
      const raw = fs.readFileSync(dataPath, 'utf8');
      settings = JSON.parse(raw || '{}');
      // Backfill missing keys for all guilds to match default structure
      Object.keys(settings).forEach(gid => {
        const guildSettings = settings[gid];
        if (guildSettings && typeof guildSettings === 'object' && !Array.isArray(guildSettings)) {
          // Remove deprecated 'stream' section (migrated to streamRegistry)
          if ('stream' in guildSettings) {
            delete guildSettings.stream;
          }
          deepFill(guildSettings, defaultSettings);
        }
      });
      save();
    } else {
      settings = {};
      save();
    }
  } catch (error) {
    console.error('guildSettings: failed to load data file', error?.message || 'Unknown error');
    settings = {};
  }
}

function save() {
  try {
    fs.writeFileSync(dataPath, JSON.stringify(settings, null, 2), 'utf8');
  } catch (error) {
    console.error('guildSettings: failed to save data file', error);
  }
}

function ensureGuild(guildId) {
  if (!settings[guildId]) {
    settings[guildId] = { ...defaultSettings };
    save();
  } else {
    // Ensure existing guild gets any new defaults added
    deepFill(settings[guildId], defaultSettings);
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
    const value = newSettings[key];
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      current[key] = { ...current[key], ...value };
    } else {
      current[key] = value;
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
  // Allow setting any known log channel type from defaults, even if missing previously
  if (type in defaultSettings.logChannels) {
    if (!(type in guild.logChannels)) {
      guild.logChannels[type] = null;
    }
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