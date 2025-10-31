const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const guildSettings = require('../modules/guildSettings');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Configure server-specific settings for the bot')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(subcommand =>
      subcommand
        .setName('logchannel')
        .setDescription('Set a logging channel')
        .addStringOption(option =>
          option.setName('type')
            .setDescription('The type of log channel to set')
            .setRequired(true)
            .addChoices(
              { name: 'Message Delete', value: 'messageDelete' },
              { name: 'Member Join', value: 'memberJoin' },
              { name: 'Member Leave', value: 'memberLeave' },
              { name: 'Ticket Created', value: 'ticketCreated' },
              { name: 'Ticket Closed', value: 'ticketClosed' },
              { name: 'General Log', value: 'generalLog' },
              { name: 'Invite Log', value: 'inviteLog' }
            ))
        .addChannelOption(option =>
          option.setName('channel')
            .setDescription('The channel to use for this log type')
            .setRequired(true)))
    .addSubcommand(subcommand =>
      subcommand
        .setName('birthday')
        .setDescription('Configure birthday settings')
        .addRoleOption(option =>
          option.setName('role')
            .setDescription('The role to assign on birthdays')
            .setRequired(true))
        .addChannelOption(option =>
          option.setName('channel')
            .setDescription('The channel for birthday announcements')
            .setRequired(true)))
    .addSubcommand(subcommand =>
      subcommand
        .setName('support')
        .setDescription('Set the support ticket channel')
        .addChannelOption(option =>
          option.setName('channel')
            .setDescription('The channel for support tickets')
            .setRequired(true)))
    .addSubcommand(subcommand =>
      subcommand
        .setName('show')
        .setDescription('Show current server settings')),

  async execute(interaction) {
    if (!interaction.guild) {
      return await interaction.reply({
        content: 'This command can only be used in a server.',
        flags: 64
      });
    }

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'show') {
      const settings = guildSettings.getSettings(interaction.guild.id);
      const formatted = [
        '**Current Server Settings**',
        '```',
        'Log Channels:',
        Object.entries(settings.logChannels)
          .map(([type, id]) => `  ${type}: ${id || 'Not set'}`)
          .join('\n'),
        '',
        'Birthday Settings:',
        `  Role: ${settings.birthdayInfo.birthdayRole || 'Not set'}`,
        `  Channel: ${settings.birthdayInfo.birthdayChannel || 'Not set'}`,
        '',
        `Support Channel: ${settings.supportChannelId || 'Not set'}`,
        `Command Prefix: ${settings.prefix}`,
        '```'
      ].join('\n');

      return await interaction.reply({
        content: formatted,
        flags: 64
      });
    }

    if (subcommand === 'logchannel') {
      const type = interaction.options.getString('type');
      const channel = interaction.options.getChannel('channel');
      
      guildSettings.setLogChannel(interaction.guild.id, type, channel.id);
      
      return await interaction.reply({
        content: `Set ${type} log channel to ${channel}`,
        flags: 64
      });
    }

    if (subcommand === 'birthday') {
      const role = interaction.options.getRole('role');
      const channel = interaction.options.getChannel('channel');
      
      const settings = guildSettings.updateSettings(interaction.guild.id, {
        birthdayInfo: {
          birthdayRole: role.id,
          birthdayChannel: channel.id
        }
      });
      
      return await interaction.reply({
        content: `Updated birthday settings:\nRole: ${role}\nChannel: ${channel}`,
        flags: 64
      });
    }

    if (subcommand === 'support') {
      const channel = interaction.options.getChannel('channel');
      
      const settings = guildSettings.updateSettings(interaction.guild.id, {
        supportChannelId: channel.id
      });
      
      return await interaction.reply({
        content: `Set support channel to ${channel}`,
        flags: 64
      });
    }
  },
};