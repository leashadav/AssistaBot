const { randomUUID } = require('crypto');
const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const twitchTimers = require('../modules/twitchTimers');

const pendingTimerSetup = new Map();

function buildTimerDetailsResponse(name, timer) {
  let response = `✅ Timer "${name}"\n`;
  response += `📝 Message: ${timer.message}\n`;
  response += `⏰ Interval: ${timer.interval} minutes\n`;
  response += `👥 Min viewers: ${timer.minViewers ?? 0}`;
  response += `\n💬 Min lines: ${timer.minLines ?? 0}`;
  response += `\n${timer.enabled ? '✅' : '❌'} Enabled: ${timer.enabled}`;
  if (timer.gameFilter?.length) {
    response += `\n🎮 Games: ${timer.gameFilter.join(', ')}`;
  }
  return response;
}

function parseTimerFormValues(interaction) {
  const name = interaction.fields.getTextInputValue('timer_name').trim();
  const message = interaction.fields.getTextInputValue('timer_message').trim();
  const intervalText = interaction.fields.getTextInputValue('timer_interval').trim();
  const gamesText = interaction.fields.getTextInputValue('timer_games').trim();
  const minViewersText = interaction.fields.getTextInputValue('timer_min_viewers').trim();
  const minLinesText = interaction.fields.getTextInputValue('timer_min_lines').trim();
  const enabledText = interaction.fields.getTextInputValue('timer_enabled').trim();

  if (!name) {
    throw new Error('Timer name is required.');
  }

  if (!message) {
    throw new Error('Timer message is required.');
  }

  const interval = Number(intervalText || 60);
  if (!Number.isInteger(interval) || interval < 1 || interval > 120) {
    throw new Error('Interval must be a whole number between 1 and 120 minutes.');
  }

  const minViewers = Number(minViewersText || 0);
  if (!Number.isInteger(minViewers) || minViewers < 0) {
    throw new Error('Minimum viewers must be a non-negative whole number.');
  }

  const minLines = Number(minLinesText || 2);
  if (!Number.isInteger(minLines) || minLines < 0) {
    throw new Error('Minimum chat lines must be a non-negative whole number.');
  }

  const enabled = String(enabledText || 'true').toLowerCase() === 'true';
  const gameFilter = gamesText ? gamesText.split(',').map(g => g.trim()).filter(Boolean) : null;

  return { name, message, interval, gameFilter, minViewers, minLines, enabled };
}

function createTimerSetupModal(sessionId, mode, initialValues = {}) {
  const title = mode === 'edit' ? 'Edit Twitch Timer' : 'Add Twitch Timer';
  const modal = new ModalBuilder()
    .setCustomId(`timer_${mode}_modal:${sessionId}`)
    .setTitle(title);

  const fields = [
    { customId: 'timer_name', label: 'Timer name', value: initialValues.name || '', required: true, max: 100, style: TextInputStyle.Short },
    { customId: 'timer_message', label: 'Timer message', value: initialValues.message || '', required: true, max: 1000, style: TextInputStyle.Paragraph },
    { customId: 'timer_interval', label: 'Interval in minutes', value: String(initialValues.interval ?? 60), required: true, max: 3, style: TextInputStyle.Short },
    { customId: 'timer_games', label: 'Game filter (comma separated)', value: initialValues.gameFilter ? initialValues.gameFilter.join(', ') : '', required: false, max: 500, style: TextInputStyle.Short },
    { customId: 'timer_min_viewers', label: 'Minimum viewers', value: String(initialValues.minViewers ?? 0), required: false, max: 5, style: TextInputStyle.Short },
    { customId: 'timer_min_lines', label: 'Minimum chat lines', value: String(initialValues.minLines ?? 2), required: false, max: 5, style: TextInputStyle.Short },
    { customId: 'timer_enabled', label: 'Enabled (true or false)', value: String(initialValues.enabled ?? true), required: false, max: 5, style: TextInputStyle.Short }
  ];

  for (const field of fields) {
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(field.customId)
          .setLabel(field.label)
          .setStyle(field.style)
          .setPlaceholder(field.label)
          .setRequired(field.required)
          .setValue(field.value)
          .setMaxLength(field.max)
      )
    );
  }

  return modal;
}

function getTimerSetupButton(sessionId, mode, label) {
  return new ButtonBuilder()
    .setCustomId(`timer_setup:${mode}:${sessionId}`)
    .setLabel(label)
    .setStyle(ButtonStyle.Primary);
}

async function handleButtonInteraction(interaction) {
  if (!interaction.customId.startsWith('timer_setup:')) {
    return;
  }

  const [, mode, sessionId] = interaction.customId.split(':');
  const session = pendingTimerSetup.get(sessionId);

  if (!session || session.userId !== interaction.user.id || session.guildId !== interaction.guild.id) {
    pendingTimerSetup.delete(sessionId);
    return interaction.reply({ content: 'This timer setup expired. Run the timer command again.', flags: MessageFlags.Ephemeral });
  }

  const modal = createTimerSetupModal(sessionId, mode, session.initialValues || {});
  return interaction.showModal(modal);
}

async function handleModalInteraction(interaction) {
  if (!interaction.customId.startsWith('timer_') || !interaction.customId.includes('_modal')) {
    return;
  }

  if (interaction.customId === 'timer_remove_modal' || interaction.customId === 'timer_toggle_modal') {
    const name = interaction.fields.getTextInputValue('timer_name').trim();
    if (!name) {
      return interaction.reply({ content: '❌ Timer name is required.', flags: MessageFlags.Ephemeral });
    }

    const timers = twitchTimers.listTimers(interaction.guild.id);
    const allNames = [...Object.keys(timers.global), ...Object.keys(timers.guild)];
    const exists = allNames.includes(name);

    if (interaction.customId === 'timer_remove_modal') {
      if (!exists) {
        return interaction.reply({ content: `❌ Timer "${name}" not found.`, flags: MessageFlags.Ephemeral });
      }
      const success = twitchTimers.removeTimer(interaction.guild.id, name);
      if (!success) {
        return interaction.reply({ content: `❌ Failed to remove timer "${name}".`, flags: MessageFlags.Ephemeral });
      }
      return interaction.reply({ content: `✅ Removed timer "${name}"`, flags: MessageFlags.Ephemeral });
    }

    if (interaction.customId === 'timer_toggle_modal') {
      if (!exists) {
        return interaction.reply({ content: `❌ Timer "${name}" not found.`, flags: MessageFlags.Ephemeral });
      }
      const newState = twitchTimers.toggleTimer(interaction.guild.id, name);
      if (newState === null) {
        return interaction.reply({ content: `❌ Failed to toggle timer "${name}".`, flags: MessageFlags.Ephemeral });
      }
      const status = newState ? 'enabled' : 'disabled';
      return interaction.reply({ content: `✅ Timer "${name}" ${status}`, flags: MessageFlags.Ephemeral });
    }
  }

  const mode = interaction.customId.startsWith('timer_add_modal:') ? 'add' : interaction.customId.startsWith('timer_edit_modal:') ? 'edit' : null;
  const sessionId = interaction.customId.replace(/^timer_(?:add|edit)_modal:/, '');
  const session = pendingTimerSetup.get(sessionId);

  if (!session || session.userId !== interaction.user.id || session.guildId !== interaction.guild.id) {
    pendingTimerSetup.delete(sessionId);
    return interaction.reply({ content: 'This timer setup expired. Run the timer command again.', flags: MessageFlags.Ephemeral });
  }

  try {
    const values = parseTimerFormValues(interaction);
    const existingTimer = session.initialValues || {};

    if (mode === 'edit') {
      const timers = twitchTimers.listTimers(interaction.guild.id);
      const currentTimer = timers.global[values.name] || timers.guild[values.name] || existingTimer;
      if (!currentTimer && !session.initialValues?.name) {
        throw new Error(`Timer "${values.name}" was not found.`);
      }

      const merged = { ...currentTimer, ...values };
      const success = twitchTimers.addTimer(interaction.guild.id, values.name, merged);
      if (!success) {
        throw new Error('Failed to save the updated timer.');
      }

      pendingTimerSetup.delete(sessionId);
      return interaction.reply({ content: buildTimerDetailsResponse(values.name, merged), flags: MessageFlags.Ephemeral });
    }

    const success = twitchTimers.addTimer(interaction.guild.id, values.name, values);
    if (!success) {
      throw new Error('Failed to save the new timer.');
    }

    pendingTimerSetup.delete(sessionId);
    return interaction.reply({ content: buildTimerDetailsResponse(values.name, values), flags: MessageFlags.Ephemeral });
  } catch (error) {
    pendingTimerSetup.delete(sessionId);
    console.error('Timer modal error:', error);
    return interaction.reply({ content: `❌ ${error.message}`, flags: MessageFlags.Ephemeral });
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('timer')
    .setDescription('Manage Twitch chat timers')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(subcommand =>
      subcommand
        .setName('add')
        .setDescription('Add a new timer'))
    .addSubcommand(subcommand =>
      subcommand
        .setName('remove')
        .setDescription('Remove a timer'))
    .addSubcommand(subcommand =>
      subcommand
        .setName('toggle')
        .setDescription('Enable/disable a timer'))
    .addSubcommand(subcommand =>
      subcommand
        .setName('list')
        .setDescription('List all timers'))
    .addSubcommand(subcommand =>
      subcommand
        .setName('edit')
        .setDescription('Edit an existing timer'))
    .addSubcommand(subcommand =>
      subcommand
        .setName('start')
        .setDescription('Manually start the timer system'))
    .addSubcommand(subcommand =>
      subcommand
        .setName('stop')
        .setDescription('Manually stop the timer system')),

  async autocomplete(interaction) {
    const focusedOption = interaction.options.getFocused(true);
    if (focusedOption.name === 'name') {
      const timers = twitchTimers.listTimers(interaction.guild.id);
      const allNames = [...Object.keys(timers.global), ...Object.keys(timers.guild)];
      const filtered = allNames.filter(name => name.toLowerCase().includes(focusedOption.value.toLowerCase()));
      await interaction.respond(filtered.slice(0, 25).map(name => ({ name, value: name })));
    }
  },

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: '❌ This command can only be used in a server.', flags: MessageFlags.Ephemeral });
    }

    const subcommand = interaction.options.getSubcommand();

    try {
      if (subcommand === 'add') {
        const sessionId = randomUUID();
        pendingTimerSetup.set(sessionId, {
          userId: interaction.user.id,
          guildId: interaction.guild.id,
          mode: 'add',
          initialValues: {
            name: '',
            message: '',
            interval: 60,
            gameFilter: null,
            minViewers: 0,
            minLines: 2,
            enabled: true
          }
        });

        const row = new ActionRowBuilder().addComponents(
          getTimerSetupButton(sessionId, 'add', 'Open timer form')
        );
        return interaction.reply({
          content: 'Use the button below to fill out the timer details in a form.',
          components: [row],
          flags: MessageFlags.Ephemeral
        });
      }

      if (subcommand === 'remove') {
        const timers = twitchTimers.listTimers(interaction.guild.id);
        const allNames = [...Object.keys(timers.global), ...Object.keys(timers.guild)];
        if (!allNames.length) {
          return interaction.reply({ content: 'No timers are configured yet.', flags: MessageFlags.Ephemeral });
        }

        const modal = new ModalBuilder()
          .setCustomId('timer_remove_modal')
          .setTitle('Remove Timer');

        const nameInput = new TextInputBuilder()
          .setCustomId('timer_name')
          .setLabel('Timer name')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder(allNames.join(', '))
          .setRequired(true)
          .setMaxLength(100);

        modal.addComponents(new ActionRowBuilder().addComponents(nameInput));
        return interaction.showModal(modal);
      }

      if (subcommand === 'toggle') {
        const timers = twitchTimers.listTimers(interaction.guild.id);
        const allNames = [...Object.keys(timers.global), ...Object.keys(timers.guild)];
        if (!allNames.length) {
          return interaction.reply({ content: 'No timers are configured yet.', flags: MessageFlags.Ephemeral });
        }

        const modal = new ModalBuilder()
          .setCustomId('timer_toggle_modal')
          .setTitle('Toggle Timer');

        const nameInput = new TextInputBuilder()
          .setCustomId('timer_name')
          .setLabel('Timer name')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder(allNames.join(', '))
          .setRequired(true)
          .setMaxLength(100);

        modal.addComponents(new ActionRowBuilder().addComponents(nameInput));
        return interaction.showModal(modal);
      }

      if (subcommand === 'list') {
        const timers = twitchTimers.listTimers(interaction.guild.id);
        let response = '**Twitch Chat Timers**\n\n';

        if (Object.keys(timers.global).length > 0) {
          response += '🌐 **Global Timers:**\n';
          for (const [name, timer] of Object.entries(timers.global)) {
            const status = timer.enabled ? '✅' : '❌';
            response += `${status} **${name}** - ${timer.interval}m`;
            if (timer.gameFilter) response += ` (Games: ${timer.gameFilter.join(', ')})`;
            if (timer.minViewers > 0) response += ` (Min viewers: ${timer.minViewers})`;
            if (timer.minLines > 0) response += ` (Min lines: ${timer.minLines})`;
            response += '\n';
          }
          response += '\n';
        }

        if (Object.keys(timers.guild).length > 0) {
          response += '🏠 **Server Timers:**\n';
          for (const [name, timer] of Object.entries(timers.guild)) {
            const status = timer.enabled ? '✅' : '❌';
            response += `${status} **${name}** - ${timer.interval}m`;
            if (timer.gameFilter) response += ` (Games: ${timer.gameFilter.join(', ')})`;
            if (timer.minViewers > 0) response += ` (Min viewers: ${timer.minViewers})`;
            if (timer.minLines > 0) response += ` (Min lines: ${timer.minLines})`;
            response += '\n';
          }
        } else if (Object.keys(timers.global).length === 0) {
          response += 'No timers configured.';
        }

        return interaction.reply({ content: response, flags: MessageFlags.Ephemeral });
      }

      if (subcommand === 'edit') {
        const timers = twitchTimers.listTimers(interaction.guild.id);
        const allNames = [...Object.keys(timers.global), ...Object.keys(timers.guild)];
        if (!allNames.length) {
          return interaction.reply({ content: 'No timers are configured yet.', flags: MessageFlags.Ephemeral });
        }

        const sessionId = randomUUID();
        const name = allNames[0];
        const existingTimer = timers.global[name] || timers.guild[name];
        pendingTimerSetup.set(sessionId, {
          userId: interaction.user.id,
          guildId: interaction.guild.id,
          mode: 'edit',
          initialValues: {
            name,
            message: existingTimer?.message || '',
            interval: existingTimer?.interval || 60,
            gameFilter: existingTimer?.gameFilter || null,
            minViewers: existingTimer?.minViewers ?? 0,
            minLines: existingTimer?.minLines ?? 2,
            enabled: existingTimer?.enabled ?? true
          }
        });

        const row = new ActionRowBuilder().addComponents(
          getTimerSetupButton(sessionId, 'edit', 'Open edit form')
        );
        return interaction.reply({
          content: 'Use the button below to update the timer in a form.',
          components: [row],
          flags: MessageFlags.Ephemeral
        });
      }

      if (subcommand === 'start') {
        twitchTimers.manualStart();
        return interaction.reply({ content: '✅ Timer system started manually', flags: MessageFlags.Ephemeral });
      }

      if (subcommand === 'stop') {
        twitchTimers.stopTimers();
        return interaction.reply({ content: '⏹️ Timer system stopped', flags: MessageFlags.Ephemeral });
      }

    } catch (error) {
      console.error('Timer command error:', error);
      return interaction.reply({ content: '❌ An error occurred while processing the timer command.', flags: MessageFlags.Ephemeral });
    }
  },

  handleButtonInteraction,
  handleModalInteraction,
};