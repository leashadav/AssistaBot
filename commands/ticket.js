const { SlashCommandBuilder } = require('discord.js');
const { logTicketCreation } = require('../modules/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Create a support ticket'),
  
  async execute(interaction, client) {
    const guild = interaction.guild;
    const channel = await guild.channels.create({
      name: `ticket-${interaction.user.username}`,
      type: 0, // text channel
      permissionOverwrites: [
        {
          id: guild.id,
          deny: ['VIEW_CHANNEL'],
        },
        {
          id: interaction.user.id,
          allow: ['VIEW_CHANNEL', 'SEND_MESSAGES'],
        },
      ],
    });

    await interaction.reply({ content: `✅ Ticket created: ${channel}`, ephemeral: true });
    await channel.send(`Hello ${interaction.user}, please describe your issue. A moderator will assist you soon.`);

    // Log the creation of the ticket
    logTicketCreation(channel, client);
  },
};