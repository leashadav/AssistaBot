const axios = require('axios');
const { EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const configLoader = require('./configLoader');
const { updateLiveRoles } = require('../utils/liveRoleManager');

class TwitchBot {
  constructor(client) {
    this.client = client;
    this.guildStreamers = new Map();
    this.streamerStatus = new Map();
    this.accessToken = null;
    this.tokenExpiry = 0;
    
    try {
      this.config = configLoader.twitch;
      this.loadStreamerData();
    } catch (err) {
      this.config = {};
    }
  }

  loadStreamerData() {
    try {
      const dataPath = path.join(__dirname, '..', 'data', 'twitch_streamers.json');
      if (fs.existsSync(dataPath)) {
        const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
        this.guildStreamers = new Map(Object.entries(data));

        for (const [, guildData] of this.guildStreamers.entries()) {
          for (const streamer of guildData.streamers) {
            // Ensure messageId is always null (not undefined) for cleanup logic
            if (streamer.messageId === undefined) streamer.messageId = null;
            // Restore persisted live status so we don't re-notify on restart
            this.streamerStatus.set(streamer.username.toLowerCase(), {
              isLive: !!streamer._isLive
            });
          }
        }
      }
    } catch (err) {
      console.error('[Twitch] Error loading streamer data:', err.message);
    }
  }

  saveStreamerData() {
    try {
      const dataPath = path.join(__dirname, '..', 'data', 'twitch_streamers.json');
      const data = Object.fromEntries(this.guildStreamers);
      fs.writeFileSync(dataPath, JSON.stringify(data, null, 2));
    } catch (err) {
      console.error('[Twitch] Error saving streamer data:', err.message);
    }
  }

  async getAccessToken(forceRefresh = false) {
    if (!forceRefresh && this.accessToken && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    try {
      const response = await axios.post('https://id.twitch.tv/oauth2/token', null, {
        params: {
          client_id: this.config.twitch_client_id,
          client_secret: this.config.twitch_client_secret,
          grant_type: 'client_credentials'
        }
      });

      this.accessToken = response.data.access_token;
      this.tokenExpiry = Date.now() + (response.data.expires_in * 1000) - 60000;
      return this.accessToken;
    } catch (err) {
      console.error('[Twitch] Error getting access token:', err.message);
      throw err;
    }
  }

  async requestHelix(endpoint, params) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.getAccessToken(attempt === 1);
      try {
        return await axios.get(`https://api.twitch.tv/helix/${endpoint}`, {
          params,
          headers: {
            'Client-ID': this.config.twitch_client_id,
            'Authorization': `Bearer ${token}`
          }
        });
      } catch (err) {
        if (err.response?.status === 401 && attempt === 0) {
          this.accessToken = null;
          this.tokenExpiry = 0;
          continue;
        }
        throw err;
      }
    }
  }

  addStreamer(username, guildId, channelId, customMessage = '', discordUsername = '', liveRoles = [], cleanup = false, cooldown = 0) {
    const normalized = username.toLowerCase().trim();
    if (!this.guildStreamers.has(guildId)) this.guildStreamers.set(guildId, { streamers: [] });

    const guildData = this.guildStreamers.get(guildId);
    if (guildData.streamers.some(s => s.username === normalized)) return false;

    guildData.streamers.push({
      username: normalized,
      channelId,
      customMessage,
      discordUsername,
      liveRoles: Array.isArray(liveRoles) ? liveRoles : [],
      cleanup,
      cooldown: Number(cooldown) || 0,
      lastNotifiedAt: 0,
      messageId: null,
      _isLive: false
    });

    this.streamerStatus.set(normalized, { isLive: false });
    this.saveStreamerData();
    return true;
  }

  editStreamer(username, guildId, updates = {}) {
    const normalized = username.toLowerCase().trim();
    if (!this.guildStreamers.has(guildId)) return false;

    const guildData = this.guildStreamers.get(guildId);
    const streamer = guildData.streamers.find(s => s.username === normalized);
    if (!streamer) return false;

    if (updates.customMessage !== undefined) streamer.customMessage = updates.customMessage;
    if (updates.discordUsername !== undefined) streamer.discordUsername = updates.discordUsername;
    if (updates.liveRoles !== undefined) streamer.liveRoles = Array.isArray(updates.liveRoles) ? updates.liveRoles : [];
    if (updates.channelId !== undefined) streamer.channelId = updates.channelId;
    if (updates.cleanup !== undefined) streamer.cleanup = updates.cleanup;
    if (updates.cooldown !== undefined) streamer.cooldown = Number(updates.cooldown) || 0;

    this.saveStreamerData();
    return true;
  }

  removeStreamer(username, guildId) {
    const normalized = username.toLowerCase().trim();
    if (!this.guildStreamers.has(guildId)) return false;

    const guildData = this.guildStreamers.get(guildId);
    const before = guildData.streamers.length;
    guildData.streamers = guildData.streamers.filter(s => s.username !== normalized);
    if (guildData.streamers.length === 0) this.guildStreamers.delete(guildId);

    let stillTracked = false;
    for (const [, other] of this.guildStreamers.entries()) {
      if (other.streamers.some(s => s.username === normalized)) { stillTracked = true; break; }
    }
    if (!stillTracked) this.streamerStatus.delete(normalized);

    this.saveStreamerData();
    return guildData.streamers.length < before;
  }

  getStreamer(username, guildId) {
    const normalized = username.toLowerCase().trim();
    return this.guildStreamers.get(guildId)?.streamers.find(streamer => streamer.username === normalized) || null;
  }

  listStreamers(guildId) {
    const out = [];
    if (!this.guildStreamers.has(guildId)) return out;
    
    const guildData = this.guildStreamers.get(guildId);
    for (const streamer of guildData.streamers) {
      const status = this.streamerStatus.get(streamer.username) || { isLive: false };
      out.push({
        username: streamer.username,
        isLive: !!status.isLive,
        title: status.title || 'N/A',
        viewers: status.viewers || 0,
        game: status.game || 'N/A'
      });
    }
    return out;
  }

  async checkStreamerStatus(username) {
    try {
      const response = await this.requestHelix('streams', { user_login: username });

      if (response.data.data.length > 0) {
        const stream = response.data.data[0];
        return {
          isLive: true,
          title: stream.title,
          game: stream.game_name,
          viewers: stream.viewer_count,
          thumbnail: stream.thumbnail_url.replace('{width}', '1920').replace('{height}', '1080'),
          username: stream.user_login,
          profileImage: null
        };
      }

      return { isLive: false, username };
    } catch (err) {
      console.error(`[Twitch] Error checking ${username} (${err.response?.status || 'request'}):`, err.response?.data?.message || err.message);
      return { isLive: false, username };
    }
  }

  async getUserProfile(username) {
    try {
      const response = await this.requestHelix('users', { login: username });

      if (response.data.data.length > 0) {
        return response.data.data[0].profile_image_url;
      }
    } catch (err) {
      console.error(`[Twitch] Error getting profile for ${username}:`, err.message);
    }
    return null;
  }

  async checkAllStreamers() {
    if (this.guildStreamers.size === 0) return;

    const all = new Set();
    for (const [, guildData] of this.guildStreamers.entries()) {
      for (const s of guildData.streamers) all.add(s.username);
    }

    for (const username of all) {
      try {
        const oldStatus = this.streamerStatus.get(username) || { isLive: false };
        const newStatus = await this.checkStreamerStatus(username);

        if (newStatus.isLive && !oldStatus.isLive) {
          newStatus.profileImage = await this.getUserProfile(username);
          await this.notifyStreamerLive(username, newStatus);
        } else if (newStatus.isLive) {
          for (const [guildId, guildData] of this.guildStreamers.entries()) {
            const streamer = guildData.streamers.find(item => item.username === username);
            if (streamer) {
              await updateLiveRoles(this.client, guildId, streamer.discordUsername, streamer.liveRoles, 'add', `Twitch ${username} went live`, 'Twitch');
            }
          }
        }

        if (!newStatus.isLive && oldStatus.isLive) {
          await this.notifyStreamerOffline(username);
        }

        this.streamerStatus.set(username, newStatus);
      } catch (err) {
        console.error(`[Twitch] Error checking ${username}:`, err.message);
      }
    }
  }

  startMonitoring(intervalMs = 5 * 60 * 1000) {
    if (this.monitoringInterval) return;

    this.checkAllStreamers().catch(err => console.error('[Twitch] Initial check error:', err.message));
    
    this.monitoringInterval = setInterval(() => {
      this.checkAllStreamers().catch(err => console.error('[Twitch] Monitoring error:', err.message));
    }, intervalMs);
  }

  stopMonitoring() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
  }

  async notifyStreamerLive(username, status) {
    for (const [guildId, guildData] of this.guildStreamers.entries()) {
      const streamer = guildData.streamers.find(s => s.username === username);
      if (!streamer) continue;

      if (streamer.cooldown > 0 && Date.now() - (streamer.lastNotifiedAt || 0) < streamer.cooldown * 1000) {
        streamer._isLive = true;
        this.saveStreamerData();
        continue;
      }

      try {
        const channel = await this.client.channels.fetch(streamer.channelId);
        if (!channel?.isTextBased()) continue;

        const streamURL = `https://twitch.tv/${username}`;
        const embed = new EmbedBuilder()
          .setTitle(status.title || `${username} is now broadcasting on Twitch!`)
          .setURL(streamURL)
          .setColor('#9146FF');

        if (status.profileImage) {
          embed.setAuthor({ name: `${username} is now broadcasting on Twitch!`, iconURL: status.profileImage, url: streamURL });
        }
        if (status.game) embed.setDescription(`**Activity:** ${status.game}`);
        if (status.thumbnail) embed.setImage(status.thumbnail);

        let content = '';
        if (streamer.customMessage) {
          content = streamer.customMessage
            .replace(/\{streamer\}/g, username)
            .replace(/\{url\}/g, streamURL)
            .replace(/\{platform\}/g, 'Twitch')
            .replace(/\{title\}/g, status.title || '')
            .replace(/\{game\}/g, status.game || '');
        }

        const msg = await channel.send({ content: content || undefined, embeds: [embed] });

        streamer._isLive = true;
        if (streamer.cleanup) {
          streamer.messageId = msg.id;
        }
        this.saveStreamerData();

        await updateLiveRoles(this.client, guildId, streamer.discordUsername, streamer.liveRoles, 'add', `Twitch ${username} went live`, 'Twitch');
      } catch (err) {
        console.error(`[Twitch] Error sending notification:`, err.message);
      }
    }

  }

  async notifyStreamerOffline(username) {
    for (const [guildId, guildData] of this.guildStreamers.entries()) {
      const streamer = guildData.streamers.find(s => s.username === username);
      if (!streamer) continue;

      if (streamer.cleanup && streamer.messageId) {
        try {
          const channel = await this.client.channels.fetch(streamer.channelId);
          if (channel?.isTextBased()) {
            const message = await channel.messages.fetch(streamer.messageId).catch(() => null);
            if (message) await message.delete();
          }
        } catch (err) {
          console.error(`[Twitch] Error deleting message:`, err.message);
        }
      }
      streamer._isLive = false;
      streamer.messageId = null;
      this.saveStreamerData();

      await updateLiveRoles(this.client, guildId, streamer.discordUsername, streamer.liveRoles, 'remove', `Twitch ${username} went offline`, 'Twitch');
    }

  }

  async manualCheck(username) {
    const status = await this.checkStreamerStatus(username);
    const old = this.streamerStatus.get(username.toLowerCase()) || { isLive: false };
    
    if (status.isLive) {
      status.profileImage = await this.getUserProfile(username);
    }
    
    if (status.isLive && !old.isLive) {
      await this.notifyStreamerLive(username, status);
    }
    
    this.streamerStatus.set(username.toLowerCase(), status);
    return status;
  }
}

module.exports = TwitchBot;