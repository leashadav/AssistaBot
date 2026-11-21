const { EmbedBuilder, AuditLogEvent, Routes } = require('discord.js');

// Load config for optional embed defaults (author/footer/name)
const configLoader = require('./configLoader');
const config = configLoader.config;
const guildSettings = require('./guildSettings');
const DEBUG = /^(1|true)$/i.test(String(process.env.ASSISTABOT_DEBUG || ''));

// Create a log embed with the given title and description
function createLogEmbed(title, description, color = 0xff6600, imageUrl = null, footerText = null) {
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description)

  // Attach an author if configured; accept either an object or a simple botName
  if (config.logAuthor && typeof config.logAuthor === 'object') {
    // config.logAuthor should be an object like { name, iconURL, url }
    embed.setAuthor(config.logAuthor);
  } else if (config.botName) {
    embed.setAuthor({ name: config.botName });
  }

  // Attach a footer if configured; prefer full object or fallback to footerText
  if (footerText) {
    embed.setFooter({ text: footerText });
  } else if (config.logFooter && typeof config.logFooter === 'object') {
    // config.logFooter should be an object like { text, iconURL }
    embed.setFooter(config.logFooter);
  } else if (config.footerText) {
    embed.setFooter({ text: config.footerText });
  }

  if (imageUrl) {
    embed.setImage(imageUrl);
  }

  return embed;
}

// Send log to a specific channel for a given guild
async function sendLog(client, guildId, type, content, imageUrl = null, footerText = null, customTitle = null) {
  if (!guildId) return;
  const channelId = guildSettings.getLogChannel(guildId, type);
  if (!channelId) return;

  // Resolve guild-specific embed color if configured
  let color = 0xff6600;
  try {
    const gs = guildSettings.getSettings(guildId);
    const raw = gs?.embedColor;
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      color = raw >>> 0; // ensure uint32
    } else if (typeof raw === 'string' && raw.trim()) {
      let s = raw.trim();
      if (s.startsWith('#')) s = s.slice(1);
      const n = parseInt(s, 16);
      if (!Number.isNaN(n)) color = n >>> 0;
    }
  } catch {
    // ignore and use default
  }

  const embed = createLogEmbed(customTitle || type, content, color, imageUrl, footerText);
  const payload = { embeds: [embed] };
  try {
    const cached = client.channels.cache.get(channelId);
    const channel = cached || await client.channels.fetch(channelId);
    if (channel?.send) {
      if (DEBUG) console.info({ event: 'logger_send', guildId, type, channelId, via: 'channel.send' });
      await channel.send(payload);
      return;
    }
  } catch (error) {
    if (error && error.name === 'AbortError') {
      if (DEBUG) console.warn(`Logger channel send aborted for guild ${guildId} type "${type}" channel ${channelId}:`, error.message || error);
    } else {
      console.error(`Logger channel send failed for guild ${guildId} type "${type}" channel ${channelId}:`, error);
    }
  }
  try {
    if (DEBUG) console.info({ event: 'logger_send', guildId, type, channelId, via: 'rest' });
    await client.rest.post(Routes.channelMessages(channelId), { body: embed.toJSON ? { embeds: [embed.toJSON()] } : payload });
  } catch (error) {
    if (error && error.name === 'AbortError') {
      if (DEBUG) console.warn(`Logger REST send aborted for guild ${guildId} type "${type}" channel ${channelId}:`, error.message || error);
    } else {
      console.error(`Logger REST send failed for guild ${guildId} type "${type}" channel ${channelId}:`, error);
    }
  }
}

async function isMessageLogIgnored(message) {
  const guildId = message?.guildId || message?.guild?.id;
  if (!guildId) return false;

  const ignores = guildSettings.getSettings(guildId).messageLogIgnores || {};
  const channelId = message.channelId || message.channel?.id;
  const userId = message.author?.id;
  if (ignores.channels?.includes(channelId) || ignores.users?.includes(userId)) return true;

  const ignoredRoles = Array.isArray(ignores.roles) ? ignores.roles : [];
  if (ignoredRoles.length === 0) return false;
  let member = message.member || message.guild?.members?.cache?.get(userId);
  if (!member && userId && message.guild?.members?.fetch) {
    try {
      member = await message.guild.members.fetch(userId);
    } catch {
      return false;
    }
  }
  return member?.roles?.cache?.some(role => ignoredRoles.includes(role.id)) || false;
}

// Log message deletion
async function logDelete(message, client) {
  // Ignore bot messages to prevent unnecessary logging
  if (!message?.author || typeof message.author.bot === 'undefined') return;
  if (message.author.bot) return;
  if (await isMessageLogIgnored(message)) return;

  if (DEBUG) console.info({ event: 'logger_logDelete', message: message.id, author: message.author.id, channel: message.channel?.id, guild: message.guild?.id });

  let deleterText = 'Unknown';

  // If the message is in a guild, try to fetch audit logs to determine who deleted it
  if (message.guild && message.guild.fetchAuditLogs) {
    try {
      // Wait a short time for the audit log to be created
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const fetchedLogs = await message.guild.fetchAuditLogs({ limit: 10, type: AuditLogEvent.MessageDelete });
      const channelId = message.channelId || message.channel?.id;
      const now = Date.now();
      const deletionLog = fetchedLogs.entries.find(entry => {
        const age = now - entry.createdTimestamp;
        return entry.target?.id === message.author.id &&
          entry.extra?.channel?.id === channelId &&
          age >= 0 &&
          age <= 10000;
      });

      if (deletionLog?.executor?.id) {
        deleterText = `${deletionLog.executor.displayName} (${deletionLog.executor.id})`;
      }
    } catch (error) {
      // Couldn't fetch audit logs (missing permission or other error). We'll fall back to Unknown.
      if (DEBUG) console.error('Logger: could not fetch audit logs to determine deleter:', error.message);
    }
  }

  let attachmentText = '';
  const imageUrls = [];
  if (message.attachments && message.attachments.size > 0) {
    const urls = message.attachments.map(a => a.url).join('\n');
    attachmentText = `**Attachments**: ${urls}`;
    
    for (const attachment of message.attachments.values()) {
      if (attachment?.contentType?.startsWith('image/') || /\.(png|jpe?g|gif|webp|avif)$/i.test(attachment?.name || '')) {
        imageUrls.push(attachment.url);
      }
    }
  }

  const createdAt = Number.isFinite(message.createdTimestamp)
    ? `<t:${Math.floor(message.createdTimestamp / 1000)}:F>`
    : 'Unknown';
  const content = `**Channel:** <#${message.channel.id}>\n**Message ID:** ${message.id}\n**Poster:** ${message.author} ${message.author.displayName} (${message.author.id})\n**Created:** ${createdAt}\n**Content:** ${message.content || null}\n${attachmentText}\n`;
  
  if (message.guild) {
    const embed = createLogEmbed('A Message Was Deleted', content, 0xff6600, null, `Deleted by: ${deleterText}`);
    
    if (imageUrls.length > 0) {
      embed.setImage(imageUrls[0]);
    }
    
    const channelId = guildSettings.getLogChannel(message.guild.id, 'messageDelete');
    if (channelId) {
      try {
        const channel = client.channels.cache.get(channelId) || await client.channels.fetch(channelId);
        if (channel?.send) {
          const payload = { embeds: [embed] };
          
          if (imageUrls.length > 1) {
            payload.files = imageUrls.slice(1).map(url => ({ attachment: url }));
          }
          
          await channel.send(payload);
          return;
        }
      } catch (error) {
        if (error && error.name === 'AbortError') {
          if (DEBUG) console.warn(`Logger channel send aborted for guild ${message.guild?.id} channel ${channelId}:`, error.message || error);
        } else {
          console.error(`Logger channel send failed for guild ${message.guild?.id} channel ${channelId}:`, error);
        }
      }

      try {
        if (DEBUG) console.info({ event: 'logger_send', guildId: message.guild?.id, type: 'messageDelete', channelId, via: 'rest_fallback' });
        await client.rest.post(Routes.channelMessages(channelId), { body: { embeds: [embed.toJSON ? embed.toJSON() : embed] } });
      } catch (restError) {
        console.error(`Logger REST fallback failed for guild ${message.guild?.id} channel ${channelId}:`, restError);
      }
    }
  }
}

// Log member join
function logMemberJoin(member, client) {
  if (DEBUG) console.info({ event: 'logger_logMemberJoin', user: member.user?.id, guild: member.guild?.id });
  const createdAt = member.user?.createdAt?.toUTCString() || 'Unknown';
  const accountAge = member.user?.createdAt ? Math.floor((Date.now() - member.user.createdAt.getTime()) / (1000 * 60 * 60 * 24)) : 'Unknown';
  
  let content = `**Joined**\nDisplay Name: ${member.user}\nUsername: ${member.user.username}\nUser ID: ${member.user.id}\nUser Type: ${member.user.bot ? '🤖 Bot' : '🤷 Human'}`;
  
  // Add age group if available
  if (member.user.ageGroup) {
    const ageGroupMap = {
      'unknown': 'Age: Unknown',
      'minor': '🔞 Minor',
      'adult': '👤 Adult'
    };
    content += `\nAge Group: ${ageGroupMap[member.user.ageGroup] || member.user.ageGroup}`;
  }
  
  // Add verification status
  if (member.user.verified !== undefined) {
    content += `\nVerified: ${member.user.verified ? 'Yes' : 'No'}`;
  }
  
  content += `\nAccount created: ${createdAt} (${accountAge} days ago)`;
  
  sendLog(client, member.guild.id, 'memberJoin', content, null, null, 'Member Joined');
}

// Log member leave
async function logMemberLeave(member, client) {
  if (DEBUG) console.info({ event: 'logger_logMemberLeave', user: member.user?.id, guild: member.guild?.id });
  const createdAt = member.user?.createdAt?.toUTCString() || 'Unknown';
  const accountAge = member.user?.createdAt ? Math.floor((Date.now() - member.user.createdAt.getTime()) / (1000 * 60 * 60 * 24)) : 'Unknown';
  const joinedAt = member.joinedAt?.toUTCString() || 'Unknown';
  const joinDuration = member.joinedAt ? Math.floor((Date.now() - member.joinedAt.getTime()) / (1000 * 60 * 60 * 24)) : 'Unknown';

  let action = 'Left';
  let actorText = 'Unknown';
  let reasonText = '';

  // Try to determine if the member was kicked or banned by inspecting audit logs
  if (member.guild && member.guild.fetchAuditLogs) {
    try {
      // Check for a recent ban entry first
      const banLogs = await member.guild.fetchAuditLogs({ limit: 6, type: AuditLogEvent.MemberBanAdd });
      const banEntry = banLogs.entries.find(entry => entry.target?.id === member.id && (Date.now() - entry.createdTimestamp) < 30000);
      if (banEntry) {
        action = 'Banned';
        if (banEntry.executor) {
          actorText = `${banEntry.executor.username} (${banEntry.executor.id})`;
        }
        if (banEntry.reason) {
          reasonText = banEntry.reason;
        }
      } else {
        // Check for a recent kick entry
        const kickLogs = await member.guild.fetchAuditLogs({ limit: 6, type: AuditLogEvent.MemberKick });
        const kickEntry = kickLogs.entries.find(entry => entry.target?.id === member.id && (Date.now() - entry.createdTimestamp) < 30000);
        if (kickEntry) {
          action = 'Kicked';
          if (kickEntry.executor) {
            actorText = `${kickEntry.executor.username} (${kickEntry.executor.id})`;
          }
          if (kickEntry.reason) {
            reasonText = kickEntry.reason;
          }
        }
      }
    } catch (error) {
      // Missing permissions or other error fetching audit logs
      console.error('Logger: could not fetch audit logs for member leave:', error);
    }
  }

  if (action === 'Banned') return;

  let content = `**${action}**\nDisplay Name: ${member.user}\nUsername: ${member.user.username}\nUser ID: ${member.user.id}\nUser Type: ${member.user.bot ? '🤖 Bot' : '🤷 Human'}`;
  
  // Add age group if available
  if (member.user.ageGroup) {
    const ageGroupMap = {
      'unknown': 'Age: Unknown',
      'minor': '🔞 Minor',
      'adult': '👤 Adult'
    };
    content += `\nAge Group: ${ageGroupMap[member.user.ageGroup] || member.user.ageGroup}`;
  }
  
  // Add verification status
  if (member.user.verified !== undefined) {
    content += `\nVerified: ${member.user.verified ? 'Yes' : 'No'}`;
  }
  
  content += `\nAccount created: ${createdAt} (${accountAge} days ago)\nJoined at: ${joinedAt} (${joinDuration} days ago)\nActor: ${actorText}`;
  if (reasonText) content += `\nReason: ${reasonText}`;

  const logType = action === 'Kicked' ? 'memberKick' : 'memberLeave';
  sendLog(client, member.guild.id, logType, content, null, null, `Member ${action}`);
}

// Log ticket creation
function logTicketCreation(thread, client) {
  if (DEBUG) console.info({ event: 'logger_logTicketCreation', thread: thread?.id, guild: thread?.guild?.id });
  const content = `A new ticket has been created: ${thread.name} <#${thread.id}>`;
  if (thread.guild) sendLog(client, thread.guild.id, 'ticketCreated', content, null, null, 'Ticket Created');
}

// Log ticket closed
function logTicketClosed(thread, client, closedBy = null) {
  if (DEBUG) console.info({ event: 'logger_logTicketClosed', thread: thread?.id, guild: thread?.guild?.id });
  const closedByText = closedBy ? `\nClosed by: ${closedBy.username} (${closedBy.id})` : '';
  const content = `A ticket has been closed: ${thread.name} <#${thread.id}>${closedByText}`;
  if (thread.guild) sendLog(client, thread.guild.id, 'ticketClosed', content, null, null, 'Ticket Closed');
}

// If guildId is provided, send to that guild's general log; otherwise broadcast to all guilds
function logGeneral(content, client, guildId) {
  if (guildId) {
    return sendLog(client, guildId, 'generalLog', content);
  }
  for (const [gid] of client.guilds.cache) {
    sendLog(client, gid, 'generalLog', content);
  }
}

module.exports = {
  logDelete,
  isMessageLogIgnored,
  logMemberJoin,
  logMemberLeave,
  logTicketCreation,
  logTicketClosed,
  logGeneral,
  sendLog // Export sendLog to be used in invite tracking
};