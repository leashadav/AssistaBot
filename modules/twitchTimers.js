const fs = require('fs');
const path = require('path');
const configLoader = require('./configLoader');
const config = configLoader.config;
const tmi = require('tmi.js');
const twitchConfig = configLoader.twitch;

class TwitchTimers {
  constructor() {
    this.timers = new Map();
    this.timersFile = path.join(__dirname, '..', 'data', 'timers.json');
    this.lastMessages = new Map();
    this.activeTimers = new Map();
    this.streamStartTime = null;
    this.isStreamLive = false;
    this.twitchClient = null;
    this.loadTimers();
    this.initTwitchClient();
  }

  loadTimers() {
    try {
      if (fs.existsSync(this.timersFile)) {
        const data = JSON.parse(fs.readFileSync(this.timersFile, 'utf8'));
        // Check if data has guild structure or is legacy format
        const hasGuildStructure = Object.values(data).some(v => typeof v === 'object' && v.message === undefined);
        if (hasGuildStructure) {
          this.timers = new Map(Object.entries(data));
        } else {
          // Legacy format - treat as global timers
          this.timers = new Map([['global', data]]);
        }
      }
    } catch (error) {
      console.error('Error loading timers:', error);
      this.timers = new Map();
    }
  }

  saveTimers() {
    try {
      const data = Object.fromEntries(this.timers);
      fs.writeFileSync(this.timersFile, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('Error saving timers:', error);
    }
  }

  addTimer(guildId, name, options) {
    if (!this.timers.has('global')) {
      this.timers.set('global', {});
    }
    
    const globalTimers = this.timers.get('global');
    globalTimers[name] = {
      message: options.message,
      interval: options.interval || 10,
      enabled: options.enabled !== false,
      gameFilter: options.gameFilter || null,
      minViewers: options.minViewers || 0,
      minLines: options.minLines || 0
    };
    
    this.saveTimers();
    return true;
  }

  removeTimer(guildId, name) {
    const globalTimers = this.timers.get('global');
    if (globalTimers && globalTimers[name]) {
      delete globalTimers[name];
      this.saveTimers();
      return true;
    }
    return false;
  }

  toggleTimer(guildId, name) {
    const globalTimers = this.timers.get('global');
    if (globalTimers && globalTimers[name]) {
      globalTimers[name].enabled = !globalTimers[name].enabled;
      this.saveTimers();
      return globalTimers[name].enabled;
    }
    return null;
  }

  listTimers(guildId) {
    const gid = String(guildId);
    const guildTimers = this.timers.get(gid) || {};
    const globalTimers = this.timers.get('global') || {};
    return { guild: guildTimers, global: globalTimers };
  }

  // Manual trigger for testing
  manualStart() {
    console.log('Manual timer start triggered');
    this.onStreamStart();
  }

  onStreamStart() {
    console.log('Stream started - initializing timers');
    this.streamStartTime = Date.now();
    this.isStreamLive = true;
    this.startTimers();
  }

  onStreamEnd() {
    this.isStreamLive = false;
    this.stopTimers();
  }

  startTimers() {
    this.stopTimers(); // Clear existing timers
    
    const allTimers = this.timers.get('global') || {};
    console.log(`Starting ${Object.keys(allTimers).length} timers`);
    
    for (const [name, timer] of Object.entries(allTimers)) {
      if (!timer.enabled) {
        console.log(`Timer ${name} is disabled, skipping`);
        continue;
      }
      
      console.log(`Scheduling timer ${name} - first in 1 minute, then every ${timer.interval} minutes`);
      
      // Schedule first timer 1 minute after stream start
      const firstTimeout = setTimeout(() => {
        this.executeTimer(name, timer);
        
        // Then schedule recurring timer at the specified interval
        const interval = setInterval(() => {
          this.executeTimer(name, timer);
        }, timer.interval * 60 * 1000);
        
        this.activeTimers.set(name, interval);
      }, 60 * 1000); // 1 minute delay
      
      this.activeTimers.set(`${name}_first`, firstTimeout);
    }
  }

  stopTimers() {
    for (const [name, timer] of this.activeTimers) {
      clearTimeout(timer);
      clearInterval(timer);
    }
    this.activeTimers.clear();
  }

  async executeTimer(name, timer) {
    if (!this.isStreamLive) {
      console.log(`Timer ${name} skipped - stream not live`);
      return;
    }
    
    console.log(`Executing timer ${name}: ${timer.message}`);
    
    if (this.twitchClient) {
      try {
        const channels = this.twitchClient.getChannels();
        console.log(`Posting to channels: ${channels.join(', ')}`);
        for (const channel of channels) {
          await this.twitchClient.say(channel, timer.message);
        }
      } catch (error) {
        console.error(`Error executing timer ${name}:`, error);
      }
    } else {
      console.error(`Timer ${name} failed - no Twitch client connected`);
    }
  }

  initTwitchClient() {
    if (!twitchConfig?.twitch_username && !twitchConfig?.username) {
      console.warn('No Twitch username configured for timers');
      return;
    }
    if (!twitchConfig?.twitch_oauth && !twitchConfig?.oauth) {
      console.warn('No Twitch OAuth configured for timers');
      return;
    }

    console.log('Initializing Twitch client for timers');
    this.twitchClient = new tmi.Client({
      options: { debug: false },
      connection: { reconnect: true, secure: true },
      identity: {
        username: twitchConfig.twitch_username || twitchConfig.username,
        password: twitchConfig.twitch_oauth || twitchConfig.oauth
      },
      channels: twitchConfig.twitch_channel || twitchConfig.channels || [twitchConfig.twitch_username || twitchConfig.username]
    });

    this.twitchClient.on('connected', () => {
      console.log('Twitch timer client connected');
    });

    this.twitchClient.connect().catch(error => {
      console.error('Error connecting Twitch timer client:', error);
    });
  }
}

const timerInstance = new TwitchTimers();

module.exports = timerInstance;