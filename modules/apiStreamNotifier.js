const { buildStreamEmbed } = require('./streamEmbeds');
const configLoader = require('./configLoader');
const registry = require('./streamRegistry');
const logger = require('./logger');

class ApiStreamNotifier {
  constructor() {
    this.interval = null;
    this.state = new Map(); // key -> { status: 'live'|'offline', lastPostAt: ms }
    this.cache = {
      twitch: {
        token: null,
        tokenExpiry: 0,
        userCache: new Map(), // login -> { userData, exp }
        streamCache: new Map(), // login -> { isLive, data, exp }
      },
      youtube: {
        handleCache: new Map(), // handle/@name -> channelId
        channelCache: new Map(), // channelId -> { avatar, title, exp }
        liveCache: new Map(), // channelId -> { isLive, data, exp }
        vodCache: new Map(), // channelId -> { latestVideo, exp }
      },
      // Other platform caches can be added here
    };
    this.defaultCooldownMinutes = configLoader.config.defaultCooldownMinutes || 30;
    this.quotaExceededUntil = 0;
  }

  async start(client, periodMs = configLoader.config.periodMs || 180000) {
    if (this.interval) clearInterval(this.interval);
    const tick = async () => {
      try {
        await this.checkPlatforms(client);
      } catch (error) {
        logger.error('API Stream Notifier error:', error);
      }
    };
    await tick();
    this.interval = setInterval(tick, periodMs);
  }

  stop() {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
  }

  async checkPlatforms(client) {
    if (Date.now() < this.quotaExceededUntil) return;

    try {
      const guilds = await client.guilds.fetch();
      for (const [guildId, guild] of guilds) {
        try {
          const fullGuild = await guild.fetch();
          const entries = registry.list(guildId);
          
          for (const entry of entries) {
            try {
              switch (entry.platform) {
                case 'twitch':
                  await this.checkTwitchStream(client, fullGuild, entry);
                  break;
                case 'youtube':
                  await this.checkYouTubeStream(client, fullGuild, entry);
                  break;
                // Add other platforms as needed
              }
            } catch (error) {
              logger.error(`Error checking ${entry.platform} stream for ${entry.name}:`, error);
            }
          }
        } catch (error) {
          logger.error(`Error processing guild ${guildId}:`, error);
        }
      }
    } catch (error) {
      logger.error('Error in checkPlatforms:', error);
    }
  }

  async checkTwitchStream(client, guild, entry) {
    // Implementation for checking Twitch streams via API
    // Similar to the existing checkTwitch method but focused on API checks
  }

  async checkYouTubeStream(client, guild, entry) {
    // Implementation for checking YouTube streams via API
    // Similar to the existing checkYouTube method but focused on API checks
  }

  // Helper methods for API interactions, caching, etc.
  async getTwitchAuth() {
    // Get or refresh Twitch auth token
  }

  async fetchTwitchUser(login, auth) {
    // Fetch Twitch user data with caching
  }

  async fetchTwitchStream(login, auth) {
    // Fetch Twitch stream status with caching
  }

  async resolveYouTubeChannel(identifier, apiKey) {
    // Resolve YouTube channel ID from various inputs
  }

  async fetchYouTubeChannelInfo(channelId, apiKey) {
    // Fetch YouTube channel info with caching
  }

  async fetchYouTubeLiveStatus(channelId, apiKey) {
    // Check if a YouTube channel is live
  }

  async notifyStreamLive(client, guild, entry, streamData) {
    // Handle stream live notification
    const channel = await client.channels.fetch(entry.channelId);
    if (!channel) return;

    const embed = buildStreamEmbed(streamData);
    const content = entry.message || `${streamData.username} is now live!`;
    
    try {
      await channel.send({ 
        content,
        embeds: [embed],
        allowedMentions: { parse: ['users', 'roles'] }
      });
      this.updateState(guild.id, entry.platform, entry.name, 'live');
    } catch (error) {
      logger.error(`Error sending notification:`, error);
    }
  }

  updateState(guildId, platform, streamerId, status) {
    const key = this.getStateKey(guildId, platform, streamerId);
    this.state.set(key, { 
      status, 
      lastUpdate: Date.now() 
    });
  }

  getStateKey(guildId, platform, streamerId) {
    return `${guildId}:${platform}:${streamerId}`.toLowerCase();
  }
}

module.exports = new ApiStreamNotifier();
