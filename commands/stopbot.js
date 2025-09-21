const { SlashCommandBuilder } = require('discord.js');

// Replace with the allowed user's Discord ID
const ALLOWED_USER_ID = '460291964248522753';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stopbot')
    .setDescription('Shuts down the bot (Owner only)'),
  async execute(interaction) {
    if (interaction.user.id !== ALLOWED_USER_ID) {
      return interaction.reply({ content: '❌ You are not authorized to use this command.', flags: 64 });
    }

    await interaction.reply('Shutting down the bot...');
    interaction.client.destroy();
    process.exit(0);
  },
};