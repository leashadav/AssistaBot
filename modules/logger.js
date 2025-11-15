const { EmbedBuilder, AuditLogEvent, Routes } = require('discord.js');

// Load config for optional embed defaults (author/footer/name)
const configLoader = require('./configLoader');
const config = configLoader.config;
const guildSettings = require('./guildSettings');
const DEBUG = /^(1|true)$/i.test(String(process.env.ASSISTABOT_DEBUG || ''));

// Create a log embed with the given title and description
function createLogEmbed(title, description, color = 0xff6600) {
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description)
    .setTimestamp();

  // Attach an author if configured; accept either an object or a simple botName
  if (config.logAuthor && typeof config.logAuthor === 'object') {
    // config.logAuthor should be an object like { name, iconURL, url }
    embed.setAuthor(config.logAuthor);
  } else if (config.botName) {
    embed.setAuthor({ name: config.botName });
  }

  // Attach a footer if configured; prefer full object or fallback to footerText
  if (config.logFooter && typeof config.logFooter === 'object') {
    // config.logFooter should be an object like { text, iconURL }
    embed.setFooter(config.logFooter);
  } else if (config.footerText) {
    embed.setFooter({ text: config.footerText });
  }

  return embed;
}

// Send log to a specific channel for a given guild
async function sendLog(client, guildId, type, content) {
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

  const embed = createLogEmbed(type, content, color);
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
    console.error(`Logger channel send failed for guild ${guildId} type "${type}" channel ${channelId}:`, error);
  }
  try {
    if (DEBUG) console.info({ event: 'logger_send', guildId, type, channelId, via: 'rest' });
    await client.rest.post(Routes.channelMessages(channelId), { body: embed.toJSON ? { embeds: [embed.toJSON()] } : payload });
  } catch (error) {
    console.error(`Logger REST send failed for guild ${guildId} type "${type}" channel ${channelId}:`, error);
  }
}

// Log message deletion
async function logDelete(message, client) {
  // Ignore bot messages to prevent unnecessary logging
  if (!message?.author || typeof message.author.bot === 'undefined') return;
  if (message.author.bot) return;

  if (DEBUG) console.info({ event: 'logger_logDelete', message: message.id, author: message.author.id, channel: message.channel?.id, guild: message.guild?.id });

  let deleterText = 'Unknown';

  // If the message is in a guild, try to fetch audit logs to determine who deleted it
  if (message.guild && message.guild.fetchAuditLogs) {
    try {
      // Wait a short time for the audit log to be created
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const fetchedLogs = await message.guild.fetchAuditLogs({ limit: 3, type: AuditLogEvent.MessageDelete });
      
      if (fetchedLogs && fetchedLogs.entries.size > 0) {
        // Get the most recent entry (first one)
        const deletionLog = fetchedLogs.entries.first();
        if (deletionLog && deletionLog.executor && deletionLog.executor.id) {
          deleterText = `${deletionLog.executor.username} (${deletionLog.executor.id})`;
        }
      }
    } catch (error) {
      // Couldn't fetch audit logs (missing permission or other error). We'll fall back to Unknown.
      if (DEBUG) console.error('Logger: could not fetch audit logs to determine deleter:', error.message);
    }
  }

  const content = `A message was deleted in <#${message.channel.id}>:\n**${message.content || '[No Content]'}**\n\nPoster: ${message.author} ${message.author.tag} (${message.author.id})\n\nDeleted by: ${deleterText}`;
  if (message.guild) sendLog(client, message.guild.id, 'messageDelete', content);
}

// Log member join
function logMemberJoin(member, client) {
  if (DEBUG) console.info({ event: 'logger_logMemberJoin', user: member.user?.id, guild: member.guild?.id });
  const createdAt = member.user?.createdAt?.toUTCString() || 'Unknown';
  const content = `**Joined**\nDisplay Name: ${member.user}\nUsername: ${member.user.tag}\nUser ID: ${member.user.id}\nAccount created: ${createdAt}`;
  sendLog(client, member.guild.id, 'memberJoin', content);
}

// Log member leave
async function logMemberLeave(member, client) {
  if (DEBUG) console.info({ event: 'logger_logMemberLeave', user: member.user?.id, guild: member.guild?.id });
  const createdAt = member.user?.createdAt?.toUTCString() || 'Unknown';
  const joinedAt = member.joinedAt?.toUTCString() || 'Unknown';

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
          actorText = `${banEntry.executor.tag} (${banEntry.executor.id})`;
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
            actorText = `${kickEntry.executor.tag} (${kickEntry.executor.id})`;
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

  let content = `**${action}**\nDisplay Name: ${member.user}\nUsername: ${member.user.tag}\nUser ID: ${member.user.id}\nAccount created: ${createdAt}\nJoined at: ${joinedAt}\nActor: ${actorText}`;
  if (reasonText) content += `\nReason: ${reasonText}`;

  sendLog(client, member.guild.id, 'memberLeave', content);
}

// Log ticket creation
function logTicketCreation(thread, client) {
  if (DEBUG) console.info({ event: 'logger_logTicketCreation', thread: thread?.id, guild: thread?.guild?.id });
  const content = `A new ticket has been created: ${thread.name} <#${thread.id}>`;
  if (thread.guild) sendLog(client, thread.guild.id, 'ticketCreated', content);
}

// Log ticket closed
function logTicketClosed(thread, client, closedBy = null) {
  if (DEBUG) console.info({ event: 'logger_logTicketClosed', thread: thread?.id, guild: thread?.guild?.id });
  const closedByText = closedBy ? `\nClosed by: ${closedBy.tag} (${closedBy.id})` : '';
  const content = `A ticket has been closed: ${thread.name} <#${thread.id}>${closedByText}`;
  if (thread.guild) sendLog(client, thread.guild.id, 'ticketClosed', content);
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
  logMemberJoin,
  logMemberLeave,
  logTicketCreation,
  logTicketClosed,
  logGeneral,
  sendLog // Export sendLog to be used in invite tracking
};