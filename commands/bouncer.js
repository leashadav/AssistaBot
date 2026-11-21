/**
 * @file Bouncer Command
 * @module commands/bouncer
 * @description This module handles the configuration of welcome and goodbye messages for the server.
 * It allows administrators to customize messages, channels, and enable/disable these features.
 * @requires discord.js
 * @requires ../modules/guildSettings
 * @requires ../modules/welcomeUtil
 */

const { randomUUID } = require('crypto');
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  StringSelectMenuBuilder,
  LabelBuilder,
  ModalBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');
const guildSettings = require('../modules/guildSettings');
const inviteTracker = require('../modules/inviteTracker');
const { renderTemplate, buildWelcomeEmbed, buildGoodbyeEmbed } = require('../modules/welcomeUtil');

const panelSessions = new Map();
const PANEL_TTL = 15 * 60 * 1000;
const PLACEHOLDERS = '{user}, {username}, {displayName}, {tag}, {id}, {mention}, {server}, {guild}, {memberCount}';
const PLACEHOLDER_GUIDE = [
  '**Available message placeholders**',
  '`{user}` / `{username}` — the member’s username.',
  '`{displayName}` — their server display name (nickname), or username if none.',
  '`{tag}` — their Discord user tag.',
  '`{id}` — their Discord user ID.',
  '`{mention}` — a mention of the member.',
  '`{server}` / `{guild}` — the server name.',
  '`{memberCount}` — the server’s current member count.'
].join('\n');

function buildPanel(session, notice = '') {
  const settings = guildSettings.getSettings(session.guildId)[session.mode];
  const modeLabel = session.mode === 'welcome' ? 'Welcome' : 'Goodbye';
  const summarize = value => {
    const text = value || 'Default';
    return text.length > 250 ? `${text.slice(0, 247)}...` : text;
  };
  return {
    content: [
      notice,
      `**${modeLabel} message settings**`,
      `Status: **${settings.enabled ? 'Enabled' : 'Disabled'}**`,
      `Channel: ${settings.channelId ? `<#${settings.channelId}>` : 'Not set'}`,
      `Title: ${summarize(settings.title)}`,
      `Description: ${summarize(settings.description)}`,
      `Content: ${summarize(settings.content)}`,
      '',
      `**Available placeholders:** ${PLACEHOLDERS}`,
      'Changes are saved immediately.'
    ].filter(Boolean).join('\n'),
    components: [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`bouncer:mode:${session.id}`)
          .setPlaceholder('Choose welcome or goodbye settings')
          .addOptions(
            { label: 'Welcome settings', value: 'welcome', default: session.mode === 'welcome' },
            { label: 'Goodbye settings', value: 'goodbye', default: session.mode === 'goodbye' }
          )
      ),
      new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(`bouncer:channel:${session.id}`)
          .setPlaceholder(`Choose ${modeLabel.toLowerCase()} channel`)
          .setMinValues(1)
          .setMaxValues(1)
          .addChannelTypes(
            ChannelType.GuildText,
            ChannelType.GuildAnnouncement,
            ChannelType.PublicThread,
            ChannelType.PrivateThread,
            ChannelType.AnnouncementThread
          )
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`bouncer:toggle:${session.id}`)
          .setLabel(settings.enabled ? `Disable ${modeLabel.toLowerCase()}` : `Enable ${modeLabel.toLowerCase()}`)
          .setStyle(settings.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`bouncer:edit:${session.id}`)
          .setLabel('Edit message')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`bouncer:test:${session.id}`)
          .setLabel('Send test')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(`bouncer:close:${session.id}`)
          .setLabel('Close')
          .setStyle(ButtonStyle.Secondary)
      )
    ]
  };
}

function validatePanel(interaction, sessionId) {
  const session = panelSessions.get(sessionId);
  if (!session || session.guildId !== interaction.guildId) {
    return { error: 'This settings panel expired. Run `/bouncer panel` again.' };
  }
  if (session.userId !== interaction.user.id) {
    return { error: 'Only the person who opened this panel can use it.' };
  }
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    return { error: 'You need Manage Server permission to change these settings.' };
  }
  return { session };
}

async function handleComponent(interaction) {
  const [, action, sessionId] = interaction.customId.split(':');
  const validation = validatePanel(interaction, sessionId);
  if (validation.error) {
    return interaction.reply({ content: validation.error, flags: MessageFlags.Ephemeral });
  }
  const { session } = validation;

  if (action === 'mode') {
    session.mode = interaction.values[0];
    return interaction.update(buildPanel(session));
  }
  if (action === 'channel') {
    guildSettings.updateSettings(session.guildId, {
      [session.mode]: { channelId: interaction.values[0] }
    });
    return interaction.update(buildPanel(session, '✅ Channel updated.'));
  }
  if (action === 'toggle') {
    const config = guildSettings.getSettings(session.guildId)[session.mode];
    guildSettings.updateSettings(session.guildId, {
      [session.mode]: { enabled: !config.enabled }
    });
    return interaction.update(buildPanel(session, `✅ ${session.mode === 'welcome' ? 'Welcome' : 'Goodbye'} messages ${config.enabled ? 'disabled' : 'enabled'}.`));
  }
  if (action === 'edit') {
    const config = guildSettings.getSettings(session.guildId)[session.mode];
    const modal = new ModalBuilder()
      .setCustomId(`bouncer:edit:${sessionId}`)
      .setTitle(`Edit ${session.mode} message`);
    const fields = [
      ['title', 'Embed title', config.title, 256],
      ['description', 'Embed description', config.description, 4000],
      ['content', 'Message outside embed', config.content, 2000]
    ].map(([id, label, value, maxLength]) => {
      const input = new TextInputBuilder()
        .setCustomId(id)
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setMaxLength(maxLength);
      if (value) input.setValue(value);
      return new LabelBuilder()
        .setLabel(label)
        .setTextInputComponent(input);
    });
    return interaction.showModal(
      modal
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(PLACEHOLDER_GUIDE))
        .addLabelComponents(...fields)
    );
  }
  if (action === 'test') {
    const options = {
      getSubcommand: () => session.mode === 'welcome' ? 'welcometest' : 'goodbyetest',
      getUser: () => null,
      getMember: () => null
    };
    const testInteraction = new Proxy(interaction, {
      get(target, property) {
        if (property === 'options') return options;
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      }
    });
    return (module.exports._originalExecute || module.exports.execute)(testInteraction);
  }
  if (action === 'close') {
    clearTimeout(session.timeout);
    panelSessions.delete(sessionId);
    return interaction.update({ content: 'Welcome/goodbye settings panel closed.', components: [] });
  }
  return interaction.reply({ content: 'This settings action is not recognized.', flags: MessageFlags.Ephemeral });
}

async function handleModal(interaction) {
  const [, action, sessionId] = interaction.customId.split(':');
  if (action !== 'edit') return;
  const validation = validatePanel(interaction, sessionId);
  if (validation.error) {
    return interaction.reply({ content: validation.error, flags: MessageFlags.Ephemeral });
  }
  const { session } = validation;
  const config = guildSettings.getSettings(session.guildId)[session.mode];
  const updated = {};
  for (const key of ['title', 'description', 'content']) {
    const value = interaction.fields.getTextInputValue(key).trim();
    updated[key] = value || null;
  }
  guildSettings.updateSettings(session.guildId, { [session.mode]: { ...config, ...updated } });
  return interaction.update(buildPanel(session, '✅ Message template updated.'));
}

/**
 * Command data and execution logic for the 'bouncer' command.
 * @type {Object}
 * @property {SlashCommandBuilder} data - The command definition.
 * @property {Function} execute - The command execution function.
 */
module.exports = {
  /**
   * Command configuration and options.
   * @type {SlashCommandBuilder}
   */
  data: new SlashCommandBuilder()
    .setName('bouncer')
    .setDescription('Configure welcome and goodbye messages for your server')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(subcommand =>
      subcommand.setName('panel')
        .setDescription('Open interactive welcome and goodbye settings'))
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
            .setDescription('Channel to send welcome messages')
            .setRequired(true)
            .addChannelTypes(
              ChannelType.GuildText,
              ChannelType.GuildAnnouncement,
              ChannelType.PublicThread,
              ChannelType.PrivateThread,
              ChannelType.AnnouncementThread
            ))
        .addStringOption(option =>
          option.setName('description')
            .setDescription('Embed description, e.g. Please read the rules'))
        .addStringOption(option =>
          option.setName('title')
            .setDescription('Embed title, e.g. Welcome {displayName}!'))
        .addStringOption(option =>
          option.setName('content')
            .setDescription('Outside-embed content, e.g. Welcome {mention})')))
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
          option.setName('description')
            .setDescription('Embed description, e.g. Oh no they left'))
        .addStringOption(option =>
          option.setName('title')
            .setDescription('Embed title, e.g. Goodbye {displayName}!'))
        .addStringOption(option =>
          option.setName('content')
            .setDescription('Outside-embed content e.g. {mention} has left.')))
    .addSubcommand(sub =>
      sub.setName('welcometest')
        .setDescription('Send a test welcome message')
        .addUserOption(option =>
          option.setName('user')
            .setDescription('User to test the welcome message for')))
    .addSubcommand(sub =>
      sub.setName('goodbyetest')
        .setDescription('Send a test goodbye message')
        .addUserOption(option =>
          option.setName('user')
            .setDescription('User to test the goodbye message for'))),

  /**
   * Executes the bouncer command with the specified subcommand.
   * @async
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction that triggered the command.
   * @returns {Promise<void>}
   * @throws {Error} If there's an error executing the command.
   */
  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
    }
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'panel') {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ content: '❌ You do not have permission.', flags: MessageFlags.Ephemeral });
      }
      const id = randomUUID();
      const session = { id, guildId: interaction.guild.id, userId: interaction.user.id, mode: 'welcome' };
      session.timeout = setTimeout(() => panelSessions.delete(id), PANEL_TTL);
      session.timeout.unref?.();
      panelSessions.set(id, session);
      return interaction.reply({ ...buildPanel(session), flags: MessageFlags.Ephemeral });
    }

    if (subcommand === 'welcome') {
      try {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      } catch (error) {
        if (error.code === 10062) {
          console.error('Interaction expired - user may have taken too long to respond');
          return;
        }
        throw error;
      }
      const enabled = interaction.options.getBoolean('enabled');
      const channel = interaction.options.getChannel('channel');
      const description = interaction.options.getString('description');
      const title = interaction.options.getString('title');
      const content = interaction.options.getString('content');

      const patch = {
        welcome: {
          enabled: !!enabled,
          channelId: channel ? channel.id : null,
          description: description && description.trim() ? description.trim() : undefined,
          title: title && title.trim() ? title.trim() : undefined,
          content: content && content.trim() ? content.trim() : undefined
        }
      };
      if (patch.welcome.description === undefined) delete patch.welcome.description;
      if (patch.welcome.title === undefined) delete patch.welcome.title;
      if (patch.welcome.content === undefined) delete patch.welcome.content;

      guildSettings.updateSettings(interaction.guild.id, patch);

      return await interaction.editReply({
        content: 'Welcome settings updated.'
      });
    }

    if (subcommand === 'goodbye') {
      try {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      } catch (error) {
        if (error.code === 10062) {
          console.error('Interaction expired - user may have taken too long to respond');
          return;
        }
        throw error;
      }
      const enabled = interaction.options.getBoolean('enabled');
      const channel = interaction.options.getChannel('channel');
      const description = interaction.options.getString('description');
      const title = interaction.options.getString('title');
      const content = interaction.options.getString('content');

      const patch = {
        goodbye: {
          enabled: !!enabled,
          channelId: channel ? channel.id : null,
          description: description && description.trim() ? description.trim() : undefined,
          title: title && title.trim() ? title.trim() : undefined,
          content: content && content.trim() ? content.trim() : undefined
        }
      };
      if (patch.goodbye.description === undefined) delete patch.goodbye.description;
      if (patch.goodbye.title === undefined) delete patch.goodbye.title;
      if (patch.goodbye.content === undefined) delete patch.goodbye.content;

      guildSettings.updateSettings(interaction.guild.id, patch);

      return await interaction.editReply({
        content: 'Goodbye settings updated.'
      });
    }

    if (subcommand === 'welcometest') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ content: '❌ You do not have permission.', flags: MessageFlags.Ephemeral });
      }

      try {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      } catch (error) {
        if (error.code === 10062) {
          console.error('Interaction expired - user may have taken too long to respond');
          return;
        }
        throw error;
      }

      const gs = guildSettings.getSettings(interaction.guild.id);
      const welcome = gs && gs.welcome;
      if (!welcome || !welcome.channelId) {
        return interaction.editReply('Welcome is not configured. Set a channel first.');
      }

      const g = interaction.guild;
      let targetUser = interaction.options.getUser('user') || interaction.user;
      const targetMember = interaction.options.getMember('user') || interaction.member;
      
      // Fetch full user object to ensure flags, ageGroup, and verified status are populated
      try {
        targetUser = await interaction.client.users.fetch(targetUser.id, { force: true });
      } catch (e) {
        // Continue with what we have if fetch fails
      }
      
      const tpl = (welcome && welcome.description) ?? guildSettings.defaultSettings.welcome.description;
      const titleTpl = (welcome && welcome.title) ?? guildSettings.defaultSettings.welcome.title;
      const memberDisplayName = targetMember?.displayName || targetUser.username;
      const msg = renderTemplate(tpl, g, targetUser, memberDisplayName);
      const title = renderTemplate(titleTpl, g, targetUser, memberDisplayName);
      const contentTpl = welcome && welcome.content ? welcome.content : null;
      const content = contentTpl ? renderTemplate(contentTpl, g, targetUser, memberDisplayName) : undefined;
      
      // Fetch inviter information
      let inviterInfo = null;
      try {
        const inviterId = inviteTracker.getInviterForMember(g.id, targetUser.id);
        if (inviterId) {
          const inviterUser = await interaction.client.users.fetch(inviterId);
          if (inviterUser) {
            inviterInfo = inviterUser;
          }
        }
      } catch (e) {
        // Silently fail if inviter fetch fails
      }
      
      const embed = buildWelcomeEmbed({ guild: g, user: targetUser, description: msg, title: title, embedColor: gs.embedColor, inviter: inviterInfo });

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

      return interaction.editReply(`Welcome test sent (${results.join(', ') || 'none'}).`);
    }

    if (subcommand === 'goodbyetest') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ content: '❌ You do not have permission.', flags: MessageFlags.Ephemeral });
      }

      try {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      } catch (error) {
        if (error.code === 10062) {
          console.error('Interaction expired - user may have taken too long to respond');
          return;
        }
        throw error;
      }

      const gs = guildSettings.getSettings(interaction.guild.id);
      const gb = gs && gs.goodbye;
      if (!gb || !gb.enabled) {
        return interaction.editReply('Goodbye is not enabled. Configure it with /bouncer goodbye first.');
      }

      const targetId = gb.channelId;
      const g = interaction.guild;
      let targetUser = interaction.options.getUser('user') || interaction.user;
      const targetMember = interaction.options.getMember('user') || interaction.member;
      
      // Fetch full user object to ensure flags, ageGroup, and verified status are populated
      try {
        targetUser = await interaction.client.users.fetch(targetUser.id, { force: true });
      } catch (e) {
        // Continue with what we have if fetch fails
      }
      
      const tpl = (gb && gb.description) ?? guildSettings.defaultSettings.goodbye.description;
      const titleTpl = (gb && gb.title) ?? guildSettings.defaultSettings.goodbye.title;
      const memberDisplayName = targetMember?.displayName || targetUser.username;
      const msg = renderTemplate(tpl, g, targetUser, memberDisplayName);
      const title = renderTemplate(titleTpl, g, targetUser, memberDisplayName);
      const contentTpl = gb && gb.content ? gb.content : null;
      const content = contentTpl ? renderTemplate(contentTpl, g, targetUser, memberDisplayName) : undefined;
      
      // Fetch inviter information
      let inviterInfo = null;
      try {
        const inviterId = inviteTracker.getInviterForMember(g.id, targetUser.id);
        if (inviterId) {
          const inviterUser = await interaction.client.users.fetch(inviterId);
          if (inviterUser) {
            inviterInfo = inviterUser;
          }
        }
      } catch (e) {
        // Silently fail if inviter fetch fails
      }
      
      const embed = buildGoodbyeEmbed({ guild: g, user: targetUser, member: targetMember, description: msg, title: title, embedColor: gs.embedColor, inviter: inviterInfo, leaveType: 'Left' });

      try {
        const ch = interaction.client.channels.cache.get(targetId) || await interaction.client.channels.fetch(targetId);
        if (ch && ch.send) await ch.send({ content, embeds: [embed] });
      } catch (e) {
        return interaction.editReply('Failed to send goodbye test (check my channel permissions).');
      }

      return interaction.editReply('Goodbye test sent.');
    }
  },
  handleComponent,
  handleModal
};