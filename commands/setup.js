const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const guildSettings = require('../modules/guildSettings');
const { renderTemplate, buildGoodbyeEmbed } = require('../modules/welcomeUtil');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Configure server-specific settings for the bot')
    .setDMPermission(false)
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
              { name: 'Message Update', value: 'messageUpdate' },
              { name: 'Member Join', value: 'memberJoin' },
              { name: 'Member Leave', value: 'memberLeave' },
              { name: 'Ticket Created', value: 'ticketCreated' },
              { name: 'Ticket Closed', value: 'ticketClosed' },
              { name: 'General', value: 'generalLog' },
              { name: 'Invite', value: 'inviteLog' },
              { name: 'AssistaBot Say', value: 'assistabotsayLog' },
              { name: 'AssistaBot', value: 'assistabotLogging' }              
            ))
        .addChannelOption(option =>
          option.setName('channel')
            .setDescription('The channel or thread to use for this log type')
            .addChannelTypes(
              ChannelType.GuildText,
              ChannelType.GuildAnnouncement,
              ChannelType.PublicThread,
              ChannelType.PrivateThread,
              ChannelType.AnnouncementThread
            )
            .setRequired(true)))

    .addSubcommand(subcommand =>
      subcommand
        .setName('prefix')
        .setDescription('Set the command prefix for this server')
        .addStringOption(option =>
          option.setName('value')
            .setDescription('The prefix to use (1-5 visible characters)')
            .setRequired(true)))
    .addSubcommand(subcommand =>
      subcommand
        .setName('embedcolor')
        .setDescription('Set the embed color for this server')
        .addStringOption(option =>
          option.setName('value')
            .setDescription('Color as #RRGGBB, RRGGBB, 0xRRGGBB, or decimal 0-16777215')
            .setRequired(true)))
    .addSubcommand(subcommand =>
      subcommand
        .setName('show')
        .setDescription('Show current server settings'))
    .addSubcommand(subcommand =>
      subcommand
        .setName('tickets')
        .setDescription('Setup ticket system')
        .addChannelOption(option =>
          option.setName('support_channel')
            .setDescription('Channel for support tickets')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true))
        .addRoleOption(option =>
          option.setName('support_role')
            .setDescription('Role that can view tickets')
            .setRequired(true))),

  async execute(interaction) {
    try {
      if (!interaction.inGuild()) {
        return interaction.reply({ 
          content: '❌ This command can only be used in a server.',
          flags: 64 
        });
      }

      await interaction.deferReply({ flags: 64 });

      const subcommand = interaction.options.getSubcommand();

      if (subcommand === 'show') {
        const settings = guildSettings.getSettings(interaction.guild.id);

        const body = [
          'Log Channels:',
          Object.entries(settings.logChannels)
            .map(([type, id]) => `  ${type}: ${id || 'Not set'}`)
            .join('\n'),
          '',
          'Support Channel: ' + (settings.supportChannelId || 'Not set'),
          '',
          `Command Prefix: ${settings.prefix || 'Not set'}`,
          '',
          `Embed Color: ${settings.embedColor || 'Not set'}`,
        ].join('\n');

        const header = '**Current Server Settings**';

        // Chunk by lines to keep code block formatting and stay under 2000 chars per message
        const MAX_CONTENT = 1900; // leave room for code fences and header
        const lines = body.split('\n');
        const chunks = [];
        let current = '';
        for (const line of lines) {
          if ((current + (current ? '\n' : '') + line).length > MAX_CONTENT) {
            chunks.push(current);
            current = line;
          } else {
            current = current ? `${current}\n${line}` : line;
          }
        }
        if (current) chunks.push(current);

        if (chunks.length === 0) {
          return await interaction.editReply({ content: `${header}\n\n\`\`\`\n\`\`\`` });
        }

        // Send first chunk via editReply, rest via followUp (all ephemeral due to deferred flags)
        await interaction.editReply({
          content: `${header}\n\`\`\`\n${chunks[0]}\n\`\`\``
        });

        for (let i = 1; i < chunks.length; i++) {
          // ensure follow ups are ephemeral
          // flags: 64 == MessageFlags.Ephemeral
          await interaction.followUp({
            content: `\`\`\`\n${chunks[i]}\n\`\`\``,
            flags: 64
          });
        }

        return;
      }

      if (subcommand === 'logchannel') {
        const type = interaction.options.getString('type');
        const channel = interaction.options.getChannel('channel');
        
        try {
          guildSettings.setLogChannel(interaction.guild.id, type, channel.id);
          return interaction.editReply({
            content: `✅ Set ${type} log channel to ${channel}`,
            flags: 64
          });
        } catch (error) {
          console.error(`Error setting log channel ${type}:`, error);
          return interaction.editReply({
            content: `❌ Failed to set ${type} log channel: ${error.message}`,
            flags: 64
          });
        }
      }

      if (subcommand === 'prefix') {
        const raw = interaction.options.getString('value');
        const value = (raw || '').trim();

        if (!value || value.length < 1 || value.length > 5) {
          return interaction.editReply({
            content: '❌ Please provide a valid prefix between 1 and 5 characters.',
            flags: 64
          });
        }

        try {
          guildSettings.updateSettings(interaction.guild.id, { prefix: value });
          return interaction.editReply({
            content: `✅ Command prefix updated to: \`${value}\``,
            flags: 64
          });
        } catch (error) {
          console.error('Error updating prefix:', error);
          return interaction.editReply({
            content: '❌ Failed to update command prefix.',
            flags: 64
          });
        }
      }

      if (subcommand === 'embedcolor') {
        const raw = interaction.options.getString('value') || '';
        let v = raw.trim();
        let colorNum = null;

        // Normalize
        let s = v.replace(/^#/,'');
        if (/^0x/i.test(s)) s = s.slice(2);

        if (/^[0-9a-fA-F]{6}$/.test(s)) {
          colorNum = parseInt(s, 16);
        } else {
          const asNum = Number(v);
          if (Number.isFinite(asNum) && asNum >= 0 && asNum <= 0xFFFFFF) {
            colorNum = Math.floor(asNum);
          }
        }

        if (colorNum === null) {
          return interaction.editReply({
            content: '❌ Please provide a valid color: #RRGGBB, RRGGBB, 0xRRGGBB, or a number 0-16777215.',
            flags: 64
          });
        }

        const normalized = '#' + colorNum.toString(16).padStart(6, '0').toLowerCase();
        
        try {
          guildSettings.updateSettings(interaction.guild.id, { embedColor: normalized });
          return interaction.editReply({
            content: `✅ Embed color updated to: \`${normalized}\`\nPreview: `,
            embeds: [{
              color: colorNum,
              description: 'This is how the embed will look with this color.'
            }],
            flags: 64
          });
        } catch (error) {
          console.error('Error updating embed color:', error);
          return interaction.editReply({
            content: '❌ Failed to update embed color.',
            flags: 64
          });
        }
      }

      if (subcommand === 'tickets') {
        const supportChannel = interaction.options.getChannel('support_channel');
        const supportRole = interaction.options.getRole('support_role');

        try {
          guildSettings.updateSettings(interaction.guild.id, {
            supportChannelId: supportChannel.id,
            supportRoleId: supportRole.id
          });

          return interaction.editReply({
            content: `✅ Ticket system configured!\n**Support Channel:** ${supportChannel}\n**Support Role:** ${supportRole}`,
            flags: 64
          });
        } catch (error) {
          console.error('Error setting up tickets:', error);
          return interaction.editReply({
            content: '❌ Failed to setup ticket system.',
            flags: 64
          });
        }
      }

    } catch (error) {
      console.error('Error in setup command:', error);
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({
          content: '❌ An error occurred while processing this command.',
          flags: 64
        });
      } else {
        await interaction.reply({
          content: '❌ An error occurred while processing this command.',
          flags: 64
        });
      }
    }
  },
};
