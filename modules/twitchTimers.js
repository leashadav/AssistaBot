const fs = require('fs');
const path = require('path');
const configLoader = require('./configLoader');
const tmi = require('tmi.js');
const axios = require('axios');

// Twitch API endpoint
const TWITCH_API_URL = 'https://api.twitch.tv/helix/streams';

// Get Twitch config
const twitchConfig = configLoader.twitch || {};

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
    
    // Initial stream status check
    this.checkStreamStatus();
    
    // Check stream status every 2 minutes
    this.streamCheckInterval = setInterval(() => this.checkStreamStatus(), 2 * 60 * 1000);
    
    for (const [name, timer] of Object.entries(allTimers)) {
      if (!timer.enabled) {
        console.log(`Timer ${name} is disabled, skipping`);
        continue;
      }
      
      console.log(`Scheduling timer ${name} - first in 1 minute, then every ${timer.interval} minutes`);
      
      // Schedule first timer 1 minute after stream start
      const firstTimeout = setTimeout(async () => {
        if (await this.isStreamLive()) {
          await this.executeTimer(name, timer);
        }
        
        // Then schedule recurring timer at the specified interval
        const interval = setInterval(async () => {
          if (await this.isStreamLive()) {
            await this.executeTimer(name, timer);
          } else {
            console.log(`Timer ${name} skipped - stream is not live`);
          }
        }, timer.interval * 60 * 1000);
        
        this.activeTimers.set(name, interval);
      }, 60 * 1000); // 1 minute delay
      
      this.activeTimers.set(`${name}_first`, firstTimeout);
    }
  }
  
  async checkStreamStatus() {
    const wasLive = this.isStreamLive;
    const isNowLive = await this.isStreamLive();
    
    if (isNowLive && !wasLive) {
      console.log('Stream went live, starting timers');
      this.onStreamStart();
    } else if (!isNowLive && wasLive) {
      console.log('Stream went offline, stopping timers');
      this.onStreamEnd();
    }
    
    this.isStreamLive = isNowLive;
    return isNowLive;
  }

  stopTimers() {
    for (const [name, timer] of this.activeTimers) {
      clearTimeout(timer);
      clearInterval(timer);
    }
    this.activeTimers.clear();
    
    if (this.streamCheckInterval) {
      clearInterval(this.streamCheckInterval);
      this.streamCheckInterval = null;
    }
  }

  async isStreamLive() {
    const username = twitchConfig.username;
    const clientId = twitchConfig.client_id;
    const oauthToken = twitchConfig.oauth_token || twitchConfig.oauth;

    if (!username) {
      console.warn('No Twitch username configured for stream status check');
      return false;
    }

    if (!clientId || !oauthToken) {
      console.warn('Missing Twitch API credentials (client_id or oauth_token)');
      return false;
    }

    try {
      const response = await axios.get(`${TWITCH_API_URL}?user_login=${username}`, {
        headers: {
          'Client-ID': clientId,
          'Authorization': `Bearer ${oauthToken}`
        }
      });

      return response.data.data && response.data.length > 0;
    } catch (error) {
      console.error('Error checking stream status:', error.response?.data || error.message);
      return false;
    }
  }

  async executeTimer(name, timer) {
    try {
      // Check if stream is live before executing timer
      const isLive = await this.isStreamLive();
      if (!isLive) {
        console.log(`Timer ${name} skipped - stream is not live`);
        this.isStreamLive = false;
        return;
      }
      
      if (!this.isStreamLive) {
        console.log('Stream is now live, starting timers');
        this.isStreamLive = true;
        this.streamStartTime = Date.now();
      }
      
      console.log(`Executing timer ${name}: ${timer.message}`);
      
      if (this.twitchClient) {
        const channels = this.twitchClient.getChannels();
        if (channels.length === 0) {
          console.warn('No channels available to post timer message');
          return;
        }
        
        console.log(`Posting to channels: ${channels.join(', ')}`);
        for (const channel of channels) {
          try {
            await this.twitchClient.say(channel, timer.message);
            console.log(`Timer ${name} executed successfully in ${channel}`);
          } catch (error) {
            console.error(`Error posting to ${channel}:`, error.message);
          }
        }
      } else {
        console.error(`Timer ${name} failed - no Twitch client connected`);
      }
    } catch (error) {
      console.error(`Error in executeTimer for ${name}:`, error);
    }
  }

  initTwitchClient() {
    const username = twitchConfig.username;
    const oauthToken = twitchConfig.oauth_token || twitchConfig.oauth;
    const channels = twitchConfig.channels || [];

    if (!username) {
      console.warn('No Twitch username configured for timers');
      return;
    }
    if (!oauthToken) {
      console.warn('No Twitch OAuth token configured for timers');
      return;
    }

    console.log('Initializing Twitch client for timers');
    this.twitchClient = new tmi.Client({
      options: { debug: false },
      connection: { reconnect: true, secure: true },
      identity: {
        username: username,
        password: `oauth:${oauthToken.replace(/^oauth:/, '')}`
      },
      channels: channels.length > 0 ? channels : [username]
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