const fs = require('fs');
const path = require('path');
const tmi = require('tmi.js');
const axios = require('axios');
const configLoader = require('./configLoader');
const twitchConfig = configLoader.twitch;

class TwitchShoutouts {
  constructor() {
    this.shoutoutsFile = path.join(__dirname, '..', 'data', 'shoutouts.json');
    this.cooldowns = new Map();
    this.streamShoutouts = new Map(); // Track shoutouts per stream session
    this.currentStreamId = null;
    this.shoutoutUsers = new Set();
    this.pendingShoutouts = new Map();
    this.client = null; // Will be set by the main bot
    this.accessToken = null;
    this.tokenExpiry = 0;
    this.messageChecks = new Map(); // Track when we last checked each user
    this.loadShoutouts();
  }

  loadShoutouts() {
    try {
      if (fs.existsSync(this.shoutoutsFile)) {
        const data = JSON.parse(fs.readFileSync(this.shoutoutsFile, 'utf8'));
        this.shoutoutUsers = new Set(data.users || []);
        // Load cooldowns if they exist and ensure timestamps are numbers
        if (data.cooldowns) {
          const cooldowns = new Map();
          for (const [key, timestamp] of Object.entries(data.cooldowns)) {
            cooldowns.set(key, Number(timestamp));
          }
          this.cooldowns = cooldowns;
        }
        // Cooldowns loaded silently
      }
    } catch (error) {
      console.error('Error loading shoutouts:', error?.message || 'Unknown error');
      this.shoutoutUsers = new Set();
      this.cooldowns = new Map();
    }
  }

  saveShoutouts() {
    try {
      const data = {
        users: Array.from(this.shoutoutUsers),
        cooldowns: Object.fromEntries(this.cooldowns)
      };
      fs.writeFileSync(this.shoutoutsFile, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('Error saving shoutouts:', error?.message || 'Unknown error');
    }
  }

  // Set the client from the main bot (called by twitchBot.js)
  setClient(client) {
    this.client = client;
  }

  async handleMessage(channel, tags, message) {
    const username = tags?.username?.toLowerCase();
    if (!username) return;
    return this.handleAutomaticShoutout(channel, username, true);
  }

  async handleJoin(channel, username, self = false) {
    if (self || !username) return;
    return this.handleAutomaticShoutout(channel, username, false);
  }

  async handleAutomaticShoutout(channel, username, checkMessageCooldown) {
    username = String(username).toLowerCase().replace(/^@/, '');
    if (!this.shoutoutUsers.has(username)) return;

    const now = Date.now();
    const normalizedChannel = String(channel).toLowerCase();
    const checkKey = `${normalizedChannel}_${username}`;

    // Skip if we already checked this user recently (within 8 hours)
    const MESSAGE_CHECK_COOLDOWN = 8 * 60 * 60 * 1000; // 8 hours
    if (checkMessageCooldown) {
      const lastCheck = this.messageChecks.get(checkKey);
      if (lastCheck && (now - lastCheck) < MESSAGE_CHECK_COOLDOWN) {
        return;
      }
    }

    const cooldownKey = `${normalizedChannel}_${username}`;
    const lastShoutout = this.cooldowns.get(cooldownKey);

    // Check 8-hour cooldown (8 hours in milliseconds = 28800000)
    const COOLDOWN_MS = 28800000;
    const shoutoutAge = now - lastShoutout;
    if (lastShoutout && shoutoutAge >= 0 && shoutoutAge < COOLDOWN_MS) {
      return;
    }

    // Generate current stream session ID (reset every stream)
    const streamId = this.getCurrentStreamId();
    const streamKey = `${streamId}_${username}`;

    // Check if already shouted out this stream session
    if (this.streamShoutouts.has(streamKey)) {
      return;
    }

    const pendingShoutout = this.pendingShoutouts.get(cooldownKey);
    if (pendingShoutout) {
      if (checkMessageCooldown && !(await pendingShoutout)) {
        return this.handleAutomaticShoutout(channel, username, false);
      }
      return;
    }

    // Additional immediate cooldown check (1 minute) to prevent rapid-fire
    const immediateCooldownKey = `immediate_${normalizedChannel}_${username}`;
    const immediateLastShoutout = this.cooldowns.get(immediateCooldownKey);
    const immediateShoutoutAge = now - immediateLastShoutout;
    if (immediateLastShoutout && immediateShoutoutAge >= 0 && immediateShoutoutAge < 60000) {
      return;
    }

    const shoutoutPromise = (async () => {
      try {
        let shoutoutMessage;
        try {
          const userInfo = await this.getUserInfo(username);
          const displayName = userInfo?.display_name || userInfo?.displayName || username;
          const lastActivity = userInfo?.game_name || userInfo?.title || 'their recent content';
          shoutoutMessage = `Please go check out ${displayName} over at https://twitch.tv/${username}, the last activity they were doing was ${lastActivity}. Please toss them a follow!`;
        } catch (error) {
          console.error('Error getting user info for shoutout:', error?.message || 'Unknown error');
          shoutoutMessage = `Please go check out @${username} over at https://twitch.tv/${username}! They're a valued member of the community, so please toss them a follow.`;
        }

        await this.client.say(channel, shoutoutMessage);

        const sentAt = Date.now();
        this.cooldowns.set(cooldownKey, sentAt);
        this.cooldowns.set(immediateCooldownKey, sentAt);
        this.streamShoutouts.set(streamKey, sentAt);
        if (checkMessageCooldown) this.messageChecks.set(checkKey, sentAt);
      
        // Save cooldowns to disk after updating
        try {
          this.saveShoutouts();
        } catch (error) {
          console.error('[Shoutout] Error saving cooldowns:', error?.message || 'Unknown error');
        }
        return true;
      } catch (error) {
        console.error('Error sending shoutout:', error?.message || 'Unknown error');
        return false;
      }
    })();

    this.pendingShoutouts.set(cooldownKey, shoutoutPromise);
    try {
      await shoutoutPromise;
    } finally {
      if (this.pendingShoutouts.get(cooldownKey) === shoutoutPromise) {
        this.pendingShoutouts.delete(cooldownKey);
      }
    }
  }

  addUser(username) {
    const user = username.toLowerCase().replace('@', '');
    if (this.shoutoutUsers.has(user)) return false;
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
    // Generate a stream session ID that persists for the entire stream session
    // This ID will only change when the bot restarts or when manually reset
    if (!this.currentStreamId) {
      const now = new Date();
      // Create a unique ID based on bot start time and current date (without time)
      this.currentStreamId = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')}-${Date.now()}`;
      this.streamShoutouts.clear(); // Clear previous session data
    }
    
    return this.currentStreamId;
  }

  // Add method to manually reset stream session (for testing or manual stream changes)
  resetStreamSession() {
    this.currentStreamId = null;
    this.streamShoutouts.clear();
  }

  clearCooldown(username) {
    const user = username.toLowerCase().replace('@', '');
    let cleared = false;
    for (const [key] of this.cooldowns) {
      if (key.endsWith(`_${user}`)) {
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
    if (cleared) this.saveShoutouts();
    return cleared;
  }

  async getAppAccessToken(forceRefresh = false) {
    try {
      // Return cached token if it's still valid (with 5-minute buffer)
      if (!forceRefresh && this.accessToken && Date.now() < this.tokenExpiry - 300000) {
        return this.accessToken;
      }
      
      if (!twitchConfig.twitch_client_id || !twitchConfig.twitch_client_secret) {
        console.warn('[Shoutout] Missing Twitch API credentials');
        return null;
      }
      
      const response = await axios.post('https://id.twitch.tv/oauth2/token', null, {
        params: {
          client_id: twitchConfig.twitch_client_id,
          client_secret: twitchConfig.twitch_client_secret,
          grant_type: 'client_credentials'
        },
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });
      
      if (!response.data.access_token) {
        throw new Error('No access token in response');
      }
      
      // Cache the token with its expiry time (default to 1 hour if not provided)
      this.accessToken = response.data.access_token;
      this.tokenExpiry = Date.now() + ((response.data.expires_in || 3600) * 1000);
      
      return this.accessToken;
    } catch (error) {
      console.error('[Shoutout] Error getting app access token:', error.message);
      if (error.response) {
        console.error('[Shoutout] Error response data:', error.response.data);
        console.error('[Shoutout] Error status:', error.response.status);
      }
      return null;
    }
  }

  async requestHelix(endpoint, params) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.getAppAccessToken(attempt === 1);
      if (!token) throw new Error('Failed to obtain Twitch API access token');

      try {
        return await axios.get(`https://api.twitch.tv/helix/${endpoint}`, {
          headers: {
            'Client-ID': twitchConfig.twitch_client_id,
            Authorization: `Bearer ${token}`
          },
          params
        });
      } catch (error) {
        if (error.response?.status === 401 && attempt === 0) continue;
        throw error;
      }
    }
  }

  async getUserInfo(username) {
    let user;
    try {
      const userResponse = await this.requestHelix('users', { login: username.toLowerCase() });
      
      if (!userResponse.data?.data?.length) {
        return this.getFallbackUserInfo(username);
      }
      
      user = userResponse.data.data[0];
      
      // Then get their stream info to check what game they're playing
      const streamResponse = await this.requestHelix('streams', {
        user_id: user.id,
        type: 'live'
      });
      
      // Prefer live stream details, but fill missing activity fields from the fallback source.
      if (streamResponse.data?.data?.length) {
        const streamInfo = { ...user, ...streamResponse.data.data[0] };
        if (streamInfo.game_name || streamInfo.title) return streamInfo;

        const fallbackInfo = await this.getFallbackUserInfo(username, user);
        return {
          ...streamInfo,
          game_name: streamInfo.game_name || fallbackInfo?.game_name || '',
          title: streamInfo.title || fallbackInfo?.title || ''
        };
      }
      
      // When offline, channel metadata still provides its current category and title.
      try {
        const channelResponse = await this.requestHelix('channels', { broadcaster_id: user.id });
        
        if (channelResponse.data?.data?.length) {
          const channelInfo = { ...user, ...channelResponse.data.data[0] };
          if (channelInfo.game_name || channelInfo.title) return channelInfo;

          const fallbackInfo = await this.getFallbackUserInfo(username, user);
          return {
            ...channelInfo,
            game_name: channelInfo.game_name || fallbackInfo?.game_name || '',
            title: channelInfo.title || fallbackInfo?.title || ''
          };
        }
      } catch (channelError) {
        console.warn(`[Shoutout] Could not fetch channel info for ${username}:`, channelError.message);
      }
    } catch (error) {
      console.error(`[Shoutout] Error fetching user info for ${username}:`, error.message);
    }

    return this.getFallbackUserInfo(username, user);
  }

  async getFallbackUserInfo(username, user = null) {
    try {
      const response = await axios.get('https://api.ivr.fi/v2/twitch/user', {
        params: { login: username.toLowerCase() }
      });
      const fallbackUser = Array.isArray(response.data) ? response.data[0] : null;
      if (!fallbackUser) return user;

      const stream = fallbackUser.stream;
      const lastBroadcast = fallbackUser.lastBroadcast;
      return {
        ...user,
        display_name: user?.display_name || fallbackUser.displayName,
        game_name: stream?.game?.displayName || lastBroadcast?.game?.displayName || '',
        title: stream?.title || lastBroadcast?.title || ''
      };
    } catch (error) {
      console.warn(`[Shoutout] Could not fetch fallback activity for ${username}:`, error.message);
      return user;
    }
  }
}

module.exports = new TwitchShoutouts();