const { randomUUID } = require('crypto');
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');
const guildSettings = require('../modules/guildSettings');
const { renderTemplate, buildGoodbyeEmbed } = require('../modules/welcomeUtil');
const customCommands = require('../modules/customCommands');

const JOIN_ROLE_CATEGORIES = {
  members: 'Members',
  bots: 'Bots',
  suspicious: 'Suspicious/spam accounts'
};

const SETUP_SESSION_TTL = 14 * 60 * 1000;
const setupSessions = new Map();
const LOG_CHANNEL_TYPES = [
  { label: 'Message Delete', value: 'messageDelete' },
  { label: 'Message Update', value: 'messageUpdate' },
  { label: 'Member Join', value: 'memberJoin' },
  { label: 'Member Leave', value: 'memberLeave' },
  { label: 'Member Ban', value: 'memberBan' },
  { label: 'Member Kick', value: 'memberKick' },
  { label: 'Member Warning', value: 'memberWarn' },
  { label: 'Moderation', value: 'moderationLog' },
  { label: 'Ticket Created', value: 'ticketCreated' },
  { label: 'Ticket Closed', value: 'ticketClosed' },
  { label: 'General', value: 'generalLog' },
  { label: 'Invite', value: 'inviteLog' },
  { label: 'AssistaBot Say', value: 'assistabotsayLog' },
  { label: 'AssistaBot', value: 'assistabotLogging' }
];

function customId(session, action) {
  return `setup:${session.id}:${action}`;
}

function setupButton(session, action, label, style = ButtonStyle.Secondary) {
  return new ButtonBuilder()
    .setCustomId(customId(session, action))
    .setLabel(label)
    .setStyle(style);
}

function setupSelect(session, action, placeholder, options) {
  return new StringSelectMenuBuilder()
    .setCustomId(customId(session, action))
    .setPlaceholder(placeholder)
    .addOptions(options);
}

function buildMainPanel(session) {
  return {
    content: [
      '**Server setup**',
      'Choose a setting to configure or view. Changes are saved as you complete each step.',
      'This panel is private and only you can use it.'
    ].join('\n'),
    components: [
      new ActionRowBuilder().addComponents(setupSelect(session, 'section', 'Choose a setup area', [
        { label: 'View current settings', value: 'show', description: 'Review this server’s current configuration' },
        { label: 'Logging channel', value: 'logchannel', description: 'Choose a log type and destination channel' },
        { label: 'Log exclusions', value: 'logignore', description: 'Ignore a channel, role, or user in message logs' },
        { label: 'Command prefix', value: 'prefix', description: 'Change the legacy text-command prefix' },
        { label: 'Embed color', value: 'embedcolor', description: 'Choose the color used by embeds' },
        { label: 'Ticket system', value: 'tickets', description: 'Set the support channel and staff role' },
        { label: 'Brain role', value: 'brainrole', description: 'Configure brain role announcements' },
        { label: 'Join roles', value: 'joinrole', description: 'Configure roles assigned to new members or bots' }
      ])),
      new ActionRowBuilder().addComponents(
        setupButton(session, 'close', 'Close', ButtonStyle.Danger)
      )
    ]
  };
}

function buildBackRow(session) {
  return new ActionRowBuilder().addComponents(
    setupButton(session, 'home', 'Back to setup'),
    setupButton(session, 'close', 'Close', ButtonStyle.Danger)
  );
}

function buildJoinRolePanel(guild, joinRoles, state, session) {
  const categoryRoles = joinRoles[state.category] || [];
  const roleList = categoryRoles.length
    ? categoryRoles.map(roleId => {
      const role = guild.roles.cache.get(roleId);
      return role ? `<@&${roleId}>` : `Unknown role (${roleId})`;
    }).join(', ')
    : 'None';
  const content = [
    '**Join Role Setup**',
    `Status: **${joinRoles.enabled ? 'Enabled' : 'Disabled'}**`,
    `Category: **${JOIN_ROLE_CATEGORIES[state.category]}**`,
    `Configured roles: ${roleList}`,
    `Picker mode: **${state.mode === 'add' ? 'Add roles' : 'Remove roles from this list'}**`,
    '',
    'Choose a category and action, then select one or more roles. Changes apply to the configured list only.'
  ].join('\n');

  const statusRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(customId(session, 'joinrole_enable'))
      .setLabel('Enable')
      .setStyle(ButtonStyle.Success)
      .setDisabled(joinRoles.enabled),
    new ButtonBuilder()
      .setCustomId(customId(session, 'joinrole_disable'))
      .setLabel('Disable')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!joinRoles.enabled),
    new ButtonBuilder()
      .setCustomId(customId(session, 'home'))
      .setLabel('Back to setup')
      .setStyle(ButtonStyle.Secondary)
  );
  const categoryRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(customId(session, 'joinrole_category'))
      .setPlaceholder('Choose a role category')
      .addOptions(
        { label: 'Member roles', value: 'members', default: state.category === 'members' },
        { label: 'Bot roles', value: 'bots', default: state.category === 'bots' },
        { label: 'Suspicious/spam account roles', value: 'suspicious', default: state.category === 'suspicious' }
      )
  );
  const modeRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(customId(session, 'joinrole_mode_add'))
      .setLabel('Add roles')
      .setStyle(state.mode === 'add' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(customId(session, 'joinrole_mode_remove'))
      .setLabel('Remove roles from list')
      .setStyle(state.mode === 'remove' ? ButtonStyle.Primary : ButtonStyle.Secondary)
  );
  const roleRow = new ActionRowBuilder().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId(customId(session, 'joinrole_roles'))
      .setPlaceholder(state.mode === 'add' ? 'Select roles to add' : 'Select roles to remove from list')
      .setMinValues(1)
      .setMaxValues(25)
  );

  return { content, components: [statusRow, categoryRow, modeRow, roleRow] };
}

function clearSetupSession(id) {
  const session = setupSessions.get(id);
  if (session?.timeout) clearTimeout(session.timeout);
  setupSessions.delete(id);
}

function validateSetupSession(interaction, id) {
  const session = setupSessions.get(id);
  if (!session) return { error: 'This setup panel expired. Run `/setup panel` again.' };
  if (session.userId !== interaction.user.id || session.guildId !== interaction.guildId) {
    return { error: 'Only the administrator who opened this panel can use it.' };
  }
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    return { error: 'Administrator permission is required to change server settings.' };
  }
  return { session };
}

function createSetupSession(interaction) {
  const id = randomUUID();
  const settings = guildSettings.getSettings(interaction.guildId);
  const session = {
    id,
    userId: interaction.user.id,
    guildId: interaction.guildId,
    category: 'members',
    mode: 'add',
    section: null,
    logType: null,
    ignoreType: null,
    ignoreMode: 'add',
    ticketChannelId: null,
    ticketRoleId: null,
    brainRoleId: customCommands.getBrainRole(interaction.guildId) || null,
    brainChannelId: settings.brain?.channelId || null,
    brainMessage: settings.brain?.message || null
  };
  session.timeout = setTimeout(async () => {
    clearSetupSession(id);
    try {
      await interaction.editReply({ content: 'Setup panel expired. Run `/setup panel` to open a new one.', components: [] });
    } catch (error) {
      if (error.code !== 50027) {
        console.error('Failed to close expired setup panel:', error.message || error);
      }
    }
  }, SETUP_SESSION_TTL);
  session.timeout.unref?.();
  setupSessions.set(id, session);
  return session;
}

function buildSettingsSummary(settings, guildId) {
  const brainRoleId = customCommands.getBrainRole(guildId);
  return {
    content: [
      '**Current server settings**',
      `Command prefix: \`${settings.prefix || '!'}\``,
      `Embed color: \`${settings.embedColor || 'Not set'}\``,
      `Support channel: ${settings.supportChannelId ? `<#${settings.supportChannelId}>` : 'Not set'}`,
      `Support role: ${settings.supportRoleId ? `<@&${settings.supportRoleId}>` : 'Not set'}`,
      `Join roles: **${settings.joinRoles?.enabled ? 'Enabled' : 'Disabled'}**`,
      `Brain role: ${brainRoleId ? `<@&${brainRoleId}>` : 'Not set'}`,
      `Brain announcement channel: ${settings.brain?.channelId ? `<#${settings.brain.channelId}>` : 'Not set'}`,
      '',
      '**Log channels**',
      ...Object.entries(settings.logChannels || {}).map(([type, channelId]) =>
        `• ${type}: ${channelId ? `<#${channelId}>` : 'Not set'}`
      ),
      '',
      '**Message-log exclusions**',
      `Channels: ${settings.messageLogIgnores?.channels?.length || 0}`,
      `Roles: ${settings.messageLogIgnores?.roles?.length || 0}`,
      `Users: ${settings.messageLogIgnores?.users?.length || 0}`
    ].join('\n')
  };
}

function buildLogTypePanel(session) {
  return {
    content: '**Choose a log type**',
    components: [
      new ActionRowBuilder().addComponents(setupSelect(
        session,
        'logtype',
        'Select the log event',
        LOG_CHANNEL_TYPES.map(item => ({ label: item.label, value: item.value }))
      )),
      buildBackRow(session)
    ]
  };
}

function buildLogChannelPanel(session) {
  return {
    content: `Choose the destination channel for **${session.logType}** logs.`,
    components: [
      new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(customId(session, 'logchannel'))
          .setPlaceholder('Select a text channel or thread')
          .addChannelTypes(
            ChannelType.GuildText,
            ChannelType.GuildAnnouncement,
            ChannelType.PublicThread,
            ChannelType.PrivateThread,
            ChannelType.AnnouncementThread
          )
      ),
      buildBackRow(session)
    ]
  };
}

function buildLogIgnorePanel(session) {
  return {
    content: 'Choose what to ignore in message logs, then select whether to add or remove it.',
    components: [
      new ActionRowBuilder().addComponents(setupSelect(session, 'ignoretype', 'Choose an exclusion type', [
        { label: 'Channel', value: 'channels' },
        { label: 'Role', value: 'roles' },
        { label: 'User', value: 'users' }
      ])),
      new ActionRowBuilder().addComponents(
        setupButton(session, 'ignoremode:add', 'Add exclusion', ButtonStyle.Success),
        setupButton(session, 'ignoremode:remove', 'Remove exclusion', ButtonStyle.Danger)
      ),
      buildBackRow(session)
    ]
  };
}

function buildIgnoreTargetPanel(session) {
  let selector;
  if (session.ignoreType === 'channels') {
    selector = new ChannelSelectMenuBuilder()
      .setCustomId(customId(session, 'ignoretarget'))
      .setPlaceholder('Select a channel')
      .addChannelTypes(
        ChannelType.GuildText,
        ChannelType.GuildAnnouncement,
        ChannelType.PublicThread,
        ChannelType.PrivateThread,
        ChannelType.AnnouncementThread
      );
  } else if (session.ignoreType === 'roles') {
    selector = new RoleSelectMenuBuilder()
      .setCustomId(customId(session, 'ignoretarget'))
      .setPlaceholder('Select a role');
  } else {
    const { UserSelectMenuBuilder } = require('discord.js');
    selector = new UserSelectMenuBuilder()
      .setCustomId(customId(session, 'ignoretarget'))
      .setPlaceholder('Select a user');
  }

  return {
    content: `Select a ${session.ignoreType.slice(0, -1)} to ${session.ignoreMode} in message logs.`,
    components: [
      new ActionRowBuilder().addComponents(selector),
      buildBackRow(session)
    ]
  };
}

function createSetupModal(session, type) {
  const isPrefix = type === 'prefix';
  const modal = new ModalBuilder()
    .setCustomId(customId(session, `modal:${type}`))
    .setTitle(isPrefix ? 'Set command prefix' : type === 'embedcolor' ? 'Set embed color' : 'Set brain announcement');
  const fields = isPrefix
    ? [{ id: 'value', label: 'Prefix (1-5 characters)', value: '', required: true, max: 5, style: TextInputStyle.Short }]
    : type === 'embedcolor'
      ? [{ id: 'value', label: 'Color (#RRGGBB or 0-16777215)', value: '', required: true, max: 10, style: TextInputStyle.Short }]
      : [{ id: 'message', label: 'Message template (use {USER})', value: session.brainMessage || '', required: true, max: 1000, style: TextInputStyle.Paragraph }];

  for (const field of fields) {
    const input = new TextInputBuilder()
      .setCustomId(field.id)
      .setLabel(field.label)
      .setStyle(field.style)
      .setRequired(field.required)
      .setMaxLength(field.max);
    if (field.value) input.setValue(field.value);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
  }
  return modal;
}

function buildTicketsPanel(session) {
  const channelSelector = new ChannelSelectMenuBuilder()
    .setCustomId(customId(session, 'ticket_channel'))
    .setPlaceholder('Choose the support channel')
    .addChannelTypes(ChannelType.GuildText);
  const roleSelector = new RoleSelectMenuBuilder()
    .setCustomId(customId(session, 'ticket_role'))
    .setPlaceholder('Choose the support staff role');
  return {
    content: [
      '**Ticket system setup**',
      `Support channel: ${session.ticketChannelId ? `<#${session.ticketChannelId}>` : 'Not selected'}`,
      `Support role: ${session.ticketRoleId ? `<@&${session.ticketRoleId}>` : 'Not selected'}`,
      'Select both, then save.'
    ].join('\n'),
    components: [
      new ActionRowBuilder().addComponents(channelSelector),
      new ActionRowBuilder().addComponents(roleSelector),
      new ActionRowBuilder().addComponents(
        setupButton(session, 'tickets:save', 'Save ticket settings', ButtonStyle.Success),
        setupButton(session, 'home', 'Back to setup')
      )
    ]
  };
}

function buildBrainRolePanel(session) {
  const roleSelector = new RoleSelectMenuBuilder()
    .setCustomId(customId(session, 'brain_role'))
    .setPlaceholder('Select the brain role');
  const channelSelector = new ChannelSelectMenuBuilder()
    .setCustomId(customId(session, 'brain_channel'))
    .setPlaceholder('Select announcement channel')
    .addChannelTypes(ChannelType.GuildText);
  return {
    content: [
      '**Brain role setup**',
      `Role: ${session.brainRoleId ? `<@&${session.brainRoleId}>` : 'Not selected'}`,
      `Announcement channel: ${session.brainChannelId ? `<#${session.brainChannelId}>` : 'Not selected'}`,
      `Announcement message: ${session.brainMessage ? 'Custom message set' : 'Use current message'}`,
      'Select the role and/or channel, optionally edit the message, then save.'
    ].join('\n'),
    components: [
      new ActionRowBuilder().addComponents(roleSelector),
      new ActionRowBuilder().addComponents(channelSelector),
      new ActionRowBuilder().addComponents(
        setupButton(session, 'brain_message', 'Edit announcement message'),
        setupButton(session, 'brain_save', 'Save changes', ButtonStyle.Success),
        setupButton(session, 'brain_disable', 'Disable brain role', ButtonStyle.Danger)
      ),
      buildBackRow(session)
    ]
  };
}

async function handleSetupComponent(interaction) {
  const [, sessionId, ...actionParts] = interaction.customId.split(':');
  const action = actionParts.join(':');
  const validation = validateSetupSession(interaction, sessionId);
  if (validation.error) {
    return interaction.reply({ content: validation.error, flags: MessageFlags.Ephemeral });
  }
  const { session } = validation;

  if (action === 'close') {
    clearSetupSession(sessionId);
    return interaction.update({ content: 'Setup panel closed.', components: [] });
  }
  if (action === 'home') {
    session.section = null;
    return interaction.update(buildMainPanel(session));
  }

  if (action === 'section') {
    const section = interaction.values[0];
    session.section = section;
    if (section === 'show') {
      const summary = buildSettingsSummary(guildSettings.getSettings(session.guildId), session.guildId);
      return interaction.update({
        ...summary,
        components: [buildBackRow(session)]
      });
    }
    if (section === 'logchannel') return interaction.update(buildLogTypePanel(session));
    if (section === 'logignore') return interaction.update(buildLogIgnorePanel(session));
    if (section === 'prefix' || section === 'embedcolor') {
      return interaction.showModal(createSetupModal(session, section));
    }
    if (section === 'tickets') return interaction.update(buildTicketsPanel(session));
    if (section === 'brainrole') return interaction.update(buildBrainRolePanel(session));
    if (section === 'joinrole') {
      session.category = 'members';
      session.mode = 'add';
      const joinRoles = guildSettings.getSettings(session.guildId).joinRoles;
      return interaction.update(buildJoinRolePanel(interaction.guild, joinRoles, session, session));
    }
  }

  if (action === 'logtype') {
    session.logType = interaction.values[0];
    return interaction.update(buildLogChannelPanel(session));
  }
  if (action === 'logchannel') {
    const channelId = interaction.values[0];
    guildSettings.setLogChannel(session.guildId, session.logType, channelId);
    return interaction.update({
      content: `✅ Set **${session.logType}** log channel to <#${channelId}>.`,
      components: [buildBackRow(session)]
    });
  }

  if (action === 'ignoretype') {
    session.ignoreType = interaction.values[0];
    return interaction.update(buildIgnoreTargetPanel(session));
  }
  if (action.startsWith('ignoremode:')) {
    session.ignoreMode = action.split(':')[1];
    return interaction.update(
      session.ignoreType ? buildIgnoreTargetPanel(session) : buildLogIgnorePanel(session)
    );
  }
  if (action === 'ignoretarget') {
    const targetId = interaction.values[0];
    const current = guildSettings.getSettings(session.guildId).messageLogIgnores || {};
    const updated = {
      channels: [...(current.channels || [])],
      roles: [...(current.roles || [])],
      users: [...(current.users || [])]
    };
    const ids = updated[session.ignoreType];
    if (session.ignoreMode === 'remove') {
      updated[session.ignoreType] = ids.filter(id => id !== targetId);
    } else if (!ids.includes(targetId)) {
      ids.push(targetId);
    }
    guildSettings.updateSettings(session.guildId, { messageLogIgnores: updated });
    const target = session.ignoreType === 'channels'
      ? `<#${targetId}>`
      : session.ignoreType === 'roles' ? `<@&${targetId}>` : `<@${targetId}>`;
    return interaction.update({
      content: session.ignoreMode === 'remove'
        ? `✅ Removed ${target} from message log exclusions.`
        : `✅ Added ${target} to message log exclusions.`,
      components: [buildBackRow(session)]
    });
  }

  if (action === 'ticket_channel') {
    session.ticketChannelId = interaction.values[0];
    return interaction.update(buildTicketsPanel(session));
  }
  if (action === 'ticket_role') {
    session.ticketRoleId = interaction.values[0];
    return interaction.update(buildTicketsPanel(session));
  }
  if (action === 'tickets:save') {
    if (!session.ticketChannelId || !session.ticketRoleId) {
      return interaction.reply({
        content: 'Select both a support channel and a support role before saving.',
        flags: MessageFlags.Ephemeral
      });
    }
    guildSettings.updateSettings(session.guildId, {
      supportChannelId: session.ticketChannelId,
      supportRoleId: session.ticketRoleId
    });
    return interaction.update({
      content: `✅ Ticket system configured.\n**Support channel:** <#${session.ticketChannelId}>\n**Support role:** <@&${session.ticketRoleId}>`,
      components: [buildBackRow(session)]
    });
  }

  if (action === 'brain_role') {
    session.brainRoleId = interaction.values[0];
    return interaction.update(buildBrainRolePanel(session));
  }
  if (action === 'brain_channel') {
    session.brainChannelId = interaction.values[0];
    return interaction.update(buildBrainRolePanel(session));
  }
  if (action === 'brain_message') {
    return interaction.showModal(createSetupModal(session, 'brainmessage'));
  }
  if (action === 'brain_save') {
    const changed = session.brainRoleId || session.brainChannelId || session.brainMessage;
    if (!changed) {
      return interaction.reply({
        content: 'Select a role or channel, or edit the announcement message before saving.',
        flags: MessageFlags.Ephemeral
      });
    }
    if (session.brainRoleId) customCommands.setBrainRole(session.guildId, session.brainRoleId);
    const brain = {};
    if (session.brainChannelId) brain.channelId = session.brainChannelId;
    if (session.brainMessage) brain.message = session.brainMessage;
    if (Object.keys(brain).length) guildSettings.updateSettings(session.guildId, { brain });
    return interaction.update({
      content: '✅ Brain role settings saved.',
      components: [buildBackRow(session)]
    });
  }
  if (action === 'brain_disable') {
    customCommands.setBrainRole(session.guildId, null);
    guildSettings.updateSettings(session.guildId, {
      brain: {
        channelId: null,
        message: guildSettings.getSettings(session.guildId).brain?.message || ''
      }
    });
    session.brainRoleId = null;
    session.brainChannelId = null;
    return interaction.update({
      content: 'Brain role tracking and announcements have been disabled.',
      components: [buildBackRow(session)]
    });
  }

  if (action === 'joinrole_enable' || action === 'joinrole_disable') {
    const joinRoles = guildSettings.getSettings(session.guildId).joinRoles;
    joinRoles.enabled = action === 'joinrole_enable';
    guildSettings.updateSettings(session.guildId, { joinRoles });
    return interaction.update(buildJoinRolePanel(interaction.guild, joinRoles, session, session));
  }
  if (action === 'joinrole_category') {
    session.category = interaction.values[0];
  } else if (action === 'joinrole_mode_add') {
    session.mode = 'add';
  } else if (action === 'joinrole_mode_remove') {
    session.mode = 'remove';
  } else if (action === 'joinrole_roles') {
    const joinRoles = guildSettings.getSettings(session.guildId).joinRoles;
    const currentRoles = joinRoles[session.category] || [];
    if (session.mode === 'add') {
      joinRoles[session.category] = [...new Set([...currentRoles, ...interaction.values])];
    } else {
      const selectedRoles = new Set(interaction.values);
      joinRoles[session.category] = currentRoles.filter(roleId => !selectedRoles.has(roleId));
    }
    guildSettings.updateSettings(session.guildId, { joinRoles });
  } else {
    return interaction.reply({
      content: 'This setup action is not recognized.',
      flags: MessageFlags.Ephemeral
    });
  }
  const joinRoles = guildSettings.getSettings(session.guildId).joinRoles;
  return interaction.update(buildJoinRolePanel(interaction.guild, joinRoles, session, session));
}

async function handleSetupModal(interaction) {
  const [, sessionId, modalAction, modalType] = interaction.customId.split(':');
  if (modalAction !== 'modal') {
    return interaction.reply({
      content: 'This setup form is not recognized.',
      flags: MessageFlags.Ephemeral
    });
  }
  const validation = validateSetupSession(interaction, sessionId);
  if (validation.error) {
    return interaction.reply({ content: validation.error, flags: MessageFlags.Ephemeral });
  }
  const { session } = validation;
  const value = interaction.fields.getTextInputValue(
    modalType === 'brainmessage' ? 'message' : 'value'
  ).trim();

  if (modalType === 'prefix') {
    if (!value || value.length > 5) {
      return interaction.reply({
        content: 'Enter a command prefix containing 1 to 5 characters.',
        flags: MessageFlags.Ephemeral
      });
    }
    guildSettings.updateSettings(session.guildId, { prefix: value });
    return interaction.update({
      content: `✅ Command prefix updated to \`${value}\`.`,
      components: [buildBackRow(session)]
    });
  }

  if (modalType === 'embedcolor') {
    let normalized = value.replace(/^#/, '');
    if (/^0x/i.test(normalized)) normalized = normalized.slice(2);
    let color;
    if (/^[0-9a-fA-F]{6}$/.test(normalized)) {
      color = parseInt(normalized, 16);
    } else {
      const decimal = Number(value);
      if (Number.isFinite(decimal) && decimal >= 0 && decimal <= 0xFFFFFF) {
        color = Math.floor(decimal);
      }
    }
    if (color === undefined) {
      return interaction.reply({
        content: 'Enter a valid color as `#RRGGBB`, `RRGGBB`, `0xRRGGBB`, or decimal `0-16777215`.',
        flags: MessageFlags.Ephemeral
      });
    }
    const colorHex = `#${color.toString(16).padStart(6, '0').toLowerCase()}`;
    guildSettings.updateSettings(session.guildId, { embedColor: colorHex });
    return interaction.update({
      content: `✅ Embed color updated to \`${colorHex}\`.`,
      embeds: [{ color, description: 'Embed color preview' }],
      components: [buildBackRow(session)]
    });
  }

  if (modalType === 'brainmessage') {
    if (!value) {
      return interaction.reply({
        content: 'Enter an announcement message. Use `{USER}` to insert the username.',
        flags: MessageFlags.Ephemeral
      });
    }
    session.brainMessage = value;
    const panel = buildBrainRolePanel(session);
    panel.content = `✅ Message staged. Select **Save changes** to apply it.\n\n${panel.content}`;
    return interaction.update(panel);
  }

  return interaction.reply({
    content: 'This setup form is not recognized.',
    flags: MessageFlags.Ephemeral
  });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Configure server-specific settings for the bot')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    try {
      if (!interaction.inGuild()) {
        return interaction.reply({ 
          content: '❌ This command can only be used in a server.',
          flags: MessageFlags.Ephemeral
        });
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const session = createSetupSession(interaction);
      return interaction.editReply(buildMainPanel(session));

    } catch (error) {
      console.error('Error in setup command:', error);
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({
          content: '❌ An error occurred while processing this command.',
          flags: MessageFlags.Ephemeral
        });
      } else {
        await interaction.reply({
          content: '❌ An error occurred while processing this command.',
          flags: MessageFlags.Ephemeral
        });
      }
    }
  },
  handleSetupComponent,
  handleSetupModal
};
