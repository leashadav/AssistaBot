const { EmbedBuilder } = require('discord.js');
const { logChannels } = require('../config.json');

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

  if (!client.channels) {
    console.error('client.channels is undefined. Make sure the Discord client is ready before calling sendLog.');
    return;
  }

  let channel = client.channels.cache?.get(channelId);
  if (!channel && typeof client.channels.fetch === 'function') {
    channel = await client.channels.fetch(channelId).catch(() => null);
  }
  if (channel) {
    const embed = createLogEmbed(type, content);
    await channel.send({ embeds: [embed] });
  }
}

function logDelete(client, content) {
  sendLog(client, 'messageDelete', content);
}
function logMemberJoin(client, content) {
  sendLog(client, 'memberJoin', content);
}
function logTicketCreation(client, content) {
  sendLog(client, 'ticketCreated', content);
}
function logGeneral(client, content) {
  sendLog(client, 'generalLog', content);
}

// Other log functions...

module.exports = {
  logDelete,
  logMemberJoin,
  logTicketCreation,
  logGeneral,
  sendLog,  // Export sendLog to be used in invite tracking
};