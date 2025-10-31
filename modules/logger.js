const { EmbedBuilder, AuditLogEvent } = require('discord.js');

// Load config for optional embed defaults (author/footer/name)
const config = require('../config.json');
// Log channel mappings (adjust channel IDs as needed)
const logChannels = config.logChannels;


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

// Send log to a specific channel
async function sendLog(client, type, content) {
  const channelId = logChannels[type];
  if (!channelId) return; // If no channel is specified, do nothing
  try {
    const channel = await client.channels.fetch(channelId);
    if (channel) {
      const embed = createLogEmbed(type, content);
      await channel.send({ embeds: [embed] });
    }
  } catch (err) {
    console.error(`Logger error for type "${type}":`, err);
  }
}

// Log message deletion
async function logDelete(message, client) {
  // Ignore bot messages to prevent unnecessary logging
  if (!message || !message.author || typeof message.author.bot === 'undefined') return;
  if (message.author.bot) return;

  let deleterText = 'Unknown';

  // If the message is in a guild, try to fetch audit logs to determine who deleted it
  if (message.guild && message.guild.fetchAuditLogs) {
    try {
      const fetchedLogs = await message.guild.fetchAuditLogs({ limit: 6, type: AuditLogEvent.MessageDelete });
      // Look for a log entry where the target is the message author and the entry is recent
      const deletionLog = fetchedLogs.entries.find(entry => {
        return entry.target && entry.target.id === message.author.id && (Date.now() - entry.createdTimestamp) < 10000;
      });

      if (deletionLog && deletionLog.executor) {
        deleterText = `${deletionLog.executor.tag} (${deletionLog.executor.id})`;
      }
    } catch (err) {
      // Couldn't fetch audit logs (missing permission or other error). We'll fall back to Unknown.
      console.error('Logger: could not fetch audit logs to determine deleter:', err);
    }
  }

  const content = `A message was deleted in <#${message.channel.id}>:\n**${message.content || '[No Content]'}**\n\nPoster: ${message.author} ${message.author.tag} (${message.author.id})\n\nDeleted by: ${deleterText}`;
  sendLog(client, 'messageDelete', content);
}

// Log member join
function logMemberJoin(member, client) {
  const createdAt = member.user && member.user.createdAt ? member.user.createdAt.toUTCString() : 'Unknown';
  const content = `**Joined**\nDisplay Name: ${member.user}\nUsername: ${member.user.tag}\nUser ID: ${member.user.id}\nAccount created: ${createdAt}`;
  sendLog(client, 'memberJoin', content);
}

// Log member leave
async function logMemberLeave(member, client) {
  const createdAt = member.user && member.user.createdAt ? member.user.createdAt.toUTCString() : 'Unknown';
  const joinedAt = member.joinedAt ? member.joinedAt.toUTCString() : 'Unknown';

  let action = 'Left';
  let actorText = 'Unknown';
  let reasonText = '';

  // Try to determine if the member was kicked or banned by inspecting audit logs
  if (member.guild && member.guild.fetchAuditLogs) {
    try {
      // Check for a recent ban entry first
      const banLogs = await member.guild.fetchAuditLogs({ limit: 6, type: AuditLogEvent.MemberBanAdd });
      const banEntry = banLogs.entries.find(entry => entry.target && entry.target.id === member.id && (Date.now() - entry.createdTimestamp) < 30000);
      if (banEntry) {
        action = 'Banned';
        if (banEntry.executor) actorText = `${banEntry.executor.tag} (${banEntry.executor.id})`;
        if (banEntry.reason) reasonText = banEntry.reason;
      } else {
        // Check for a recent kick entry
        const kickLogs = await member.guild.fetchAuditLogs({ limit: 6, type: AuditLogEvent.MemberKick });
        const kickEntry = kickLogs.entries.find(entry => entry.target && entry.target.id === member.id && (Date.now() - entry.createdTimestamp) < 30000);
        if (kickEntry) {
          action = 'Kicked';
          if (kickEntry.executor) actorText = `${kickEntry.executor.tag} (${kickEntry.executor.id})`;
          if (kickEntry.reason) reasonText = kickEntry.reason;
        }
      }
    } catch (err) {
      // Missing permissions or other error fetching audit logs
      console.error('Logger: could not fetch audit logs for member leave:', err);
    }
  }

  let content = `**${action}**\nDisplay Name: ${member.user}\nUsername: ${member.user.tag}\nUser ID: ${member.user.id}\nAccount created: ${createdAt}\nJoined at: ${joinedAt}\nActor: ${actorText}`;
  if (reasonText) content += `\nReason: ${reasonText}`;

  sendLog(client, 'memberLeave', content);
}

// Log ticket creation
function logTicketCreation(thread, client) {
  const content = `A new ticket has been created: ${thread.name} <#${thread.id}>`;
  sendLog(client, 'ticketCreated', content);
}

// Log ticket closed
function logTicketClosed(thread, client) {
  const content = `A ticket has been closed: ${thread.name} <#${thread.id}>`;
  sendLog(client, 'ticketClosed', content);
}

function logGeneral(content, client) {
  sendLog(client, 'generalLog', content);
}

module.exports = {
  logDelete,
  logMemberJoin,
  logMemberLeave,
  logTicketCreation,
  logTicketClosed,
  logGeneral,
  sendLog,  // Export sendLog to be used in invite tracking
};