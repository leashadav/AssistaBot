const { ActivityType } = require('discord.js');
const { buildStreamEmbed } = require('./streamEmbeds');
const configLoader = require('./configLoader');
const registry = require('./streamRegistry');
// Using console for logging since the logger module doesn't export error method
const logger = {
  error: (...args) => console.error(...args),
  warn: (...args) => console.warn(...args)
};

/**
 * Validates the activity data structure
 * @param {Object} activity - The activity data to validate
 * @returns {{valid: boolean, error?: string}} Validation result
 */
function validateActivity(activity) {
  if (!activity || typeof activity !== 'object') {
    return { valid: false, error: 'Activity must be an object' };
  }
  
  // If it's a standard Discord activity, it's valid
  if (activity.type !== undefined && activity.name) {
    return { valid: true };
  }

  // Required fields
  if (!activity.type) {
    return { valid: false, error: 'Activity must have a type' };
  }

  // Validate URL if present
  if (activity.url && typeof activity.url !== 'string') {
    return { valid: false, error: 'URL must be a string if provided' };
  }

  // Validate name if present
  if (activity.name && typeof activity.name !== 'string') {
    return { valid: false, error: 'Name must be a string if provided' };
  }

  return { valid: true };
}

class PresenceStreamNotifier {
  constructor() {
    this.interval = null;
    this.state = new Map(); // key -> { status: 'live'|'offline', lastPostAt: ms }
    this.presenceCache = new Map(); // userId -> { activities: [], lastUpdate: timestamp }
    this.defaultCooldownMinutes = configLoader.config.defaultCooldownMinutes || 30;
  }

  async start(client, periodMs = configLoader.config.presenceCheckInterval || 60000) {
    if (this.interval) clearInterval(this.interval);
    
    // Set up presence update listener
    client.on('presenceUpdate', (oldPresence, newPresence) => {
      this.handlePresenceUpdate(client, oldPresence, newPresence).catch(error => {
        logger.error('Error in presenceUpdate handler:', error);
      });
    });

    // Wait for the client to be fully ready
    await new Promise(resolve => {
      if (client.isReady()) return resolve();
      client.once('ready', resolve);
    });

    // Initial check and periodic scan
    const tick = async () => {
      try {
        await this.scanAllGuilds(client);
      } catch (error) {
        logger.error('Presence Stream Notifier error:', error);
      }
    };
    
    await tick();
    this.interval = setInterval(tick, periodMs);
  }

  stop() {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
  }

  async scanAllGuilds(client) {
    const guilds = await client.guilds.fetch();
    for (const [guildId, guild] of guilds) {
      try {
        const fullGuild = await guild.fetch();
        await this.checkGuildPresences(client, fullGuild);
      } catch (error) {
        logger.error(`Error scanning guild ${guildId}:`, error);
      }
    }
  }

  async checkGuildPresences(client, guild) {
    const guildId = guild.id;
    const presenceRules = registry.getPresence(guildId);
    if (!presenceRules) return;

    try {
      const members = await guild.members.fetch();
      
      for (const [_, member] of members) {
        if (!member.presence || !member.presence.activities.length) continue;
        
        for (const activity of member.presence.activities) {
          await this.checkActivity(client, guild, member, activity, presenceRules);
        }
      }
    } catch (error) {
      logger.error(`Error checking presences in guild ${guildId}:`, error);
    }
  }

  async handlePresenceUpdate(client, oldPresence, newPresence) {
    if (!newPresence || !newPresence.guild) return;
    
    const guild = newPresence.guild;
    const presenceRules = registry.getPresence(guild.id);
    if (!presenceRules) return;

    const member = newPresence.member;
    if (!member) return;

    // Get old activities (if any)
    const oldActivities = oldPresence?.activities || [];
    const newActivities = newPresence.activities || [];

    // Check for new streaming activities
    for (const activity of newActivities) {
      if (!oldActivities.some(a => a.name === activity.name && a.type === activity.type)) {
        await this.checkActivity(client, guild, member, activity, presenceRules);
      }
    }
  }

  async checkActivity(client, guild, member, activity, presenceRules) {
    // Debug mode - set to true to enable detailed logging
    const debug = false;
    
    if (debug && activity) {
      console.log('Activity detected:', {
        userId: member?.id,
        username: member?.user?.tag,
        activity: {
          name: activity.name,
          type: ActivityType[activity.type],
          state: activity.state,
          details: activity.details,
          url: activity.url,
          applicationId: activity.applicationId
        },
        timestamp: new Date().toISOString()
      });
    }

    // Validate input parameters
    if (!client || !guild || !member || !activity || !presenceRules) {
      if (debug) logger.warn('Invalid parameters passed to checkActivity');
      return;
    }

    const validation = validateActivity(activity);
    if (!validation.valid) {
      if (debug) logger.warn(`Invalid activity data: ${validation.error}`);
      return;
    }

    const platform = this.getPlatformFromActivity(activity) || 'discord'; // Default to discord for screen sharing
    if (!presenceRules[platform]) {
      if (debug) console.log(`No rules found for platform: ${platform}`);
      return;
    }

    const rule = presenceRules[platform];
    if (!rule) {
      if (debug) console.log(`No rule found for platform: ${platform}`);
      return;
    }

    const isStreaming = this.isStreamingActivity(activity);
    if (debug) console.log(`Streaming status for ${member.user.tag}: ${isStreaming ? 'LIVE' : 'offline'} (${activity.name})`);
    
    const stateKey = this.getStateKey(guild.id, platform, member.id);
    const currentState = this.state.get(stateKey);
    const now = Date.now();

    // Check cooldown
    const cooldownMs = (rule.cooldownMinutes || this.defaultCooldownMinutes) * 60 * 1000;
    if (currentState?.lastPostAt && (now - currentState.lastPostAt) < cooldownMs) {
      return;
    }

    // Check if status changed
    if (currentState?.status === (isStreaming ? 'live' : 'offline')) {
      return;
    }

    // Update state
    this.state.set(stateKey, {
      status: isStreaming ? 'live' : 'offline',
      lastPostAt: now
    });

    // Only notify when going live
    if (isStreaming) {
      await this.notifyStreamLive(client, guild, member, activity, rule);
    }
  }

  isStreamingActivity(activity) {
    if (!activity) return false;
    
    // Only log if in debug mode
    const debug = false; // Set to true to enable detailed logging
    
    if (debug) {
      console.log('Checking activity:', {
        name: activity.name,
        type: ActivityType[activity.type],
        state: activity.state?.substring(0, 30) + (activity.state?.length > 30 ? '...' : '')
      });
    }
    
    // Check for standard streaming activities
    if (activity.type === ActivityType.Streaming) {
      if (debug) console.log('Detected standard streaming activity');
      return true;
    }
    
    // Check for Discord screen sharing
    if (activity.type === ActivityType.Custom || activity.type === undefined) {
      const content = [
        activity.name?.toLowerCase() || '',
        activity.state?.toLowerCase() || '',
        activity.details?.toLowerCase() || ''
      ].join(' ');
      
      const isScreenSharing = [
        'screen', 'sharing', 'share screen', 'screen share',
        'screenshare', 'screen sharing', 'broadcasting'
      ].some(term => content.includes(term));
      
      if (isScreenSharing) {
        if (debug) console.log('Screen sharing detected');
        return true;
      }
    }
    
    // Check for playing activities that mention streaming
    if (activity.type === ActivityType.Playing) {
      const content = [
        activity.name?.toLowerCase() || '',
        activity.details?.toLowerCase() || '',
        activity.state?.toLowerCase() || ''
      ].join(' ');
      
      if (['stream', 'live', 'broadcast'].some(term => content.includes(term))) {
        if (debug) console.log('Streaming activity detected');
        return true;
      }
    }
    
    if (debug) console.log('No streaming activity detected');
    return false;
  }

  getPlatformFromActivity(activity) {
    if (!activity) return 'discord';
    
    // Check for screen sharing or Discord-specific activities
    if (activity.type === ActivityType.Custom || activity.type === undefined) {
      const content = [
        activity.name?.toLowerCase() || '',
        activity.state?.toLowerCase() || '',
        activity.details?.toLowerCase() || ''
      ].join(' ');
      
      const isScreenSharing = [
        'screen', 'sharing', 'share screen', 'screen share',
        'screenshare', 'screen sharing', 'broadcasting'
      ].some(term => content.includes(term));
      
      if (isScreenSharing) {
        return 'discord';
      }
    }
    
    const url = String(activity.url || '').toLowerCase();
    const name = String(activity.name || '').toLowerCase();
    const details = String(activity.details || '').toLowerCase();
    const state = String(activity.state || '').toLowerCase();
    
    // Check for Kick streams
    if (url.includes('kick.com') || 
        name.includes('kick') || 
        details.includes('kick') || 
        state.includes('kick') ||
        (activity.assets && 
         (String(activity.assets.largeText || '').toLowerCase().includes('kick') ||
          String(activity.assets.smallText || '').toLowerCase().includes('kick')))) {
      return 'kick';
    }
    
    if (url.includes('twitch.tv') || name.includes('twitch') || details.includes('twitch') || state.includes('twitch')) return 'twitch';
    if (url.includes('youtube.com') || url.includes('youtu.be') || name.includes('youtube') || details.includes('youtube') || state.includes('youtube')) return 'youtube';
    if (url.includes('tiktok.com') || name.includes('tiktok')) return 'tiktok';
    if (url.includes('rumble.com') || name.includes('rumble')) return 'rumble';
    if (url.includes('facebook.com') || name.includes('facebook') || name.includes('fb.gg')) return 'facebook';
    if (url.includes('x.com') || url.includes('twitter.com') || name.includes('twitter') || name.includes('x ')) return 'x';
    if (url.includes('instagram.com') || name.includes('instagram')) return 'instagram';
    if (name.includes('discord') || name.includes('stage') || name.includes('voice')) return 'discord';
    
    return null;
  }

  async notifyStreamLive(client, guild, member, activity, rule) {
    if (!rule.channelId) {
      logger.warn('No channel ID specified in rule');
      return;
    }

    const channel = await client.channels.fetch(rule.channelId).catch(error => {
      logger.error(`Error fetching channel ${rule.channelId}:`, error);
      return null;
    });
    
    if (!channel) {
      logger.warn(`Channel ${rule.channelId} not found`);
      return;
    }

    const platform = this.getPlatformFromActivity(activity);
    const streamData = {
      username: member.displayName,
      platform: platform,
      title: activity.details || 'Streaming',
      url: activity.url || '',
      avatarUrl: member.user.displayAvatarURL({ dynamic: true, size: 1024 }),
      game: activity.state || 'Just Chatting',
      // Handle both function and string cases for image URL
      imageUrl: typeof activity.assets?.largeImageURL === 'function' 
        ? activity.assets.largeImageURL({ format: 'png', size: 1024 })
        : activity.assets?.largeImage,
      viewers: 0,
      startedAt: new Date(),
      isLive: true
    };
    
    // Fallback to user avatar if no valid image URL
    if (!streamData.imageUrl) {
      streamData.imageUrl = streamData.avatarUrl;
    }

    const embed = buildStreamEmbed(streamData);
    // Format the message with placeholders
    const formatMessage = (template, data) => {
      return template
        .replace(/{name}/g, data.name)
        .replace(/{url}/g, data.url)
        .replace(/{platform}/g, data.platform)
        .replace(/{user}/g, member.toString())
        .replace(/{game}/g, data.game || 'streaming');
    };

    const content = rule.message ? 
      formatMessage(rule.message, {
        name: member.displayName,
        url: streamData.url,
        platform: streamData.platform,
        game: streamData.game
      }) : 
      `${member} is now streaming ${streamData.game}!`;

    try {
      // Send the notification message
      await channel.send({ 
        content,
        embeds: [embed],
        allowedMentions: { parse: ['users', 'roles'] }
      });
      
      // Assign live roles if configured
      if (rule.liveRoleIds?.length) {
        try {
          const rolesToAdd = rule.liveRoleIds
            .map(roleId => guild.roles.cache.get(roleId))
            .filter(role => role);
            
          if (rolesToAdd.length > 0) {
            await member.roles.add(rolesToAdd, 'Streaming live role assignment');
            // Live role assignment successful
          }
        } catch (roleError) {
          logger.error(`Error assigning live roles to ${member.user.tag}:`, roleError);
        }
      }
    } catch (error) {
      logger.error('Error sending presence notification:', error);
    }
  }

  getStateKey(guildId, platform, userId) {
    return `${guildId}:presence:${platform}:${userId}`.toLowerCase();
  }
}

module.exports = new PresenceStreamNotifier();