const { EmbedBuilder } = require('discord.js');

// Log channel mappings (adjust channel IDs as needed)
const logChannels = require('../config.json').logChannels;


function createLogEmbed(title, description, color = 0x00FF00) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description)
    .setTimestamp();
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
function logDelete(message, client) {
    // Ignore bot messages to prevent unnecessary logging
    if (!message.author || typeof message.author.bot === 'undefined') return;
    if (message.author.bot) return;
    const content = `A message was deleted in <#${message.channel.id}>:\n**${message.content || '[No Content]'}**`;
    sendLog(client, 'messageDelete', content);
}

// Log member join
function logMemberJoin(member, client) {
  const content = `${member.user.tag} joined the server.`;
  sendLog(client, 'memberJoin', content);
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
  logTicketCreation,
  logTicketClosed,
  logGeneral,
  sendLog,  // Export sendLog to be used in invite tracking
};