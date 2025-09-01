const { SlashCommandBuilder } = require('discord.js');
const { setBirthday, getBirthday } = require('../modules/birthdayManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('birthday')
    .setDescription('Manage your birthday')
    .addSubcommand(sub =>
      sub.setName('set')
        .setDescription('Set your birthday (MM-DD)')
        .addStringOption(opt => opt.setName('date').setDescription('Format: MM-DD').setRequired(true)))
    .addSubcommand(sub =>
      sub.setName('view')
        .setDescription('View your birthday')),
  
  async execute(interaction) {
    if (interaction.options.getSubcommand() === 'set') {
      const date = interaction.options.getString('date');
      setBirthday(interaction.user.id, date);
      await interaction.reply(`✅ Your birthday has been set to **${date}**`);
    } else if (interaction.options.getSubcommand() === 'view') {
      const date = getBirthday(interaction.user.id);
      if (date) {
        await interaction.reply(`🎂 Your birthday is set to **${date}**`);
      } else {
        await interaction.reply('❌ You have not set a birthday yet.');
      }
    }
  },
};