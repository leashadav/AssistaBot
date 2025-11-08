const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const guildSettings = require('../modules/guildSettings');
const { renderTemplate, buildWelcomeEmbed, buildGoodbyeEmbed } = require('../modules/welcomeUtil');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('bouncer')
    .setDescription('Welcome and Goodbye configuration and tests')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(subcommand =>
      subcommand
        .setName('welcome')
        .setDescription('Configure welcome settings')
        .addBooleanOption(option =>
          option.setName('enabled')
            .setDescription('Enable welcome messages')
            .setRequired(true))
        .addChannelOption(option =>
          option.setName('channel')
            .setDescription('Channel to send welcome messages (optional if DM enabled)')
            .addChannelTypes(
              ChannelType.GuildText,
              ChannelType.GuildAnnouncement,
              ChannelType.PublicThread,
              ChannelType.PrivateThread,
              ChannelType.AnnouncementThread
            ))
        .addBooleanOption(option =>
          option.setName('dm')
            .setDescription('Also send a DM to the new member'))
        .addStringOption(option =>
          option.setName('message')
            .setDescription('Embed description template, e.g. "Welcome {displayName}\nto {server}!"'))
        .addStringOption(option =>
          option.setName('content')
            .setDescription('Outside-embed content template (e.g. {mention} or rules link)')))
    .addSubcommand(subcommand =>
      subcommand
        .setName('goodbye')
        .setDescription('Configure goodbye (leave) settings')
        .addBooleanOption(option =>
          option.setName('enabled')
            .setDescription('Enable goodbye messages')
            .setRequired(true))
        .addChannelOption(option =>
          option.setName('channel')
            .setDescription('Channel to send goodbye messages'))
        .addStringOption(option =>
          option.setName('message')
            .setDescription('Template, e.g. "Goodbye {displayName}\nwe will miss you."'))
        .addStringOption(option =>
          option.setName('content')
            .setDescription('Outside-embed content template (e.g. {displayName} has left.)')))
    .addSubcommand(sub =>
      sub.setName('welcometest')
        .setDescription('Send a test welcome message using current settings'))
    .addSubcommand(sub =>
      sub.setName('goodbyetest')
        .setDescription('Send a test goodbye message using current settings')),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: 'This command can only be used in a server.', flags: 64 });
    }
    const sub = interaction.options.getSubcommand();

    if (sub === 'welcome') {
      await interaction.deferReply({ flags: 64 });
      const enabled = interaction.options.getBoolean('enabled');
      const channel = interaction.options.getChannel('channel');
      const dm = interaction.options.getBoolean('dm');
      const message = interaction.options.getString('message');
      const content = interaction.options.getString('content');

      const patch = {
        welcome: {
          enabled: !!enabled,
          channelId: channel ? channel.id : (dm ? null : null),
          dm: !!dm,
          message: message && message.trim() ? message.trim() : undefined,
          content: content && content.trim() ? content.trim() : undefined
        }
      };
      if (patch.welcome.message === undefined) delete patch.welcome.message;
      if (patch.welcome.content === undefined) delete patch.welcome.content;

      guildSettings.updateSettings(interaction.guild.id, patch);

      return await interaction.editReply({
        content: 'Welcome settings updated.'
      });
    }

    if (sub === 'goodbye') {
      await interaction.deferReply({ flags: 64 });
      const enabled = interaction.options.getBoolean('enabled');
      const channel = interaction.options.getChannel('channel');
      const message = interaction.options.getString('message');
      const content = interaction.options.getString('content');

      const patch = {
        goodbye: {
          enabled: !!enabled,
          channelId: channel ? channel.id : null,
          message: message && message.trim() ? message.trim() : undefined,
          content: content && content.trim() ? content.trim() : undefined
        }
      };
      if (patch.goodbye.message === undefined) delete patch.goodbye.message;
      if (patch.goodbye.content === undefined) delete patch.goodbye.content;

      guildSettings.updateSettings(interaction.guild.id, patch);

      return await interaction.editReply({
        content: 'Goodbye settings updated.'
      });
    }

    if (sub === 'welcometest') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ content: '❌ You do not have permission.', flags: 64 });
      }

      await interaction.deferReply({ flags: 64 });

      const gs = guildSettings.getSettings(interaction.guild.id);
      const welcome = gs && gs.welcome;
      if (!welcome || (!welcome.channelId && !welcome.dm)) {
        return interaction.editReply('Welcome is not configured. Set a channel and/or enable DM first.');
      }

      const g = interaction.guild;
      const u = interaction.user;
      const tpl = (welcome && welcome.message) ?? guildSettings.defaultSettings.welcome.message;
      const memberDisplayName = interaction.member?.displayName || u.username;
      const msg = renderTemplate(tpl, g, u, memberDisplayName);
      const contentTpl = welcome && welcome.content ? welcome.content : null;
      const content = contentTpl ? renderTemplate(contentTpl, g, u, memberDisplayName) : undefined;
      const embed = buildWelcomeEmbed({ guild: g, user: u, message: msg, embedColor: gs.embedColor });

      const results = [];
      if (welcome.channelId) {
        try {
          const ch = interaction.client.channels.cache.get(welcome.channelId) || await interaction.client.channels.fetch(welcome.channelId);
          if (ch && ch.send) {
            await ch.send({ content, embeds: [embed] });
            results.push('channel');
          }
        } catch (e) {
          results.push('channel failed');
        }
      }
      if (welcome.dm) {
        try {
          await interaction.user.send({ content, embeds: [embed] });
          results.push('dm');
        } catch (e) {
          results.push('dm failed');
        }
      }

      return interaction.editReply(`Welcome test sent (${results.join(', ') || 'none'}).`);
    }

    if (sub === 'goodbyetest') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ content: '❌ You do not have permission.', flags: 64 });
      }

      await interaction.deferReply({ flags: 64 });

      const gs = guildSettings.getSettings(interaction.guild.id);
      const gb = gs && gs.goodbye;
      if (!gb || !gb.enabled) {
        return interaction.editReply('Goodbye is not enabled. Configure it with /bouncer goodbye first.');
      }
      const targetId = gb.channelId || (gs.welcome && gs.welcome.channelId);
      if (!targetId) {
        return interaction.editReply('No goodbye channel set. Configure /bouncer goodbye channel.');
      }

      const g = interaction.guild;
      const u = interaction.user;
      const tpl = (gb && gb.message) ?? guildSettings.defaultSettings.goodbye.message;
      const memberDisplayName = interaction.member?.displayName || u.username;
      const msg = renderTemplate(tpl, g, u, memberDisplayName);
      const embed = buildGoodbyeEmbed({ guild: g, user: u, message: msg, embedColor: gs.embedColor });

      try {
        const ch = interaction.client.channels.cache.get(targetId) || await interaction.client.channels.fetch(targetId);
        if (ch && ch.send) await ch.send({ embeds: [embed] });
      } catch (e) {
        return interaction.editReply('Failed to send goodbye test (check my channel permissions).');
      }

      return interaction.editReply('Goodbye test sent.');
    }
  },
};