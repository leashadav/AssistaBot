const { PermissionsBitField } = require('discord.js');

// Platform-agnostic command processor
class CommandProcessor {
  constructor() {
    this.platformHandlers = {};
  }

  // Process a command response template, replacing variables based on platform context
  async processResponse(response, context) {
    const { platform, ...platformContext } = context;
    const handler = this.platformHandlers[platform];
    if (!handler) {
      throw new Error(`Unsupported platform: ${platform}`);
    }
    return handler.processResponse(response, platformContext);
  }

  // Check if a user has permission to use a command
  async checkPermission(command, context) {
    const { platform, ...platformContext } = context;
    const handler = this.platformHandlers[platform];
    if (!handler) {
      return false;
    }
    return handler.checkPermission(command, platformContext);
  }

  // Register a platform handler
  registerPlatform(platform, handler) {
    this.platformHandlers[platform] = handler;
  }
}

// Discord-specific handler
class DiscordHandler {
  async processResponse(response, context) {
    const { message, targetUser, args = [] } = context;
    if (!message) return response;

    // Basic Discord placeholders
    let resp = response
      .replace(/<@\{id\}>/g, `<@${message.author.id}>`)
      .replace(/{user}/g, message.author.username)
      .replace(/{username}/g, message.author.username)
      .replace(/{tag}/g, message.author.tag)
      .replace(/{id}/g, message.author.id)
      .replace(/{channel}/g, `#${message.channel.name}`)
      .replace(/{server}/g, message.guild?.name || '')
      .replace(/{args}/g, args.join(' '));

    // Target user placeholders
    resp = resp
      .replace(/{touser:([^}]+)}/g, (m, def) => targetUser ? targetUser.username : def)
      .replace(/{touser}/g, targetUser ? targetUser.username : message.author.username)
      .replace(/{tousername}/g, targetUser ? targetUser.username : message.author.username)
      .replace(/{tousertag}/g, targetUser ? targetUser.tag : message.author.tag)
      .replace(/{touserid}/g, targetUser ? targetUser.id : message.author.id);

    return resp;
  }

  async checkPermission(command, context) {
    const { message } = context;
    if (!message?.member) return false;

    // Check required Discord permission
    if (command.requiredPermission) {
      const flag = PermissionsBitField.Flags[command.requiredPermission];
      if (flag && !message.member.permissions.has(flag)) {
        return false;
      }
    }

    // Check allowed roles
    if (command.allowedRoles?.length > 0) {
      const hasRole = command.allowedRoles.some(rid => message.member.roles.cache.has(rid));
      if (!hasRole) return false;
    }

    return true;
  }
}

// Twitch-specific handler
class TwitchHandler {
  async processResponse(response, context) {
    const { message, targetUser, args = [], channel } = context;
    if (!message) return response;

    // Basic Twitch placeholders
    let resp = response
      .replace(/{user}/g, message.username)
      .replace(/{username}/g, message.username)
      .replace(/{channel}/g, channel)
      .replace(/{args}/g, args.join(' '))
      .replace(/{color}/g, message.color || '')
      .replace(/{subscriber}/g, message.subscriber ? 'Yes' : 'No')
      .replace(/{mod}/g, message.mod ? 'Yes' : 'No')
      .replace(/{vip}/g, message.vip ? 'Yes' : 'No')
      .replace(/{badges}/g, Object.keys(message.badges || {}).join(','))
      .replace(/{user-id}/g, message.userId)
      .replace(/{message-id}/g, message.id)
      .replace(/{months}/g, message.subscriberMonths || '0');

    // Target user placeholders - simplified for Twitch
    resp = resp
      .replace(/{touser:([^}]+)}/g, (m, def) => targetUser || def)
      .replace(/{touser}/g, targetUser || message.username);

    return resp;
  }

  async checkPermission(command, context) {
    const { message } = context;
    if (!message) return false;

    // Map Discord permissions to Twitch roles
    if (command.requiredPermission) {
      const perm = command.requiredPermission.toLowerCase();
      const isBroadcaster = message.badges?.broadcaster === '1';
      const isMod = message.mod;

      switch (perm) {
        case 'administrator':
        case 'manageguild':
          return isBroadcaster || isMod;
        case 'moderator':
          return isMod;
        case 'vip':
          return message.vip || isMod || isBroadcaster;
        case 'subscriber':
          return message.subscriber || isMod || isBroadcaster;
        default:
          return false;
      }
    }

    return true;
  }
}

// Create and configure the processor
const processor = new CommandProcessor();
processor.registerPlatform('discord', new DiscordHandler());
processor.registerPlatform('twitch', new TwitchHandler());

module.exports = processor;