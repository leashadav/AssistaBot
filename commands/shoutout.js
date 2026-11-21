const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, EmbedBuilder } = require('discord.js');
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
            .setRequired(true)))
    .addSubcommand(subcommand =>
      subcommand
        .setName('resetstream')
        .setDescription('Reset the current stream session (start fresh shoutouts for new stream)')),

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
        
        await interaction.reply({ 
          embeds: [embed],
          flags: MessageFlags.Ephemeral
        });
        break;
      }

      case 'remove': {
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
          return interaction.reply({
            content: '❌ You need **Manage Messages** permission to use this command.',
            flags: MessageFlags.Ephemeral
          });
        }
        const username = interaction.options.getString('username');
        const removed = twitchShoutouts.removeUser(username);
        
        const embed = new EmbedBuilder()
          .setColor(removed ? 0x9146FF : 0xFF0000)
          .setTitle(removed ? '✅ Shoutout User Removed' : '❌ User Not Found')
          .setDescription(removed ? `Removed **${username}** from automatic shoutouts` : `**${username}** was not in the shoutout list`)
          .setTimestamp();
        
        await interaction.reply({ 
          embeds: [embed],
          flags: MessageFlags.Ephemeral
        });
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
        
        await interaction.reply({ 
          embeds: [embed],
          flags: MessageFlags.Ephemeral
        });
        break;
      }

      case 'clear': {
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
          return interaction.reply({
            content: '❌ You need **Manage Messages** permission to use this command.',
            flags: MessageFlags.Ephemeral
          });
        }
        const username = interaction.options.getString('username');
        const cleared = twitchShoutouts.clearCooldown(username);
        
        const embed = new EmbedBuilder()
          .setColor(cleared ? 0x9146FF : 0xFF0000)
          .setTitle(cleared ? '✅ Cooldown Cleared' : '❌ No Cooldown Found')
          .setDescription(cleared ? `Cleared cooldown for **${username}**` : `No active cooldown found for **${username}**`)
          .setTimestamp();
        
        await interaction.reply({ 
          embeds: [embed],
          flags: MessageFlags.Ephemeral
        });
        break;
      }

      case 'resetstream': {
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
          return interaction.reply({
            content: '❌ You need **Manage Messages** permission to use this command.',
            flags: MessageFlags.Ephemeral
          });
        }
        twitchShoutouts.resetStreamSession();
        
        const embed = new EmbedBuilder()
          .setColor(0x9146FF)
          .setTitle('🔄 Stream Session Reset')
          .setDescription('Stream session has been reset. All users can be shouted out again for the new stream.')
          .setTimestamp();
        
        await interaction.reply({ 
          embeds: [embed],
          flags: MessageFlags.Ephemeral
        });
        break;
      }
    }
  },
};