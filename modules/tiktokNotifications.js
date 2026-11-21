const axios = require('axios');
const { EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const {
  trackUploadNotification,
  startUploadNotificationCleanup,
  stopUploadNotificationCleanup
} = require('./uploadNotificationCleanup');
const { updateLiveRoles } = require('../utils/liveRoleManager');

const DATA_PATH = path.join(__dirname, '..', 'data', 'tiktok_streamers.json');
const CONFIG_PATH = path.join(__dirname, '..', 'config', 'tiktok.json');

function truncateDiscordText(value, maxLength) {
  const text = String(value || '');
  if (text.length <= maxLength) return text;

  let truncated = text.slice(0, maxLength - 3);
  const lastCodeUnit = truncated.charCodeAt(truncated.length - 1);
  if (lastCodeUnit >= 0xD800 && lastCodeUnit <= 0xDBFF) {
    truncated = truncated.slice(0, -1);
  }
  return `${truncated}...`;
}

class TikTokNotifications {
  constructor(client) {
    this.client = client;
    this.guildChannels = new Map();  // guildId -> { channels: [] }
    this.channelStatus = new Map();  // username -> { isLive, videoId }
    this.monitoringInterval = null;
    this.uploadMonitoringInterval = null;
    this.uploadCleanupInterval = null;
    this.videoDataWarnings = new Set();
    this.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    this.rateLimitUntil = 0;

    this.loadData();
  }

  async _getPage(url, headers) {
    if (Date.now() < this.rateLimitUntil) return null;

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await axios.get(url, { headers, timeout: 15000 });
      } catch (err) {
        if (err.response?.status === 429) {
          const retryAfter = err.response.headers?.['retry-after'];
          const retryAfterSeconds = Number(retryAfter);
          const retryAt = retryAfter && Number.isFinite(retryAfterSeconds)
            ? Date.now() + retryAfterSeconds * 1000
            : Date.parse(retryAfter);
          this.rateLimitUntil = Number.isFinite(retryAt) && retryAt > Date.now()
            ? retryAt
            : Date.now() + 15 * 60 * 1000;
        }

        const isTransientGatewayError = [502, 503, 504].includes(err.response?.status);
        if (attempt === 0 && isTransientGatewayError) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          continue;
        }

        throw err;
      }
    }
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
          if (entry._lastVideoCount === undefined) entry._lastVideoCount = null;
          if (!Array.isArray(entry._uploadNotifications)) entry._uploadNotifications = [];
          this.channelStatus.set(entry.username, {
            isLive: !!entry._isLive,
            videoId: entry._videoId || null
          });
        }
      }
    } catch (err) {
      console.error('[TikTok] Error loading data:', err.message);
    }
  }

  saveData() {
    try {
      fs.writeFileSync(DATA_PATH, JSON.stringify(Object.fromEntries(this.guildChannels), null, 2));
    } catch (err) {
      console.error('[TikTok] Error saving data:', err.message);
    }
  }

  _normalizeUsername(input) {
    return input
      .replace(/https?:\/\/(www\.)?tiktok\.com\//i, '')
      .replace(/^@/, '')
      .replace(/\/.*$/, '')
      .trim();
  }

  async _assignLiveRoles(guildId, username, entry) {
    await updateLiveRoles(this.client, guildId, entry.discordUsername, entry.liveRoles, 'add', `TikTok ${username} went live`, 'TikTok');
  }

  async checkLiveStatus(username) {
    const normalized = this._normalizeUsername(username);
    const url = `https://www.tiktok.com/@${normalized}/live`;

    try {
      const response = await this._getPage(url, {
          'User-Agent': this.userAgent,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5'
      });
      if (!response) return null;

      const $ = cheerio.load(response.data);

      let liveRoomInfo = null;
      let account = null;
      const findLiveRoomInfo = value => {
        if (!value || typeof value !== 'object') return null;
        if (value.liveRoomUserInfo?.liveRoom && typeof value.liveRoomUserInfo.liveRoom === 'object') {
          return value.liveRoomUserInfo.liveRoom;
        }
        if (value.liveRoomInfo && typeof value.liveRoomInfo === 'object') return value.liveRoomInfo;
        for (const child of Object.values(value)) {
          const found = findLiveRoomInfo(child);
          if (found) return found;
        }
        return null;
      };
      const findAccount = value => {
        if (!value || typeof value !== 'object') return null;
        const user = value.user;
        if (user?.uniqueId?.toLowerCase() === normalized.toLowerCase()) return user;
        for (const child of Object.values(value)) {
          const found = findAccount(child);
          if (found) return found;
        }
        return null;
      };

      $('script#__UNIVERSAL_DATA_FOR_REHYDRATION__, script#SIGI_STATE, script#__SIGI_STATE__, script#__NEXT_DATA__').each((_, script) => {
        if (liveRoomInfo && account) return;
        try {
          const pageState = JSON.parse($(script).contents().text());
          liveRoomInfo ||= findLiveRoomInfo(pageState);
          account ||= findAccount(pageState);
        } catch {
          // Ignore unrelated or malformed page scripts.
        }
      });

      const roomInfo = liveRoomInfo?.roomInfo;
      const roomId = roomInfo?.roomId || liveRoomInfo?.roomId;
      const accountRoomId = account?.roomId;
      const roomStatus = roomInfo?.status ?? liveRoomInfo?.status;
      const isLive = liveRoomInfo?.isLive === true ||
                     roomInfo?.isLive === true ||
                     roomStatus === 2 ||
                     roomStatus === '2' ||
                     roomStatus === 'LIVE';

      if (isLive) {
        // Try to extract stream info
        const title = $('meta[property="og:title"]').attr('content') || 
                      $('title').text() || 
                      `${username} is live on TikTok`;
        const thumbnail = liveRoomInfo?.coverUrl || roomInfo?.coverUrl || $('meta[property="og:image"]').attr('content') || null;

        return {
          isLive: true,
          username: normalized,
          videoId: roomId || accountRoomId ? String(roomId || accountRoomId) : null,
          title: title,
          thumbnail: thumbnail,
          profileImage: account?.avatarLarger || account?.avatarMedium || null,
          url: url
        };
      }

      return { isLive: false, username: normalized };
    } catch (err) {
      if (err.response?.status === 429) {
        console.warn(`[TikTok] Rate limited while checking live status for ${username}; pausing requests until ${new Date(this.rateLimitUntil).toISOString()}.`);
      } else {
        console.error(`[TikTok] Error checking live status for ${username}:`, err.message);
      }
      return null;
    }
  }

  async checkLatestVideo(username) {
    const normalized = this._normalizeUsername(username);
    const url = `https://www.tiktok.com/@${normalized}`;

    try {
      const response = await this._getPage(url, {
          'User-Agent': this.userAgent,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
      });
      if (!response) return null;

      const $ = cheerio.load(response.data);
      const title = $('meta[property="og:title"]').attr('content') || null;
      const description = $('meta[property="og:description"]').attr('content') || '';
      const thumbnail = $('meta[property="og:image"]').attr('content') || null;
      const itemCandidates = [];
      const visited = new Set();
      let profileImage = null;
      let videoCount = null;
      const visit = value => {
        if (!value || typeof value !== 'object' || visited.has(value)) return;
        visited.add(value);

        const user = value.user && typeof value.user === 'object' ? value.user : value;
        if (user.uniqueId?.toLowerCase() === normalized.toLowerCase()) {
          profileImage = user.avatarLarger || user.avatarMedium || profileImage;
        }

        const profileInfo = value.userInfo;
        if (profileInfo?.user?.uniqueId?.toLowerCase() === normalized.toLowerCase()) {
          const count = Number(profileInfo.statsV2?.videoCount ?? profileInfo.stats?.videoCount);
          if (Number.isFinite(count) && count >= 0) videoCount = count;
        }

        if (!Array.isArray(value)) {
          const videoId = value.id || value.itemId;
          if (videoId && value.video && typeof value.video === 'object') {
            itemCandidates.push(value);
          }
        }

        for (const child of Object.values(value)) visit(child);
      };

      $('script#__UNIVERSAL_DATA_FOR_REHYDRATION__, script#SIGI_STATE, script#__SIGI_STATE__, script#__NEXT_DATA__').each((_, script) => {
        try {
          visit(JSON.parse($(script).contents().text()));
        } catch {
          // Ignore unrelated or malformed page scripts.
        }
      });

      const linkedVideoId = $('a[href*="/video/"]')
        .toArray()
        .map(anchor => $(anchor).attr('href') || '')
        .map(href => href.match(/\/@([^/?#]+)\/video\/(\d+)/i))
        .find(match => match && match[1].toLowerCase() === normalized.toLowerCase())?.[2];
      const videoItem = itemCandidates.sort((a, b) => Number(b.createTime || 0) - Number(a.createTime || 0))[0];
      if (videoItem) {
        this.videoDataWarnings.delete(normalized);
        const videoId = String(videoItem.id || videoItem.itemId);
        const video = videoItem.video;
        const cover = video.cover || video.originCover || video.dynamicCover;
        const videoThumbnail = typeof cover === 'string' ? cover : cover?.urlList?.[0] || thumbnail;
        return {
          videoId,
          title: videoItem.desc || videoItem.title || title || `${normalized} uploaded a new TikTok video`,
          description: description.slice(0, 200),
          thumbnail: videoThumbnail,
          profileImage,
          videoCount,
          url: `https://www.tiktok.com/@${normalized}/video/${videoId}`,
          username: normalized
        };
      }

      if (linkedVideoId) {
        this.videoDataWarnings.delete(normalized);
        return {
          videoId: linkedVideoId,
          title: `${normalized} uploaded a new TikTok video`,
          description: description.slice(0, 200),
          thumbnail,
          profileImage,
          videoCount,
          url: `https://www.tiktok.com/@${normalized}/video/${linkedVideoId}`,
          username: normalized
        };
      }

      if (Number.isFinite(videoCount)) {
        return {
          videoId: null,
          videoCount,
          title: `${normalized} published a new TikTok video`,
          description: description.slice(0, 200),
          thumbnail,
          profileImage,
          url,
          username: normalized
        };
      }

      if (!this.videoDataWarnings.has(normalized)) {
        console.warn(`[TikTok] No video details or public video count found for @${normalized}; upload changes cannot be detected.`);
        this.videoDataWarnings.add(normalized);
      }
      return null;
    } catch (err) {
      if (err.response?.status === 429) {
        console.warn(`[TikTok] Rate limited while checking the latest video for ${username}; pausing requests until ${new Date(this.rateLimitUntil).toISOString()}.`);
      } else {
        console.error(`[TikTok] Error checking latest video for ${username}:`, err.message);
      }
      return null;
    }
  }

  addChannel(username, guildId, discordChannelId, uploadChannelId = null, customMessage = '', uploadMessage = '', discordUsername = '', liveRoles = [], cleanup = false) {
    const normalized = this._normalizeUsername(username);
    
    if (!this.guildChannels.has(guildId)) this.guildChannels.set(guildId, { channels: [] });

    const guildData = this.guildChannels.get(guildId);
    if (guildData.channels.some(c => c.username === normalized)) return false;

    guildData.channels.push({
      username: normalized,
      discordChannelId,
      uploadChannelId: uploadChannelId || discordChannelId,
      customMessage,
      uploadMessage,
      discordUsername,
      liveRoles: Array.isArray(liveRoles) ? liveRoles : [],
      cleanup,
      messageId: null,
      _isLive: false,
      _videoId: null,
      _lastVideoId: null,
      _lastVideoCount: null
    });

    this.channelStatus.set(normalized, { isLive: false, videoId: null });
    this.saveData();
    return true;
  }

  editChannel(username, guildId, updates = {}) {
    const normalized = this._normalizeUsername(username);
    
    if (!this.guildChannels.has(guildId)) return false;
    const entry = this.guildChannels.get(guildId).channels.find(c => c.username === normalized);
    if (!entry) return false;

    if (updates.discordChannelId !== undefined) entry.discordChannelId = updates.discordChannelId;
    if (updates.uploadChannelId !== undefined) entry.uploadChannelId = updates.uploadChannelId;
    if (updates.customMessage !== undefined) entry.customMessage = updates.customMessage;
    if (updates.uploadMessage !== undefined) entry.uploadMessage = updates.uploadMessage;
    if (updates.discordUsername !== undefined) entry.discordUsername = updates.discordUsername;
    if (updates.liveRoles !== undefined) entry.liveRoles = Array.isArray(updates.liveRoles) ? updates.liveRoles : [];
    if (updates.cleanup !== undefined) entry.cleanup = updates.cleanup;

    this.saveData();
    return true;
  }

  getChannel(username, guildId) {
    const normalized = this._normalizeUsername(username);
    return this.guildChannels.get(guildId)?.channels.find(channel => channel.username === normalized) || null;
  }

  removeChannel(username, guildId) {
    const normalized = this._normalizeUsername(username);
    
    if (!this.guildChannels.has(guildId)) return false;
    const guildData = this.guildChannels.get(guildId);
    const before = guildData.channels.length;
    guildData.channels = guildData.channels.filter(c => c.username !== normalized);
    if (guildData.channels.length === 0) this.guildChannels.delete(guildId);

    let stillTracked = false;
    for (const [, g] of this.guildChannels.entries()) {
      if (g.channels.some(c => c.username === normalized)) { stillTracked = true; break; }
    }
    if (!stillTracked) this.channelStatus.delete(normalized);

    this.saveData();
    return before > 0;
  }

  listChannels(guildId) {
    if (!this.guildChannels.has(guildId)) return [];
    return this.guildChannels.get(guildId).channels.map(c => {
      const status = this.channelStatus.get(c.username) || { isLive: false };
      return {
        username: c.username,
        isLive: !!status.isLive,
        discordChannelId: c.discordChannelId,
        uploadChannelId: c.uploadChannelId
      };
    });
  }

  async checkAllChannels(includeUploadChecks = false) {
    if (this.guildChannels.size === 0) return;

    const seen = new Set();
    for (const [, guildData] of this.guildChannels.entries()) {
      for (const c of guildData.channels) {
        seen.add(c.username);
      }
    }

    for (const username of seen) {
      try {
        const liveStatus = await this.checkLiveStatus(username);
        const oldStatus = this.channelStatus.get(username) || { isLive: false };

        if (liveStatus) {
          if (this._isNewLiveSession(liveStatus, oldStatus)) await this.notifyLive(username, liveStatus);
          else if (liveStatus.isLive) {
            for (const [guildId, guildData] of this.guildChannels.entries()) {
              const entry = guildData.channels.find(c => c.username === username);
              if (entry) await this._assignLiveRoles(guildId, username, entry);
            }
          }
          if (!liveStatus.isLive && oldStatus.isLive) await this.notifyOffline(username);

          this.channelStatus.set(username, liveStatus);
        }

        if (includeUploadChecks) {
          const latestVideo = await this.checkLatestVideo(username);
          if (latestVideo) await this.checkAndNotifyUpload(username, latestVideo);
        }
      } catch (err) {
        console.error(`[TikTok] Error processing ${username}:`, err.message);
      }
    }
  }

  async checkAllUploads() {
    if (this.guildChannels.size === 0) return;

    const usernames = new Set();
    for (const [, guildData] of this.guildChannels.entries()) {
      for (const channel of guildData.channels) usernames.add(channel.username);
    }

    for (const username of usernames) {
      try {
        const latestVideo = await this.checkLatestVideo(username);
        if (latestVideo) await this.checkAndNotifyUpload(username, latestVideo);
      } catch (err) {
        console.error(`[TikTok] Error checking uploads for ${username}:`, err.message);
      }
    }
  }

  _isNewLiveSession(liveStatus, oldStatus) {
    return liveStatus.isLive && (
      !oldStatus.isLive ||
      (liveStatus.videoId && liveStatus.videoId !== oldStatus.videoId)
    );
  }

  async checkAndNotifyUpload(username, latestVideo) {
    for (const [, guildData] of this.guildChannels.entries()) {
      const entry = guildData.channels.find(c => c.username === username);
      if (!entry) continue;

      if (!latestVideo.videoId) {
        if (!Number.isFinite(latestVideo.videoCount)) continue;

        if (!Number.isFinite(entry._lastVideoCount)) {
          entry._lastVideoCount = latestVideo.videoCount;
          this.saveData();
          continue;
        }

        if (latestVideo.videoCount > entry._lastVideoCount) {
          if (await this.notifyUpload(username, latestVideo, entry)) {
            entry._lastVideoCount = latestVideo.videoCount;
            this.saveData();
          }
        } else if (latestVideo.videoCount < entry._lastVideoCount) {
          entry._lastVideoCount = latestVideo.videoCount;
          this.saveData();
        }
        continue;
      }

      if (!entry._lastVideoId) {
        entry._lastVideoId = latestVideo.videoId;
        if (Number.isFinite(latestVideo.videoCount)) {
          entry._lastVideoCount = latestVideo.videoCount;
        }
        this.saveData();
        continue;
      }

      if (latestVideo.videoId !== entry._lastVideoId) {
        if (await this.notifyUpload(username, latestVideo, entry)) {
          entry._lastVideoId = latestVideo.videoId;
          if (Number.isFinite(latestVideo.videoCount)) {
            entry._lastVideoCount = latestVideo.videoCount;
          }
          this.saveData();
        }
      }
    }
  }

  async notifyLive(username, status) {
    const url = `https://www.tiktok.com/@${username}/live`;

    for (const [guildId, guildData] of this.guildChannels.entries()) {
      const entry = guildData.channels.find(c => c.username === username);
      if (!entry) continue;

      try {
        const channel = await this.client.channels.fetch(entry.discordChannelId);
        if (!channel?.isTextBased()) continue;

        const description = [
          status.title,
          status.game ? `**Activity:** ${status.game}` : ''
        ].filter(Boolean).join('\n');
        const embed = new EmbedBuilder()
          .setTitle(`${username} is now broadcasting on TikTok!`)
          .setDescription(truncateDiscordText(description, 4096))
          .setURL(url)
          .setColor('#00F2EA');

        if (status.profileImage) {
          embed.setAuthor({ name: `${username} is now broadcasting on TikTok!`, iconURL: status.profileImage, url });
        }

        if (status.thumbnail) embed.setImage(status.thumbnail);

        let content = '';
        if (entry.customMessage) {
          content = entry.customMessage
            .replace(/\{streamer\}/g, username)
            .replace(/\{url\}/g, url)
            .replace(/\{platform\}/g, 'TikTok')
            .replace(/\{title\}/g, status.title || '')
            .replace(/\{game\}/g, status.game || '');
        }

        const msg = await channel.send({ content: content || undefined, embeds: [embed] });

        entry._isLive = true;
        entry._videoId = status.videoId || Date.now().toString();
        if (entry.cleanup) entry.messageId = msg.id;
        this.saveData();

        await this._assignLiveRoles(guildId, username, entry);
      } catch (err) {
        console.error(`[TikTok] Error sending live notification:`, err.message);
      }
    }
  }

  async notifyUpload(username, video, entry) {
    const profileUrl = `https://www.tiktok.com/@${username}`;
    const url = video.videoId
      ? `https://www.tiktok.com/@${username}/video/${video.videoId}`
      : video.url || profileUrl;
    const videoTitle = video.title || video.description || `${username} uploaded a new TikTok video`;

    try {
      const discordChannelId = entry.uploadChannelId || entry.discordChannelId;
      const channel = await this.client.channels.fetch(discordChannelId);
      if (!channel?.isTextBased()) return false;

      let content = '';
      if (entry.uploadMessage) {
        content = entry.uploadMessage
          .replace(/\{streamer\}/g, username)
          .replace(/\{url\}/g, url)
          .replace(/\{platform\}/g, 'TikTok')
          .replace(/\{title\}/g, video.title || '');
      }

      const embed = new EmbedBuilder()
        .setTitle(`${username} uploaded a new TikTok video`)
        .setDescription(truncateDiscordText(videoTitle, 4096))
        .setURL(url)
        .setColor('#00F2EA')
        .setAuthor({
          name: `${username} just uploaded a new video!`,
          url,
          ...(video.profileImage ? { iconURL: video.profileImage } : {})
        });

      if (video.thumbnail) embed.setImage(video.thumbnail);

      const fullContent = truncateDiscordText(content || url, 2000);
      const message = await channel.send({ content: fullContent, embeds: [embed] });
      trackUploadNotification(this, entry, discordChannelId, message.id);
      return true;

    } catch (err) {
      console.error(`[TikTok] Error sending upload notification:`, err.message);
      return false;
    }
  }

  async notifyOffline(username) {
    for (const [guildId, guildData] of this.guildChannels.entries()) {
      const entry = guildData.channels.find(c => c.username === username);
      if (!entry) continue;

      if (entry.cleanup && entry.messageId) {
        try {
          const channel = await this.client.channels.fetch(entry.discordChannelId);
          if (channel?.isTextBased()) {
            const msg = await channel.messages.fetch(entry.messageId).catch(() => null);
            if (msg) await msg.delete();
          }
        } catch (err) {
          console.error(`[TikTok] Error deleting message:`, err.message);
        }
      }

      entry._isLive = false;
      entry._videoId = null;
      entry.messageId = null;
      this.saveData();

      await updateLiveRoles(this.client, guildId, entry.discordUsername, entry.liveRoles, 'remove', `TikTok ${username} went offline`, 'TikTok');
    }
  }

  async manualCheck(username) {
    const normalized = this._normalizeUsername(username);
    const entry = this._findEntryByUsername(normalized);
    if (!entry) return { isLive: false };

    const old = this.channelStatus.get(normalized) || { isLive: false };
    const liveStatus = await this.checkLiveStatus(normalized);
    if (!liveStatus) return { isLive: !!old.isLive, unavailable: true };
    if (this._isNewLiveSession(liveStatus, old)) await this.notifyLive(normalized, liveStatus);
    else if (liveStatus.isLive) {
      for (const [guildId, guildData] of this.guildChannels.entries()) {
        const entry = guildData.channels.find(c => c.username === normalized);
        if (entry) await this._assignLiveRoles(guildId, normalized, entry);
      }
    }
    if (!liveStatus.isLive && old.isLive) await this.notifyOffline(normalized);
    this.channelStatus.set(normalized, liveStatus);
    return liveStatus;
  }

  _findEntryByUsername(username) {
    for (const [, guildData] of this.guildChannels.entries()) {
      const found = guildData.channels.find(c => c.username === username);
      if (found) return found;
    }
    return null;
  }

  startMonitoring(intervalMs = 5 * 60 * 1000, uploadIntervalMs = 15 * 60 * 1000) {
    startUploadNotificationCleanup(this, 'TikTok');
    if (this.monitoringInterval) return;
    this.checkAllChannels(true).catch(err => console.error('[TikTok] Initial check error:', err.message));
    this.monitoringInterval = setInterval(() => {
      this.checkAllChannels().catch(err => console.error('[TikTok] Monitoring error:', err.message));
    }, intervalMs);
    this.uploadMonitoringInterval = setInterval(() => {
      this.checkAllUploads().catch(err => console.error('[TikTok] Upload monitoring error:', err.message));
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

module.exports = TikTokNotifications;