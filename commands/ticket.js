const { SlashCommandBuilder, ChannelType } = require('discord.js');
const { logTicketCreation, logTicketClosed } = require('../modules/logger');
const { SUPPORT_CHANNEL_ID } = require('../config.json');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Create or close a support ticket')
    .addSubcommand(sub =>
      sub.setName('open')
        .setDescription('Create a support ticket'))
    .addSubcommand(sub =>
      sub.setName('close')
        .setDescription('Close the current ticket thread')),

  async execute(interaction, client) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'open') {
      const supportChannel = await interaction.guild.channels.fetch(SUPPORT_CHANNEL_ID);

      if (!supportChannel || supportChannel.type !== ChannelType.GuildText) {
        return interaction.reply({ content: 'Support channel not found or is not a text channel.', ephemeral: true });
      }

      // Create a thread in the support channel
      const thread = await supportChannel.threads.create({
        name: `ticket-${interaction.user.username}`,
        autoArchiveDuration: 1440, // 24 hours
        reason: `Support ticket for ${interaction.user.tag}`,
      });

      await interaction.reply({ content: `✅ Ticket thread created: <#${thread.id}>`, flags: 64 });
      await thread.send(`Hello ${interaction.user}, please describe your issue. A moderator will assist you soon.`);

      // Log the creation of the ticket
      logTicketCreation(thread, client);
    }

    if (sub === 'close') {
      // Only allow closing if the command is run inside a thread
      if (interaction.channel.type !== ChannelType.PublicThread && interaction.channel.type !== ChannelType.PrivateThread) {
        return interaction.reply({ content: 'This command can only be used inside a ticket thread.', flags: 64 });
      }

      await interaction.reply({ content: '🔒 Closing this ticket thread...', flags: 64 });
      await interaction.channel.setArchived(true);
      // Optionally, log the closing of the ticket here
      logTicketClosed(interaction.channel, client);
    }
  },
};