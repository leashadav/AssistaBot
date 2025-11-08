const fs = require('fs');
const path = require('path');
const tmi = require('tmi.js');
const configLoader = require('./configLoader');
const twitchConfig = configLoader.twitch;

class TwitchShoutouts {
  constructor() {
    this.shoutoutsFile = path.join(__dirname, '..', 'data', 'shoutouts.json');
    this.cooldowns = new Map();
    this.streamShoutouts = new Map(); // Track shoutouts per stream session
    this.currentStreamId = null;
    this.shoutoutUsers = new Set();
    this.client = null;
    this.loadShoutouts();
    this.initTwitchClient();
  }

  loadShoutouts() {
    try {
      if (fs.existsSync(this.shoutoutsFile)) {
        const data = JSON.parse(fs.readFileSync(this.shoutoutsFile, 'utf8'));
        this.shoutoutUsers = new Set(data.users || []);
      }
    } catch (error) {
      console.error('Error loading shoutouts:', error?.message || 'Unknown error');
      this.shoutoutUsers = new Set();
    }
  }

  saveShoutouts() {
    try {
      const data = { users: Array.from(this.shoutoutUsers) };
      fs.writeFileSync(this.shoutoutsFile, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('Error saving shoutouts:', error?.message || 'Unknown error');
    }
  }

  initTwitchClient() {
    if ((!twitchConfig?.username && !twitchConfig?.twitch_username) || (!twitchConfig?.oauth && !twitchConfig?.twitch_oauth)) {
      console.warn('Twitch credentials not configured for shoutouts');
      return;
    }

    this.client = new tmi.Client({
      options: { debug: false },
      connection: { reconnect: true, secure: true },
      identity: {
        username: twitchConfig.twitch_username || twitchConfig.username,
        password: twitchConfig.twitch_oauth || twitchConfig.oauth
      },
      channels: twitchConfig.twitch_channel || twitchConfig.channels || [twitchConfig.twitch_username || twitchConfig.username]
    });

    this.client.on('message', (channel, tags, message, self) => {
      if (self) return;
      this.handleMessage(channel, tags, message);
    });

    this.client.connect().catch(error => {
      console.error('Error connecting to Twitch:', error?.message || 'Unknown error');
    });
  }

  handleMessage(channel, tags, message) {
    const username = tags.username.toLowerCase();
    
    if (!this.shoutoutUsers.has(username)) return;

    const now = Date.now();
    const cooldownKey = `${channel}_${username}`;
    const lastShoutout = this.cooldowns.get(cooldownKey);

    // Check 8-hour cooldown
    if (lastShoutout && (now - lastShoutout) < 28800000) return;

    // Generate current stream session ID (reset every stream)
    const streamId = this.getCurrentStreamId();
    const streamKey = `${streamId}_${username}`;
    
    // Check if already shouted out this stream
    if (this.streamShoutouts.has(streamKey)) return;

    this.cooldowns.set(cooldownKey, now);
    this.streamShoutouts.set(streamKey, now);
    
    const shoutoutMessage = `Please go check out @${tags.username} over at https://twitch.tv/${tags.username} , the last activity they were doing was ${tags.game} and if you would please toss them a follow, thank you!`;
    
    this.client.say(channel, shoutoutMessage).catch(error => {
      console.error('Error sending shoutout:', error?.message || 'Unknown error');
    });
  }

  addUser(username) {
    const user = username.toLowerCase().replace('@', '');
    this.shoutoutUsers.add(user);
    this.saveShoutouts();
    return true;
  }

  removeUser(username) {
    const user = username.toLowerCase().replace('@', '');
    const removed = this.shoutoutUsers.delete(user);
    if (removed) this.saveShoutouts();
    return removed;
  }

  listUsers() {
    return Array.from(this.shoutoutUsers);
  }

  getCurrentStreamId() {
    // Generate a stream ID based on current hour to reset every stream
    const now = new Date();
    const streamId = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${Math.floor(now.getTime() / 3600000)}`;
    
    // If stream ID changed, clear stream shoutouts
    if (this.currentStreamId !== streamId) {
      this.currentStreamId = streamId;
      this.streamShoutouts.clear();
    }
    
    return streamId;
  }

  clearCooldown(username) {
    const user = username.toLowerCase().replace('@', '');
    let cleared = false;
    for (const [key] of this.cooldowns) {
      if (key.includes(`_${user}`)) {
        this.cooldowns.delete(key);
        cleared = true;
      }
    }
    // Also clear from current stream
    for (const [key] of this.streamShoutouts) {
      if (key.includes(`_${user}`)) {
        this.streamShoutouts.delete(key);
        cleared = true;
      }
    }
    return cleared;
  }
}

module.exports = new TwitchShoutouts();