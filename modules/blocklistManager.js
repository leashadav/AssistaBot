const fs = require('fs');
const path = require('path');

const BLOCKLIST_FILE = path.join(__dirname, '..', 'data', 'blocklist.json');

// Default structure
const defaultBlocklist = {
  guilds: [],           // Array of blocked guild IDs
  twitchChannels: [],   // Array of blocked Twitch channel names (lowercase)
  discordUsers: [],     // Array of blocked Discord user IDs
  twitchUsers: []       // Array of blocked Twitch usernames (lowercase)
};

function loadBlocklist() {
  try {
    if (fs.existsSync(BLOCKLIST_FILE)) {
      const data = JSON.parse(fs.readFileSync(BLOCKLIST_FILE, 'utf8'));
      return { ...defaultBlocklist, ...data };
    }
  } catch (err) {
    console.error('[Blocklist] Error loading blocklist:', err.message);
  }
  return { ...defaultBlocklist };
}

function saveBlocklist(blocklist) {
  try {
    const dataDir = path.dirname(BLOCKLIST_FILE);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    fs.writeFileSync(BLOCKLIST_FILE, JSON.stringify(blocklist, null, 2));
    return true;
  } catch (err) {
    console.error('[Blocklist] Error saving blocklist:', err.message);
    return false;
  }
}

// Guild blocklist functions
function isGuildBlocked(guildId) {
  const blocklist = loadBlocklist();
  return blocklist.guilds.includes(guildId);
}

function blockGuild(guildId) {
  const blocklist = loadBlocklist();
  if (!blocklist.guilds.includes(guildId)) {
    blocklist.guilds.push(guildId);
    return saveBlocklist(blocklist);
  }
  return true;
}

function unblockGuild(guildId) {
  const blocklist = loadBlocklist();
  const index = blocklist.guilds.indexOf(guildId);
  if (index > -1) {
    blocklist.guilds.splice(index, 1);
    return saveBlocklist(blocklist);
  }
  return true;
}

function getBlockedGuilds() {
  return loadBlocklist().guilds;
}

// Twitch channel blocklist functions
function isTwitchChannelBlocked(channelName) {
  const blocklist = loadBlocklist();
  return blocklist.twitchChannels.includes(channelName.toLowerCase().replace('#', ''));
}

function blockTwitchChannel(channelName) {
  const blocklist = loadBlocklist();
  const normalized = channelName.toLowerCase().replace('#', '');
  if (!blocklist.twitchChannels.includes(normalized)) {
    blocklist.twitchChannels.push(normalized);
    return saveBlocklist(blocklist);
  }
  return true;
}

function unblockTwitchChannel(channelName) {
  const blocklist = loadBlocklist();
  const normalized = channelName.toLowerCase().replace('#', '');
  const index = blocklist.twitchChannels.indexOf(normalized);
  if (index > -1) {
    blocklist.twitchChannels.splice(index, 1);
    return saveBlocklist(blocklist);
  }
  return true;
}

function getBlockedTwitchChannels() {
  return loadBlocklist().twitchChannels;
}

// Discord user blocklist functions
function isDiscordUserBlocked(userId) {
  const blocklist = loadBlocklist();
  return blocklist.discordUsers.includes(userId);
}

function blockDiscordUser(userId) {
  const blocklist = loadBlocklist();
  if (!blocklist.discordUsers.includes(userId)) {
    blocklist.discordUsers.push(userId);
    return saveBlocklist(blocklist);
  }
  return true;
}

function unblockDiscordUser(userId) {
  const blocklist = loadBlocklist();
  const index = blocklist.discordUsers.indexOf(userId);
  if (index > -1) {
    blocklist.discordUsers.splice(index, 1);
    return saveBlocklist(blocklist);
  }
  return true;
}

function getBlockedDiscordUsers() {
  return loadBlocklist().discordUsers;
}

// Twitch user blocklist functions
function isTwitchUserBlocked(username) {
  const blocklist = loadBlocklist();
  return blocklist.twitchUsers.includes(username.toLowerCase());
}

function blockTwitchUser(username) {
  const blocklist = loadBlocklist();
  const normalized = username.toLowerCase();
  if (!blocklist.twitchUsers.includes(normalized)) {
    blocklist.twitchUsers.push(normalized);
    return saveBlocklist(blocklist);
  }
  return true;
}

function unblockTwitchUser(username) {
  const blocklist = loadBlocklist();
  const normalized = username.toLowerCase();
  const index = blocklist.twitchUsers.indexOf(normalized);
  if (index > -1) {
    blocklist.twitchUsers.splice(index, 1);
    return saveBlocklist(blocklist);
  }
  return true;
}

function getBlockedTwitchUsers() {
  return loadBlocklist().twitchUsers;
}

module.exports = {
  isGuildBlocked,
  blockGuild,
  unblockGuild,
  getBlockedGuilds,
  isTwitchChannelBlocked,
  blockTwitchChannel,
  unblockTwitchChannel,
  getBlockedTwitchChannels,
  isDiscordUserBlocked,
  blockDiscordUser,
  unblockDiscordUser,
  getBlockedDiscordUsers,
  isTwitchUserBlocked,
  blockTwitchUser,
  unblockTwitchUser,
  getBlockedTwitchUsers
};
