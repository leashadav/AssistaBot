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
      interval: options.interval || 60,
      enabled: options.enabled !== false,
      gameFilter: options.gameFilter || null,
      minViewers: options.minViewers || 0,
      minLines: options.minLines || 2
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
    this.isStreamLive = false;
    this.stopTimers();
    this.streamCheckInterval = setInterval(() => this.checkStreamStatus(), 60 * 1000);
    void this.checkStreamStatus();
  }

  onStreamStart(forceStart = false) {
    if (this.isStreamLive && this.activeTimers.size > 0 && !forceStart) {
      this.streamStartTime = Date.now();
      return;
    }

    this.streamStartTime = Date.now();
    this.isStreamLive = true;
    this.startTimers(forceStart);
  }

  onStreamEnd() {
    this.isStreamLive = false;
    this.stopTimers();
  }

  async startTimers(forceStart = false) {
    if (this.isStreamLive && this.activeTimers.size > 0 && !forceStart) {
      return;
    }

    this.stopTimers(); // Clear existing timers
    
    const allTimers = this.timers.get('global') || {};

    if (!forceStart) {
      const isLive = await this.checkIfStreamLive();
      if (isLive !== true) {
        this.isStreamLive = false;
        this.streamCheckInterval = setInterval(() => this.checkStreamStatus(), 60 * 1000);
        return;
      }
    }
    
    // Stream is live, set up timers
    this.isStreamLive = true;
    this.streamStartTime = Date.now();
    
    // Check stream status frequently so timers start promptly once the stream goes live.
    this.streamCheckInterval = setInterval(() => this.checkStreamStatus(), 60 * 1000);
    
    for (const [name, timer] of Object.entries(allTimers)) {
      if (!timer.enabled) {
        continue;
      }
      
      const firstTimeout = setTimeout(async () => {
        try {
          if (this.isStreamLive) {
            await this.executeTimer(name, timer);
            
            const interval = setInterval(async () => {
              if (this.isStreamLive) {
                await this.executeTimer(name, timer);
              }
            }, timer.interval * 60 * 1000);
            
            this.activeTimers.set(name, interval);
          }
        } catch (error) {
          console.error(`[Timer] Error in timer ${name}:`, error);
        }
      }, 1000);
      
      this.activeTimers.set(`${name}_first`, firstTimeout);
    }
  }
  
  async checkStreamStatus() {
    const wasLive = this.isStreamLive;
    const isNowLive = await this.checkIfStreamLive();

    if (isNowLive === null) {
      console.warn('[Timer] Twitch stream status unavailable; keeping the current timer state');
      return wasLive;
    }
    
    if (isNowLive && !wasLive) {
      this.onStreamStart(true);
    } else if (!isNowLive && wasLive) {
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

  async checkIfStreamLive() {
    // Check the channel being monitored, not the bot username
    const channel = twitchConfig.twitch_channel?.[0] || twitchConfig.channels?.[0];
    const username = channel ? channel.replace('#', '') : (twitchConfig.twitch_username || twitchConfig.username);
    const clientId = twitchConfig.twitch_client_id || twitchConfig.client_id;
    const clientSecret = twitchConfig.twitch_client_secret || twitchConfig.client_secret;

    if (!username) {
      return null;
    }

    if (!clientId || !clientSecret) {
      return null;
    }

    try {
      // Get app access token
      const tokenResponse = await axios.post('https://id.twitch.tv/oauth2/token', null, {
        params: {
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: 'client_credentials'
        },
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      if (!tokenResponse.data.access_token) {
        console.error('[Timer] Failed to get Twitch API access token');
        return null;
      }

      const accessToken = tokenResponse.data.access_token;
      
      // Check stream status
      const response = await axios.get(`${TWITCH_API_URL}?user_login=${username}`, {
        headers: {
          'Client-ID': clientId,
          'Authorization': `Bearer ${accessToken}`
        }
      });

      // Check if there's any stream data in the response
      const isLive = response.data && 
             response.data.data && 
             response.data.data.length > 0 && 
             response.data.data[0].type === 'live';
      
      // Log detailed stream status only when live (to avoid spam on offline checks)
      if (isLive && response.data.data[0]) {
        const stream = response.data.data[0];
        // Stream is live
      }
      // Don't log offline status to avoid spamming console with repeated checks
      
      return isLive;
    } catch (error) {
      console.error('[Timer] Error checking stream status:', error.message);
      return null;
    }
  }

  async getCurrentStreamGame() {
    const channel = twitchConfig.twitch_channel?.[0] || twitchConfig.channels?.[0];
    const username = channel ? channel.replace('#', '') : (twitchConfig.twitch_username || twitchConfig.username);
    const clientId = twitchConfig.twitch_client_id || twitchConfig.client_id;
    const clientSecret = twitchConfig.twitch_client_secret || twitchConfig.client_secret;

    if (!username || !clientId || !clientSecret) {
      return null;
    }

    try {
      // Get app access token
      const tokenResponse = await axios.post('https://id.twitch.tv/oauth2/token', null, {
        params: {
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: 'client_credentials'
        },
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      if (!tokenResponse.data.access_token) {
        return null;
      }

      const accessToken = tokenResponse.data.access_token;
      
      // Check stream status to get game info
      const response = await axios.get(`${TWITCH_API_URL}?user_login=${username}`, {
        headers: {
          'Client-ID': clientId,
          'Authorization': `Bearer ${accessToken}`
        }
      });

      if (response.data && response.data.data && response.data.data.length > 0) {
        return response.data.data[0].game_name;
      }
      
      return null;
    } catch (error) {
      console.error('[Timer] Error getting current stream game:', error.message);
      return null;
    }
  }

  getChatTargets() {
    if (this.twitchClient?.getChannels) {
      const channels = this.twitchClient.getChannels().filter(Boolean);
      if (channels.length > 0) {
        return channels;
      }
    }

    const configuredChannels = Array.isArray(twitchConfig.twitch_channel)
      ? twitchConfig.twitch_channel
      : (Array.isArray(twitchConfig.channels) ? twitchConfig.channels : []);

    return configuredChannels.filter(Boolean);
  }

  async executeTimer(name, timer) {
    try {
      // Use the last known live state first so one temporary API hiccup does not stop the timer loop.
      const isLive = this.isStreamLive || await this.checkIfStreamLive();
      if (!isLive) {
        this.isStreamLive = false;
        return;
      }
      
      // Check game filter if specified
      if (timer.gameFilter && Array.isArray(timer.gameFilter) && timer.gameFilter.length > 0) {
        const currentGame = await this.getCurrentStreamGame();
        if (!currentGame) {
          return;
        }
        
        const gameMatches = timer.gameFilter.some(game => 
          currentGame.toLowerCase().includes(game.toLowerCase()) || 
          game.toLowerCase().includes(currentGame.toLowerCase())
        );
        
        if (!gameMatches) {
          return;
        }
        
        // Game filter passed
      }
      
      // Update stream live status and start time if not already set
      if (!this.isStreamLive) {
        this.isStreamLive = true;
        this.streamStartTime = Date.now();
      }
      
      if (this.twitchClient) {
        const channels = this.getChatTargets();
        if (channels.length === 0) {
          console.warn('[Timer] No channels available to post timer message');
          return;
        }
        
        const target = channels[0].startsWith('#') ? channels[0] : `#${channels[0]}`;
        try {
          await this.twitchClient.say(target, timer.message);
        } catch (error) {
          console.error(`[Timer] Error posting to ${target}:`, error.message);
        }
      } else {
        console.error(`[Timer] Timer ${name} failed - no Twitch client connected`);
      }
    } catch (error) {
      console.error(`[Timer] Error in executeTimer for ${name}:`, error);
    }
  }

  setTwitchClient(client) {
    this.twitchClient = client;
  }

  initTwitchClient() {
    // This method is no longer needed since we'll set the client from the bot
  }
}

const timerInstance = new TwitchTimers();

module.exports = timerInstance;