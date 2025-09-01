// No slash command needed — handled in events/messageCreate.js
const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('say')
    .setDescription('Echo your message')
    .addStringOption(opt => opt.setName('message').setDescription('Message to echo').setRequired(true)),
  async execute(interaction) {
    const message = interaction.options.getString('message');
    await interaction.reply(message);
  },
};