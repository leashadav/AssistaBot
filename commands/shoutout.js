const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const twitchShoutouts = require('../modules/twitchShoutouts');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('shoutout')
    .setDescription('Manage automatic Twitch shoutouts')
    .addSubcommand(subcommand =>
      subcommand
        .setName('add')
        .setDescription('Add a user to automatic shoutouts')
        .addStringOption(option =>
          option.setName('username')
            .setDescription('Twitch username to add')
            .setRequired(true)))
    .addSubcommand(subcommand =>
      subcommand
        .setName('remove')
        .setDescription('Remove a user from automatic shoutouts')
        .addStringOption(option =>
          option.setName('username')
            .setDescription('Twitch username to remove')
            .setRequired(true)))
    .addSubcommand(subcommand =>
      subcommand
        .setName('list')
        .setDescription('List all users in automatic shoutouts'))
    .addSubcommand(subcommand =>
      subcommand
        .setName('clear')
        .setDescription('Clear cooldown for a user')
        .addStringOption(option =>
          option.setName('username')
            .setDescription('Twitch username to clear cooldown for')
            .setRequired(true))),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
      case 'add': {
        const username = interaction.options.getString('username');
        twitchShoutouts.addUser(username);
        
        const embed = new EmbedBuilder()
          .setColor(0x9146FF)
          .setTitle('✅ Shoutout User Added')
          .setDescription(`Added **${username}** to automatic shoutouts`)
          .setTimestamp();
        
        await interaction.reply({ embeds: [embed], flags: 64 });
        break;
      }

      case 'remove': {
        const username = interaction.options.getString('username');
        const removed = twitchShoutouts.removeUser(username);
        
        const embed = new EmbedBuilder()
          .setColor(removed ? 0x9146FF : 0xFF0000)
          .setTitle(removed ? '✅ Shoutout User Removed' : '❌ User Not Found')
          .setDescription(removed ? `Removed **${username}** from automatic shoutouts` : `**${username}** was not in the shoutout list`)
          .setTimestamp();
        
        await interaction.reply({ embeds: [embed], flags: 64 });
        break;
      }

      case 'list': {
        const users = twitchShoutouts.listUsers();
        
        const embed = new EmbedBuilder()
          .setColor(0x9146FF)
          .setTitle('📋 Automatic Shoutout Users')
          .setDescription(users.length > 0 ? users.map(u => `• ${u}`).join('\n') : 'No users configured')
          .setFooter({ text: `${users.length} users • 8 hour cooldown` })
          .setTimestamp();
        
        await interaction.reply({ embeds: [embed], flags: 64 });
        break;
      }

      case 'clear': {
        const username = interaction.options.getString('username');
        const cleared = twitchShoutouts.clearCooldown(username);
        
        const embed = new EmbedBuilder()
          .setColor(cleared ? 0x9146FF : 0xFF0000)
          .setTitle(cleared ? '✅ Cooldown Cleared' : '❌ No Cooldown Found')
          .setDescription(cleared ? `Cleared cooldown for **${username}**` : `No active cooldown found for **${username}**`)
          .setTimestamp();
        
        await interaction.reply({ embeds: [embed], flags: 64 });
        break;
      }
    }
  },
};