const axios = require('axios');
const { EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const configLoader = require('./configLoader');
const {
  trackUploadNotification,
  startUploadNotificationCleanup,
  stopUploadNotificationCleanup
} = require('./uploadNotificationCleanup');
const { updateLiveRoles } = require('../utils/liveRoleManager');

const DATA_PATH = path.join(__dirname, '..', 'data', 'youtube_streamers.json');

class YouTubeNotifications {
  constructor(client) {
    this.client = client;
    this.guildChannels = new Map();  // guildId -> { channels: [...] }
    this.channelStatus = new Map();  // handle -> { isLive, videoId }
    this.latestUploads = new Map();
    this.monitoringInterval = null;
    this.uploadMonitoringInterval = null;
    this.uploadCleanupInterval = null;
    this.apiKey = null;

    try {
      const config = configLoader.load('youtube');
      this.apiKey = config.youtube_api_key;
    } catch (err) {
      console.error('[YouTube] Failed to load config:', err.message);
    }

    this.loadData();
  }

  loadData() {
    try {
      if (!fs.existsSync(DATA_PATH)) return;
      const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
      this.guildChannels = new Map(Object.entries(data));

      for (const [, guildData] of this.guildChannels.entries()) {
        for (const entry of guildData.channels) {
          if (entry.messageId === undefined) entry.messageId = null;
          if (entry._lastVideoId === undefined) entry._lastVideoId = null;
          if (!Array.isArray(entry._uploadNotifications)) entry._uploadNotifications = [];
          if (typeof entry.cooldown === 'undefined') entry.cooldown = 0;
          if (typeof entry.lastNotifiedAt === 'undefined') entry.lastNotifiedAt = 0;
          // Key status by handle
          this.channelStatus.set(entry.handle, {
            isLive: !!entry._isLive,
            videoId: entry._videoId || null
          });
        }
      }
    } catch (err) {
      console.error('[YouTube] Error loading data:', err.message);
    }
  }

  saveData() {
    try {
      fs.writeFileSync(DATA_PATH, JSON.stringify(Object.fromEntries(this.guildChannels), null, 2));
    } catch (err) {
      console.error('[YouTube] Error saving data:', err.message);
    }
  }

  // UC... -> UU... (uploads playlist ID)
  _uploadsPlaylistId(channelId) {
    return 'UU' + channelId.slice(2);
  }

  async _getYouTube(url, config) {
    const retryableCodes = new Set([
      'ECONNABORTED',
      'ECONNREFUSED',
      'ECONNRESET',
      'EAI_AGAIN',
      'ENOTFOUND',
      'ETIMEDOUT',
      'ERR_NETWORK'
    ]);

    for (let attempt = 0; ; attempt++) {
      try {
        return await axios.get(url, { ...config, timeout: 15000 });
      } catch (err) {
        const code = err.code || err.cause?.code;
        const retryable = retryableCodes.has(code) || err.response?.status >= 500;
        if (!retryable || attempt >= 2) throw err;
        await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
      }
    }
  }

  // Normalize handle to consistent @handle format
  _normalizeHandle(input) {
    let handle = input
      .replace(/https?:\/\/(www\.)?youtube\.com\//i, '')
      .replace(/^(channel\/|c\/|user\/|@)/, '')
      .replace(/\/.*$/, '')
      .trim();
    return '@' + handle;
  }

  // Resolve a handle/URL/channel ID to { handle, channelId }
  async resolveChannel(input) {
    if (!this.apiKey) throw new Error('No YouTube API key configured');

    // If it's already a UC... channel ID, fetch the handle from the API
    if (/^UC[\w-]{22}$/.test(input)) {
      const info = await this.getChannelInfoById(input);
      const handle = info?.handle ? '@' + info.handle.replace(/^@/, '') : input;
      return { handle, channelId: input };
    }

    const handle = this._normalizeHandle(input);
    const rawHandle = handle.slice(1); // strip leading @

    // Try forHandle
    try {
      const res = await axios.get('https://www.googleapis.com/youtube/v3/channels', {
        params: { part: 'id,snippet', forHandle: rawHandle, key: this.apiKey }
      });
      if (res.data.items?.length) {
        const item = res.data.items[0];
        return { handle, channelId: item.id };
      }
    } catch (_) {}

    // Fallback: forUsername (legacy)
    try {
      const res = await axios.get('https://www.googleapis.com/youtube/v3/channels', {
        params: { part: 'id,snippet', forUsername: rawHandle, key: this.apiKey }
      });
      if (res.data.items?.length) {
        const item = res.data.items[0];
        return { handle, channelId: item.id };
      }
    } catch (_) {}

    throw new Error(`Could not resolve YouTube channel: "${input}"`);
  }

  async getChannelInfoById(channelId) {
    if (!this.apiKey) return null;
    try {
      const res = await axios.get('https://www.googleapis.com/youtube/v3/channels', {
        params: { part: 'snippet', id: channelId, key: this.apiKey }
      });
      if (res.data.items?.length) {
        const ch = res.data.items[0].snippet;
        return {
          title: ch.title,
          handle: ch.customUrl || null,
          thumbnail: ch.thumbnails?.default?.url
        };
      }
    } catch (err) {
      console.error(`[YouTube] Error fetching channel info for ${channelId}:`, err.message);
    }
    return null;
  }

  // Used by the command after resolveChannel to show channel name/thumbnail
  async getChannelInfo(handle) {
    const entry = this._findEntryByHandle(handle);
    if (entry) return this.getChannelInfoById(entry.channelId);
    return null;
  }

  _findEntryByHandle(handle) {
    for (const [, guildData] of this.guildChannels.entries()) {
      const found = guildData.channels.find(c => c.handle === handle);
      if (found) return found;
    }
    return null;
  }

  // Fetches the uploads playlist once and returns both live status and latest upload
  async checkChannel(channelId) {
    if (!this.apiKey) return { liveStatus: { isLive: false }, latestUpload: null };
    try {
      const playlistId = this._uploadsPlaylistId(channelId);
      const plRes = await this._getYouTube('https://www.googleapis.com/youtube/v3/playlistItems', {
        params: { part: 'snippet', playlistId, maxResults: 5, key: this.apiKey }
      });
      if (!plRes.data.items?.length) return { liveStatus: { isLive: false }, latestUpload: null };

      const playlistVideoIds = plRes.data.items
        .map(item => item.snippet.resourceId?.videoId)
        .filter(Boolean);
      const videoIds = playlistVideoIds.join(',');

      const vidRes = await this._getYouTube('https://www.googleapis.com/youtube/v3/videos', {
        params: { part: 'snippet,liveStreamingDetails,contentDetails', id: videoIds, key: this.apiKey }
      });
      const videos = vidRes.data.items || [];

      // Live status — find any video currently live
      const liveVideo = videos.find(v => v.snippet.liveBroadcastContent === 'live');
      const liveStatus = liveVideo ? {
        isLive: true,
        videoId: liveVideo.id,
        title: liveVideo.snippet.title,
        channelTitle: liveVideo.snippet.channelTitle,
        thumbnail: liveVideo.snippet.thumbnails?.high?.url || liveVideo.snippet.thumbnails?.default?.url
      } : { isLive: false };

      // Latest upload — first video that is not live or upcoming
      const videosById = new Map(videos.map(video => [video.id, video]));
      const uploadVideo = playlistVideoIds
        .map(videoId => videosById.get(videoId))
        .find(video =>
          video &&
          video.snippet.liveBroadcastContent !== 'live' &&
          video.snippet.liveBroadcastContent !== 'upcoming'
        );
      const latestUpload = uploadVideo ? {
        videoId: uploadVideo.id,
        title: uploadVideo.snippet.title,
        channelTitle: uploadVideo.snippet.channelTitle,
        description: uploadVideo.snippet.description?.slice(0, 200) || '',
        thumbnail: uploadVideo.snippet.thumbnails?.high?.url || uploadVideo.snippet.thumbnails?.default?.url,
        publishedAt: uploadVideo.snippet.publishedAt
      } : null;

      return { liveStatus, latestUpload };
    } catch (err) {
      console.error(`[YouTube] Error checking channel ${channelId}:`, err.message);
      return null;
    }
  }

  addChannel(handle, channelId, guildId, discordChannelId, uploadChannelId = null, customMessage = '', uploadMessage = '', discordUsername = '', liveRoles = [], cleanup = false, cooldown = 0) {
    if (!this.guildChannels.has(guildId)) this.guildChannels.set(guildId, { channels: [] });

    const guildData = this.guildChannels.get(guildId);
    if (guildData.channels.some(c => c.handle === handle)) return false;

    guildData.channels.push({
      handle,
      channelId,
      discordChannelId,
      uploadChannelId: uploadChannelId || discordChannelId,
      customMessage,
      uploadMessage,
      discordUsername,
      liveRoles: Array.isArray(liveRoles) ? liveRoles : [],
      cleanup,
      cooldown: Number(cooldown) || 0,
      lastNotifiedAt: 0,
      messageId: null,
      _isLive: false,
      _videoId: null,
      _lastVideoId: null
    });

    this.channelStatus.set(handle, { isLive: false, videoId: null });
    this.saveData();
    return true;
  }

  editChannel(handle, guildId, updates = {}) {
    if (!this.guildChannels.has(guildId)) return false;
    const entry = this.guildChannels.get(guildId).channels.find(c => c.handle === handle);
    if (!entry) return false;

    if (updates.discordChannelId !== undefined) entry.discordChannelId = updates.discordChannelId;
    if (updates.uploadChannelId !== undefined) entry.uploadChannelId = updates.uploadChannelId;
    if (updates.customMessage !== undefined) entry.customMessage = updates.customMessage;
    if (updates.uploadMessage !== undefined) entry.uploadMessage = updates.uploadMessage;
    if (updates.discordUsername !== undefined) entry.discordUsername = updates.discordUsername;
    if (updates.liveRoles !== undefined) entry.liveRoles = Array.isArray(updates.liveRoles) ? updates.liveRoles : [];
    if (updates.cleanup !== undefined) entry.cleanup = updates.cleanup;
    if (updates.cooldown !== undefined) entry.cooldown = Number(updates.cooldown) || 0;

    this.saveData();
    return true;
  }

  getChannel(handle, guildId) {
    const normalized = handle.trim().toLowerCase();
    return this.guildChannels.get(guildId)?.channels.find(channel => channel.handle.toLowerCase() === normalized) || null;
  }

  removeChannel(handle, guildId) {
    if (!this.guildChannels.has(guildId)) return false;
    const guildData = this.guildChannels.get(guildId);
    const before = guildData.channels.length;
    guildData.channels = guildData.channels.filter(c => c.handle !== handle);
    if (guildData.channels.length === 0) this.guildChannels.delete(guildId);

    let stillTracked = false;
    for (const [, g] of this.guildChannels.entries()) {
      if (g.channels.some(c => c.handle === handle)) { stillTracked = true; break; }
    }
    if (!stillTracked) this.channelStatus.delete(handle);

    this.saveData();
    return before > 0;
  }

  listChannels(guildId) {
    if (!this.guildChannels.has(guildId)) return [];
    return this.guildChannels.get(guildId).channels.map(c => {
      const status = this.channelStatus.get(c.handle) || { isLive: false };
      return {
        handle: c.handle,
        channelId: c.channelId,
        isLive: !!status.isLive,
        discordChannelId: c.discordChannelId,
        uploadChannelId: c.uploadChannelId
      };
    });
  }

  async checkAllChannels(includeUploadChecks = false) {
    if (this.guildChannels.size === 0) return;

    const seen = new Map(); // channelId -> handle
    for (const [, guildData] of this.guildChannels.entries()) {
      for (const c of guildData.channels) {
        if (!seen.has(c.channelId)) seen.set(c.channelId, c.handle);
      }
    }

    for (const [channelId, handle] of seen.entries()) {
      try {
        const result = await this.checkChannel(channelId);
        if (!result) continue;

        const { liveStatus, latestUpload } = result;
        const oldStatus = this.channelStatus.get(handle) || { isLive: false };

        if (liveStatus.isLive && !oldStatus.isLive) await this.notifyLive(handle, channelId, liveStatus);
        else if (liveStatus.isLive) {
          for (const [guildId, guildData] of this.guildChannels.entries()) {
            const entry = guildData.channels.find(item => item.handle === handle);
            if (entry) {
              await updateLiveRoles(this.client, guildId, entry.discordUsername, entry.liveRoles, 'add', `YouTube ${handle} went live`, 'YouTube');
            }
          }
        }
        if (!liveStatus.isLive && oldStatus.isLive) await this.notifyOffline(handle);

        this.channelStatus.set(handle, liveStatus);

        if (latestUpload) {
          this.latestUploads.set(handle, latestUpload);
          if (includeUploadChecks) await this.checkAndNotifyUpload(handle, latestUpload);
        }
      } catch (err) {
        console.error(`[YouTube] Error processing ${handle}:`, err.message);
      }
    }
  }

  async checkAllUploads() {
    for (const [handle, latestUpload] of this.latestUploads) {
      try {
        await this.checkAndNotifyUpload(handle, latestUpload);
      } catch (err) {
        console.error(`[YouTube] Error checking uploads for ${handle}:`, err.message);
      }
    }
  }

  async checkAndNotifyUpload(handle, latestUpload) {
    for (const [, guildData] of this.guildChannels.entries()) {
      const entry = guildData.channels.find(c => c.handle === handle);
      if (!entry) continue;

      if (!entry._lastVideoId) {
        entry._lastVideoId = latestUpload.videoId;
        this.saveData();
        continue;
      }

      if (latestUpload.videoId !== entry._lastVideoId) {
        entry._lastVideoId = latestUpload.videoId;
        this.saveData();
        await this.notifyUpload(handle, latestUpload, entry);
      }
    }
  }

  async notifyLive(handle, channelId, status) {
    const videoUrl = `https://www.youtube.com/watch?v=${status.videoId}`;

    for (const [guildId, guildData] of this.guildChannels.entries()) {
      const entry = guildData.channels.find(c => c.handle === handle);
      if (!entry) continue;

      if (entry.cooldown > 0 && Date.now() - (entry.lastNotifiedAt || 0) < entry.cooldown * 1000) {
        entry._isLive = true;
        this.saveData();
        continue;
      }

      try {
        const channel = await this.client.channels.fetch(entry.discordChannelId);
        if (!channel?.isTextBased()) continue;

        const embed = new EmbedBuilder()
          .setTitle(status.title || `${status.channelTitle} is now broadcasting on YouTube!`)
          .setURL(videoUrl)
          .setColor('#FF0000')
          .setAuthor({ name: `${status.channelTitle} is now broadcasting on YouTube!`, url: videoUrl });

        if (status.thumbnail) embed.setImage(status.thumbnail);

        let content = '';
        if (entry.customMessage) {
          content = entry.customMessage
            .replace(/\{streamer\}/g, status.channelTitle || handle)
            .replace(/\{url\}/g, videoUrl)
            .replace(/\{platform\}/g, 'YouTube')
            .replace(/\{title\}/g, status.title || '');
        }

        const msg = await channel.send({ content: content || undefined, embeds: [embed] });

        entry._isLive = true;
        entry._videoId = status.videoId;
        entry.lastNotifiedAt = Date.now();
        if (entry.cleanup) entry.messageId = msg.id;
        this.saveData();

        await updateLiveRoles(this.client, guildId, entry.discordUsername, entry.liveRoles, 'add', `YouTube ${handle} went live`, 'YouTube');
      } catch (err) {
        console.error(`[YouTube] Error sending live notification:`, err.message);
      }
    }

  }

  async notifyUpload(handle, video, entry) {
    const videoUrl = `https://www.youtube.com/watch?v=${video.videoId}`;

    try {
      const discordChannelId = entry.uploadChannelId || entry.discordChannelId;
      const channel = await this.client.channels.fetch(discordChannelId);
      if (!channel?.isTextBased()) return;

      // Get channel info for avatar
      const channelInfo = await this.getChannelInfoById(entry.channelId);
      const avatarUrl = channelInfo?.thumbnail || null;

      let content = '';
      if (entry.uploadMessage) {
        content = entry.uploadMessage
          .replace(/\{streamer\}/g, video.channelTitle || handle)
          .replace(/\{url\}/g, videoUrl)
          .replace(/\{platform\}/g, 'YouTube')
          .replace(/\{title\}/g, video.title || '');
      }

      const embed = new EmbedBuilder()
        .setTitle(video.title)
        .setURL(videoUrl)
        .setColor('#FF0000')
        .setAuthor({ name: `${video.channelTitle} just uploaded a new video!`, url: `https://www.youtube.com/channel/${entry.channelId}`, iconURL: avatarUrl });

      if (video.thumbnail) embed.setImage(video.thumbnail);
      if (video.description) embed.setDescription(video.description + (video.description.length >= 200 ? '...' : ''));

      const fullContent = content ? content : videoUrl;
      const message = await channel.send({ content: fullContent, embeds: [embed] });
      trackUploadNotification(this, entry, discordChannelId, message.id);

    } catch (err) {
      console.error(`[YouTube] Error sending upload notification:`, err.message);
    }
  }

  async notifyOffline(handle) {
    for (const [guildId, guildData] of this.guildChannels.entries()) {
      const entry = guildData.channels.find(c => c.handle === handle);
      if (!entry) continue;

      if (entry.cleanup && entry.messageId) {
        try {
          const channel = await this.client.channels.fetch(entry.discordChannelId);
          if (channel?.isTextBased()) {
            const msg = await channel.messages.fetch(entry.messageId).catch(() => null);
            if (msg) await msg.delete();
          }
        } catch (err) {
          console.error(`[YouTube] Error deleting message:`, err.message);
        }
      }

      entry._isLive = false;
      entry._videoId = null;
      entry.messageId = null;
      this.saveData();

      await updateLiveRoles(this.client, guildId, entry.discordUsername, entry.liveRoles, 'remove', `YouTube ${handle} went offline`, 'YouTube');
    }

  }

  async manualCheck(handle) {
    const entry = this._findEntryByHandle(handle);
    if (!entry) return { isLive: false };

    const old = this.channelStatus.get(handle) || { isLive: false };
    const result = await this.checkChannel(entry.channelId);
    if (!result) return { ...old, unavailable: true };

    const { liveStatus } = result;
    if (liveStatus.isLive && !old.isLive) await this.notifyLive(handle, entry.channelId, liveStatus);
    this.channelStatus.set(handle, liveStatus);
    return liveStatus;
  }

  startMonitoring(intervalMs = 5 * 60 * 1000, uploadIntervalMs = 15 * 60 * 1000) {
    startUploadNotificationCleanup(this, 'YouTube');
    if (this.monitoringInterval) return;
    this.checkAllChannels(true).catch(err => console.error('[YouTube] Initial check error:', err.message));
    this.monitoringInterval = setInterval(() => {
      this.checkAllChannels().catch(err => console.error('[YouTube] Monitoring error:', err.message));
    }, intervalMs);
    this.uploadMonitoringInterval = setInterval(() => {
      this.checkAllUploads().catch(err => console.error('[YouTube] Upload monitoring error:', err.message));
    }, uploadIntervalMs);
  }

  stopMonitoring() {
    stopUploadNotificationCleanup(this);
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
    if (this.uploadMonitoringInterval) {
      clearInterval(this.uploadMonitoringInterval);
      this.uploadMonitoringInterval = null;
    }
  }
}

module.exports = YouTubeNotifications;