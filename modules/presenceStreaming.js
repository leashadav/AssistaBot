const { EmbedBuilder } = require('discord.js');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const guildSettings = require('./guildSettings');
const configLoader = require('./configLoader');
const USER_STATUS_PATH = path.join(__dirname, '..', 'data', 'presence_streaming_status.json');

class PresenceStreaming {
  constructor(client) {
    this.client = client;
    this.userStatus = new Map();
    this.twitchConfig = null;
    this.youtubeConfig = null;
    this.processingUsers = new Map(); // Track users being processed to prevent duplicates
    this.tiktokVerificationCache = new Map();
    this.PROCESSING_TIMEOUT = 2000; // 2 seconds
    
    this.loadConfigs();
    this.loadUserStatus();
    this.setupPresenceListener();

    // Periodic check to catch missed presence updates
    setInterval(() => {
      this.periodicPresenceCheck();
    }, 15 * 60 * 1000); // Every 15 minutes
  }

  loadConfigs() {
    this.twitchConfig = configLoader.twitch;
    this.youtubeConfig = configLoader.load('youtube');
  }

  loadUserStatus() {
    try {
      if (!fs.existsSync(USER_STATUS_PATH)) return;
      const data = JSON.parse(fs.readFileSync(USER_STATUS_PATH, 'utf8'));
      this.userStatus = new Map(Object.entries(data));
    } catch (err) {
      console.error('[PresenceStreaming] Error loading user status:', err.message);
    }
  }

  saveUserStatus() {
    try {
      fs.writeFileSync(USER_STATUS_PATH, JSON.stringify(Object.fromEntries(this.userStatus), null, 2));
    } catch (err) {
      console.error('[PresenceStreaming] Error saving user status:', err.message);
    }
  }

  setupPresenceListener() {
    this.client.on('presenceUpdate', (oldPresence, newPresence) => {
      if (!newPresence || !newPresence.guild) return;
      
      const guildId = newPresence.guild.id;
      const userId = newPresence.userId;
      
      const config = guildSettings.getSettings(guildId);
      
      // Check if user has the tracking role
      this.checkUserTrackingRole(userId, guildId, config).then(hasTrackingRole => {
        if (!hasTrackingRole) return;
        
        this.handlePresenceUpdate(oldPresence, newPresence, config, guildId, userId);
      }).catch(err => {
        console.error('[PresenceStreaming] Error checking tracking role:', err.message);
      });
    });
  }

  async checkUserTrackingRole(userId, guildId, config) {
    try {
      const guild = await this.client.guilds.fetch(guildId);
      const member = await guild.members.fetch(userId).catch(() => null);
      if (!member) return false;

      const twitchTracking = config.streaming?.twitch?.trackingRoles;
      const youtubeTracking = config.streaming?.youtube?.trackingRoles;
      const tiktokTracking = config.streaming?.tiktok?.trackingRoles;

      // Check if user has ANY of the Twitch tracking roles
      if (twitchTracking && twitchTracking.length > 0) {
        for (const roleId of twitchTracking) {
          if (member.roles.cache.has(roleId)) return true;
        }
      }

      // Check if user has ANY of the YouTube tracking roles
      if (youtubeTracking && youtubeTracking.length > 0) {
        for (const roleId of youtubeTracking) {
          if (member.roles.cache.has(roleId)) return true;
        }
      }

      if (tiktokTracking && tiktokTracking.length > 0) {
        for (const roleId of tiktokTracking) {
          if (member.roles.cache.has(roleId)) return true;
        }
      }

      return false;
    } catch (err) {
      console.error('[PresenceStreaming] Error checking user role:', err.message);
      return false;
    }
  }

  async handlePresenceUpdate(oldPresence, newPresence, config, guildId, userId) {
    const presenceActivities = newPresence.activities?.filter(a => a.type === 1) || [];
    const streamingActivities = [];
    const unverifiedPlatforms = new Set();
    for (const activity of presenceActivities) {
      if (this.detectPlatform(activity) === 'tiktok') {
        const verifiedLive = await this.verifyTikTokActivity(activity);
        if (verifiedLive === null) {
          unverifiedPlatforms.add('tiktok');
          continue;
        }
        if (!verifiedLive) continue;
      }
      streamingActivities.push(activity);
    }

    const streamingPlatforms = [...new Set(streamingActivities
      .map(activity => this.detectPlatform(activity))
      .filter(platform => platform && platform !== 'unknown'))];

    const platformKeys = ['twitch', 'youtube', 'tiktok'];
    const oldStatusByPlatform = {};
    for (const platform of platformKeys) {
      const statusKey = `${userId}_${guildId}_${platform}`;
      oldStatusByPlatform[platform] = this.userStatus.get(statusKey) || { isLive: false, messageId: null };
    }

    const oldLivePlatforms = platformKeys.filter(platform => oldStatusByPlatform[platform].isLive);
    const isStateChange = streamingPlatforms.length !== oldLivePlatforms.length ||
      streamingPlatforms.some(platform => !oldLivePlatforms.includes(platform)) ||
      oldLivePlatforms.some(platform => !streamingPlatforms.includes(platform));

    if (isStateChange) {
      const processingKey = `${userId}_${guildId}`;
      if (this.processingUsers.has(processingKey)) {
        const lastProcessed = this.processingUsers.get(processingKey);
        if (Date.now() - lastProcessed < this.PROCESSING_TIMEOUT) {
          return;
        }
      }

      this.processingUsers.set(processingKey, Date.now());
      setTimeout(() => {
        this.processingUsers.delete(processingKey);
      }, this.PROCESSING_TIMEOUT);
    }

    for (const activity of streamingActivities) {
      const platform = this.detectPlatform(activity);
      if (!['twitch', 'youtube', 'tiktok'].includes(platform)) continue;

      const platformConfig = config.streaming?.[platform];
      if (!platformConfig?.enabled || platformConfig.trackingRoles?.length === 0) continue;

      const hasRole = await this.hasAnyUserRole(userId, guildId, platformConfig.trackingRoles);
      if (!hasRole) continue;

      const platformKey = `${userId}_${guildId}_${platform}`;
      const oldStatus = this.userStatus.get(platformKey) || { isLive: false, messageId: null, lastNotifiedAt: 0 };
      if (!oldStatus.isLive) {
        await this.notifyLive(newPresence, activity, platform, platformConfig, guildId, userId);
        this.userStatus.set(platformKey, {
          isLive: true,
          messageId: platformConfig.messageId,
          lastNotifiedAt: oldStatus.lastNotifiedAt || 0
        });
        platformConfig.messageId = null;
        guildSettings.updateSettings(guildId, { streaming: config.streaming });
        this.saveUserStatus();
      }
    }

    for (const platform of platformKeys) {
      const platformKey = `${userId}_${guildId}_${platform}`;
      const oldStatus = this.userStatus.get(platformKey) || { isLive: false, messageId: null };
      const isNowLive = streamingPlatforms.includes(platform);
      if (platform === 'tiktok' && unverifiedPlatforms.has(platform)) continue;
      if (oldStatus.isLive && !isNowLive) {
        await this.notifyOffline(platform, config, guildId, userId);
        this.userStatus.set(platformKey, { isLive: false, messageId: null });
        this.saveUserStatus();
      }
    }
  }

  async hasUserRole(userId, guildId, roleId) {
    try {
      const guild = await this.client.guilds.fetch(guildId);
      const member = await guild.members.fetch(userId).catch(() => null);
      if (!member) return false;
      return member.roles.cache.has(roleId);
    } catch (err) {
      console.error('[PresenceStreaming] Error checking user role:', err.message);
      return false;
    }
  }

  async hasAnyUserRole(userId, guildId, roleIds) {
    if (!roleIds || roleIds.length === 0) return false;
    try {
      const guild = await this.client.guilds.fetch(guildId);
      const member = await guild.members.fetch(userId).catch(() => null);
      if (!member) return false;
      for (const roleId of roleIds) {
        if (member.roles.cache.has(roleId)) return true;
      }
      return false;
    } catch (err) {
      console.error('[PresenceStreaming] Error checking user roles:', err.message);
      return false;
    }
  }

  detectPlatform(activity) {
    if (!activity) return null;
    
    const url = (activity.url || '').toString().toLowerCase();
    if (url.includes('twitch.tv')) return 'twitch';
    if (url.includes('youtube.com') || url.includes('youtu.be')) return 'youtube';
    if (url.includes('tiktok.com')) return 'tiktok';
    
    const fields = [
      activity.name,
      activity.details,
      activity.state
    ].filter(Boolean).map(value => value.toString().toLowerCase());

    for (const text of fields) {
      if (text.includes('twitch')) return 'twitch';
      if (text.includes('youtube')) return 'youtube';
      if (text.includes('tiktok')) return 'tiktok';
    }

    return 'unknown';
  }

  async verifyTikTokActivity(activity) {
    let activityUrl;
    try {
      activityUrl = new URL(activity?.url);
    } catch {
      return null;
    }

    if (!/(^|\.)tiktok\.com$/i.test(activityUrl.hostname)) return null;
    const username = activityUrl.pathname.match(/^\/@([^/]+)/)?.[1];
    const tiktokBot = this.client.tiktokStreamBot;
    if (!username || !tiktokBot?.checkLiveStatus) return null;

    const cacheKey = username.toLowerCase();
    const cached = this.tiktokVerificationCache.get(cacheKey);
    if (cached && Date.now() - cached.checkedAt < 60_000) return cached.isLive;

    const status = await tiktokBot.checkLiveStatus(username);
    if (!status) return null;

    const isLive = status.isLive === true;
    this.tiktokVerificationCache.set(cacheKey, { isLive, checkedAt: Date.now() });
    return isLive;
  }

  getPlatformColor(platform) {
    switch (platform) {
      case 'twitch': return '#9146FF';
      case 'youtube': return '#FF0000';
      case 'tiktok': return '#00F2EA';
      default: return '#00AAFF';
    }
  }

  getPlatformName(platform) {
    switch (platform) {
      case 'twitch': return 'Twitch';
      case 'youtube': return 'YouTube';
      case 'tiktok': return 'TikTok';
      default: return 'Streaming';
    }
  }

  async getTwitchUserData(username) {
    if (!this.twitchConfig) return null;

    try {
      // Get access token
      const tokenResponse = await axios.post('https://id.twitch.tv/oauth2/token', null, {
        params: {
          client_id: this.twitchConfig.twitch_client_id,
          client_secret: this.twitchConfig.twitch_client_secret,
          grant_type: 'client_credentials'
        }
      });

      const accessToken = tokenResponse.data.access_token;

      // Get user data
      const userResponse = await axios.get('https://api.twitch.tv/helix/users', {
        params: { login: username },
        headers: {
          'Client-ID': this.twitchConfig.twitch_client_id,
          'Authorization': `Bearer ${accessToken}`
        }
      });

      if (userResponse.data.data.length > 0) {
        const user = userResponse.data.data[0];
        return {
          name: user.display_name,
          username: user.login,
          avatar: user.profile_image_url
        };
      }
    } catch (err) {
      console.error('[PresenceStreaming] Error fetching Twitch user data:', err.message);
    }
    return null;
  }

  async getYouTubeStreamData(videoId) {
    if (!this.youtubeConfig) return null;

    try {
      const response = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
        params: {
          part: 'snippet',
          id: videoId,
          key: this.youtubeConfig.youtube_api_key
        }
      });

      if (response.data.items?.length > 0) {
        const video = response.data.items[0];
        return {
          title: video.snippet.title,
          channelTitle: video.snippet.channelTitle,
          thumbnail: video.snippet.thumbnails?.high?.url || video.snippet.thumbnails?.default?.url
        };
      }
    } catch (err) {
      console.error('[PresenceStreaming] Error fetching YouTube stream data:', err.message);
    }
    return null;
  }

  async notifyLive(presence, activity, platform, platformConfig, guildId, userId) {
    try {
      const statusKey = `${userId}_${guildId}_${platform}`;
      const status = this.userStatus.get(statusKey) || { isLive: false, messageId: null, lastNotifiedAt: 0 };
      const cooldownMs = (platformConfig.cooldown || 0) * 1000;
      const sinceLast = Date.now() - (status.lastNotifiedAt || 0);
      if (cooldownMs > 0 && sinceLast < cooldownMs) {
        if (platformConfig.liveRoles && platformConfig.liveRoles.length > 0) {
          await this.assignLiveRoles(guildId, userId, platformConfig.liveRoles, platform);
        }
        this.userStatus.set(statusKey, {
          isLive: true,
          messageId: status.messageId || null,
          lastNotifiedAt: status.lastNotifiedAt || 0
        });
        this.saveUserStatus();
        return false;
      }

      const channel = await this.client.channels.fetch(platformConfig.channelId);
      if (!channel?.isTextBased()) {
        return;
      }

      const user = presence.user;
      const streamURL = activity.url || (platform === 'tiktok' ? 'https://www.tiktok.com/' : '');
      const title = activity.details || 'Streaming now';
      const game = activity.state || activity.name || 'Unknown';
      
      let streamerName = user.displayName;
      let streamerAvatar = user.displayAvatarURL({ size: 256 });
      let thumbnail = activity.assets?.largeImageURL({ size: 512 }) || null;

      // Fetch platform-specific data
      if (platform === 'twitch') {
        const urlMatch = streamURL.match(/twitch\.tv\/([^\/]+)/);
        if (urlMatch) {
          const twitchData = await this.getTwitchUserData(urlMatch[1]);
          if (twitchData) {
            streamerName = twitchData.name;
            streamerAvatar = twitchData.avatar;
          }
        }
      } else if (platform === 'youtube') {
        const urlMatch = streamURL.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\s]+)/);
        if (urlMatch) {
          const youtubeData = await this.getYouTubeStreamData(urlMatch[1]);
          if (youtubeData) {
            streamerName = youtubeData.channelTitle;
            thumbnail = youtubeData.thumbnail;
          }
        }
      }

      const embed = new EmbedBuilder()
        .setTitle(title || `${streamerName} is now broadcasting on ${this.getPlatformName(platform)}!`)
        .setURL(streamURL)
        .setColor(this.getPlatformColor(platform));

      if (platform === 'twitch' && streamerAvatar) {
        embed.setAuthor({ name: `${streamerName} is now broadcasting on Twitch!`, iconURL: streamerAvatar, url: streamURL });
      } else if (platform === 'youtube') {
        embed.setAuthor({ name: `${streamerName} is now broadcasting on YouTube!`, url: streamURL });
      } else if (platform === 'tiktok') {
        embed.setAuthor({ name: `${streamerName} is now broadcasting on TikTok!`, url: streamURL });
      }

      if (game) embed.setDescription(`**Activity:** ${game}`);
      if (thumbnail) embed.setImage(thumbnail);

      let content = '';
      if (platformConfig.customMessage) {
        content = platformConfig.customMessage
          .replace(/\{streamer\}/g, streamerName)
          .replace(/\{url\}/g, streamURL)
          .replace(/\{platform\}/g, this.getPlatformName(platform))
          .replace(/\{title\}/g, title)
          .replace(/\{game\}/g, game);
      }

      const msg = await channel.send({ content: content || undefined, embeds: [embed] });

      if (platformConfig.cleanup) {
        platformConfig.messageId = msg.id;
        guildSettings.updateSettings(guildId, { streaming: { [platform]: platformConfig } });
      }

      if (platformConfig.liveRoles && platformConfig.liveRoles.length > 0) {
        try {
          const guild = await this.client.guilds.fetch(guildId);
          const member = await guild.members.fetch(userId).catch(() => null);
          if (member) {
            for (const roleId of platformConfig.liveRoles) {
              const role = await guild.roles.fetch(roleId).catch(() => null);
              if (role) {
                try {
                  await member.roles.add(role, `User went live on ${this.getPlatformName(platform)}`);
                } catch (roleErr) {
                  console.error(`[PresenceStreaming] Failed to assign role ${role.name} to ${member.displayName}:`, roleErr.message);
                }
              } else {
                console.error(`[PresenceStreaming] Could not fetch role ${roleId} for ${platform}`);
              }
            }
          } else {
            console.warn(`[PresenceStreaming] Could not fetch member ${userId} for live role assignment`);
          }
        } catch (err) {
          console.error('[PresenceStreaming] Error assigning live roles:', err.message);
        }
      }

    } catch (err) {
      console.error('[PresenceStreaming] Error sending live notification:', err.message);
    }
  }

  async notifyOffline(platform, config, guildId, userId) {
    try {
      const statusKey = `${userId}_${guildId}_${platform}`;
      const platformConfig = platform === 'twitch' ? config.streaming?.twitch : platform === 'youtube' ? config.streaming?.youtube : config.streaming?.tiktok;
      if (!platformConfig) return;

      const status = this.userStatus.get(statusKey);
      if (!status) return;

      if (platformConfig.cleanup && status.messageId) {
        const channel = await this.client.channels.fetch(platformConfig.channelId);
        if (channel?.isTextBased()) {
          const msg = await channel.messages.fetch(status.messageId).catch(() => null);
          if (msg) await msg.delete();
        }
      }

      if (platformConfig.liveRoles && platformConfig.liveRoles.length > 0) {
        try {
          const guild = await this.client.guilds.fetch(guildId);
          const member = await guild.members.fetch(userId).catch(() => null);
          if (member) {
            for (const roleId of platformConfig.liveRoles) {
              const role = await guild.roles.fetch(roleId).catch(() => null);
              if (role) {
                try {
                  await member.roles.remove(role, 'User went offline');
                } catch (roleErr) {
                  console.error(`[PresenceStreaming] Failed to remove role ${role.name} from ${member.displayName}:`, roleErr.message);
                }
              }
            }
          }
        } catch (err) {
          console.error('[PresenceStreaming] Error removing live roles:', err.message);
        }
      }

      this.userStatus.set(statusKey, { isLive: false, messageId: null });
      this.saveUserStatus();
    } catch (err) {
      console.error('[PresenceStreaming] Error sending offline notification:', err.message);
    }
  }

  async assignLiveRoles(guildId, userId, liveRoles, platform) {
    try {
      const guild = await this.client.guilds.fetch(guildId);
      const member = await guild.members.fetch(userId).catch(() => null);
      if (!member) return;

      for (const roleId of liveRoles) {
        const role = await guild.roles.fetch(roleId).catch(() => null);
        if (!role) continue;
        try {
          await member.roles.add(role, `User went live on ${this.getPlatformName(platform)}`);
        } catch (roleErr) {
          console.error(`[PresenceStreaming] Failed to assign role ${role.name} to ${member.displayName}:`, roleErr.message);
        }
      }
    } catch (err) {
      console.error('[PresenceStreaming] Error assigning presence live roles:', err.message);
    }
  }

  setGuildConfig(guildId, config) {
    guildSettings.updateSettings(guildId, { streaming: config });
  }

  getGuildConfig(guildId) {
    const settings = guildSettings.getSettings(guildId);
    return settings?.streaming || null;
  }

  deleteGuildConfig(guildId) {
    const settings = guildSettings.getSettings(guildId);
    if (settings?.streaming) {
      settings.streaming = {
        twitch: { enabled: false, trackingRole: null, liveRole: null, channelId: null, customMessage: '', cleanup: false },
        youtube: { enabled: false, trackingRole: null, liveRole: null, channelId: null, customMessage: '', cleanup: false },
        tiktok: { enabled: false, trackingRole: null, liveRole: null, channelId: null, customMessage: '', cleanup: false }
      };
      guildSettings.updateSettings(guildId, { streaming: settings.streaming });
    }
  }

  async periodicPresenceCheck() {
    try {
      for (const guild of this.client.guilds.cache.values()) {
        const config = guildSettings.getSettings(guild.id);
        if (!config?.streaming) continue;

        // Check Twitch
        if (config.streaming.twitch?.enabled && config.streaming.twitch.trackingRoles?.length > 0) {
          await this.checkPlatformPresence(guild, config.streaming.twitch, 'twitch');
        }

        // Check YouTube
        if (config.streaming.youtube?.enabled && config.streaming.youtube.trackingRoles?.length > 0) {
          await this.checkPlatformPresence(guild, config.streaming.youtube, 'youtube');
        }

        if (config.streaming.tiktok?.enabled && config.streaming.tiktok.trackingRoles?.length > 0) {
          await this.checkPlatformPresence(guild, config.streaming.tiktok, 'tiktok');
        }
      }
    } catch (err) {
      console.error('[PresenceStreaming] Error in periodic check:', err.message);
    }
  }

  async checkPlatformPresence(guild, platformConfig, platform) {
    const trackingRoles = platformConfig.trackingRoles || [];
    const liveRoles = platformConfig.liveRoles || [];

    for (const roleId of trackingRoles) {
      const role = await guild.roles.fetch(roleId).catch(() => null);
      if (!role) continue;

      for (const member of role.members.values()) {
        let activity = member.presence?.activities?.filter(a => a.type === 1).find(a => this.detectPlatform(a) === platform);
        if (platform === 'tiktok' && activity) {
          const verifiedLive = await this.verifyTikTokActivity(activity);
          if (verifiedLive === null) continue;
          if (!verifiedLive) activity = null;
        }
        const detectedPlatform = activity ? this.detectPlatform(activity) : null;
        const hasLiveRole = liveRoles.some(lr => member.roles.cache.has(lr));
        const userId = member.id;
        const statusKey = `${userId}_${guild.id}_${platform}`;
        const oldStatus = this.userStatus.get(statusKey) || { isLive: false, messageId: null };

        if (activity && detectedPlatform === platform) {
          // User is streaming on the correct platform
          // Assign live role if missing
          if (!hasLiveRole && liveRoles.length > 0) {
            try {
              for (const liveRoleId of liveRoles) {
                const liveRole = await guild.roles.fetch(liveRoleId).catch(() => null);
                if (liveRole) {
                  try {
                    await member.roles.add(liveRole, `Periodic check - user went live on ${this.getPlatformName(platform)}`);
                  } catch (roleErr) {
                    console.error(`[PresenceStreaming] Periodic check: Failed to assign role ${liveRole.name} to ${member.displayName}:`, roleErr.message);
                  }
                }
              }
            } catch (roleErr) {
              console.error(`[PresenceStreaming] Periodic check: Failed to assign role to ${member.displayName}:`, roleErr.message);
            }
          }
          
          // Send notification if not already marked as live
          if (!oldStatus.isLive) {
            try {
              await this.notifyLive(member.presence, activity, platform, platformConfig, guild.id, userId);
              this.userStatus.set(statusKey, { isLive: true, messageId: platformConfig.messageId });
              platformConfig.messageId = null;
              guildSettings.updateSettings(guild.id, { streaming: { [platform]: platformConfig } });
              this.saveUserStatus();
            } catch (notifyErr) {
              console.error(`[PresenceStreaming] Periodic check: Failed to send notification for ${member.displayName}:`, notifyErr.message);
            }
          }
        } else if (oldStatus.isLive && (platform === 'tiktok' || hasLiveRole)) {
          if (platform === 'tiktok') {
            await this.notifyOffline(platform, { streaming: { [platform]: platformConfig } }, guild.id, userId);
            continue;
          }

          // User has live role but is not streaming on the platform they were previously streaming on
          // Remove the live role
          try {
            for (const liveRoleId of liveRoles) {
              const liveRole = await guild.roles.fetch(liveRoleId).catch(() => null);
              if (liveRole && member.roles.cache.has(liveRoleId)) {
                try {
                  await member.roles.remove(liveRole, 'Periodic check - user went offline');
                } catch (roleErr) {
                  console.error(`[PresenceStreaming] Periodic check: Failed to remove role ${liveRole.name} from ${member.displayName}:`, roleErr.message);
                }
              }
            }
            // Update status regardless of whether removal succeeded so the module doesn't keep treating them as live.
            this.userStatus.set(statusKey, { isLive: false, messageId: null });
            this.saveUserStatus();
          } catch (roleErr) {
            console.error(`[PresenceStreaming] Periodic check: Failed to remove role from ${member.displayName}:`, roleErr.message);
          }
        }
      }
    }
  }
}

module.exports = PresenceStreaming;