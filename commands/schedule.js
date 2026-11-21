const { randomUUID } = require('crypto');
const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder, UserSelectMenuBuilder } = require('discord.js');
const streamScheduleManager = require('../modules/streamScheduleManager');
const guildSettings = require('../modules/guildSettings');
const { generateWeeklyScheduleEmbed } = require('../modules/streamScheduleEmbed');

// Helper function to convert 12-hour format to 24-hour format for storage
function convertTo24Hour(time12h) {
  const [time, modifier] = time12h.split(' ');
  let [hours, minutes] = time.split(':');
  
  if (hours.length === 1) hours = '0' + hours;
  
  if (modifier.toUpperCase() === 'PM') {
    hours = parseInt(hours, 10) + 12;
    if (hours === 24) hours = 12;
  } else if (modifier.toUpperCase() === 'AM') {
    if (parseInt(hours, 10) === 12) hours = 0;
  }
  
  return `${hours.toString().padStart(2, '0')}:${minutes}`;
}

// Helper function to convert 24-hour format to 12-hour format for display
function convertTo12Hour(time24h) {
  let [hours, minutes] = time24h.split(':');
  hours = parseInt(hours, 10);
  
  const modifier = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12; // 0 should be 12
  
  return `${hours}:${minutes} ${modifier}`;
}

// Helper function to validate 12-hour time format
function isValid12HourTime(time) {
  const regex = /^(0?[1-9]|1[0-2]):([0-5][0-9])\s?(AM|PM)$/i;
  return regex.test(time.trim());
}

const DAYS_OF_WEEK = [
  { name: 'Monday', value: '0' },
  { name: 'Tuesday', value: '1' },
  { name: 'Wednesday', value: '2' },
  { name: 'Thursday', value: '3' },
  { name: 'Friday', value: '4' },
  { name: 'Saturday', value: '5' },
  { name: 'Sunday', value: '6' }
];

const TIMEZONES = [
  { label: 'Eastern Time', value: 'America/New_York' },
  { label: 'Central Time', value: 'America/Chicago' },
  { label: 'Mountain Time', value: 'America/Denver' },
  { label: 'Pacific Time', value: 'America/Los_Angeles' },
  { label: 'UTC', value: 'UTC' },
  { label: 'Greenwich Mean Time', value: 'Europe/London' },
  { label: 'Central European Time', value: 'Europe/Paris' },
  { label: 'Australian Eastern Time', value: 'Australia/Sydney' },
  { label: 'Japan Standard Time', value: 'Asia/Tokyo' }
];

const scheduleBuilderSessions = new Map();

module.exports = {
  data: new SlashCommandBuilder()
    .setName('schedule')
    .setDescription('Manage weekly stream schedules')
    .addSubcommand(subcommand =>
      subcommand
        .setName('add')
        .setDescription('Build a weekly schedule with multiple non-overlapping time ranges per day'))
    .addSubcommand(subcommand =>
      subcommand
        .setName('config')
        .setDescription('Configure schedule settings (Admin only)')
        .addStringOption(option =>
          option
            .setName('action')
            .setDescription('Configuration action')
            .setRequired(true)
            .addChoices(
              { name: 'Set Channel', value: 'set_channel' },
              { name: 'View Settings', value: 'view' },
              { name: 'Enable/Disable', value: 'toggle' }
            ))
        .addChannelOption(option =>
          option
            .setName('channel')
            .setDescription('Channel for schedule embed')
            .setRequired(false))
        .addBooleanOption(option =>
          option
            .setName('enabled')
            .setDescription('Enable or disable schedule posting')
            .setRequired(false)))
    .addSubcommand(subcommand =>
      subcommand
        .setName('post')
        .setDescription('Manually post the weekly schedule embed (Admin only)')),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const guildId = interaction.guildId;
    const userId = interaction.user.id;
    const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);

    try {
      switch (subcommand) {
        case 'add':
          await handleAdd(interaction, guildId, userId, isAdmin);
          break;
        case 'config':
          await handleConfig(interaction, guildId, isAdmin);
          break;
        case 'post':
          await handlePost(interaction, guildId, isAdmin);
          break;
      }
    } catch (error) {
      console.error('[Schedule Command] Error:', error);
      const errorEmbed = new EmbedBuilder()
        .setTitle('❌ Error')
        .setDescription(`An error occurred: ${error.message}`)
        .setColor('#FF0000');
      
      if (interaction.replied || interaction.deferred) {
        await interaction.editReply({ embeds: [errorEmbed] });
      } else {
        await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
      }
    }
  },

  async handleScheduleBuilderComponent(interaction) {
    const [action, sessionId] = interaction.customId.replace('schedule_builder_', '').split(':');
    const session = getBuilderSession(sessionId, interaction);
    if (!session) {
      return interaction.reply({ content: 'This schedule builder expired. Run `/schedule add` to start again.', flags: MessageFlags.Ephemeral });
    }

    if (action === 'day') {
      session.selectedDay = Number(interaction.values[0]);
      session.selectedIsRecurring = session.entries[session.selectedDay]?.[0]?.isRecurring ?? true;
      return interaction.update(renderScheduleBuilder(session, sessionId));
    }

    if (action === 'user') {
      session.discordUserId = interaction.values[0] || null;
      return interaction.update(renderScheduleBuilder(session, sessionId));
    }

    if (action === 'timezone') {
      session.timezone = interaction.values[0];
      return interaction.update(renderScheduleBuilder(session, sessionId));
    }

    if (action === 'event') {
      session.selectedIsRecurring = interaction.values[0] === 'weekly';
      return interaction.update(renderScheduleBuilder(session, sessionId));
    }

    if (action === 'times') {
      if (session.selectedDay === null || !session.timezone) {
        return interaction.reply({ content: 'Choose a timezone and weekday first.', flags: MessageFlags.Ephemeral });
      }
      return interaction.showModal(createScheduleTimesModal(session, sessionId));
    }

    if (action === 'cancel') {
      scheduleBuilderSessions.delete(sessionId);
      return interaction.update({ content: 'Schedule setup cancelled.', embeds: [], components: [] });
    }

    if (action === 'finish') {
      return saveScheduleBuilder(interaction, session, sessionId);
    }

    if (action === 'delete_day') {
      if (session.canEditSchedule === false || session.selectedDay === null || !session.existingDays?.has(session.selectedDay)) {
        return interaction.reply({ content: 'Select a saved weekday that you are allowed to manage.', flags: MessageFlags.Ephemeral });
      }
      const dayKey = DAYS_OF_WEEK[session.selectedDay].name.toLowerCase();
      const result = streamScheduleManager.deleteScheduleSegment(
        session.guildId,
        session.streamerName,
        dayKey,
        session.userId,
        session.isAdmin
      );
      if (!result.success) {
        return interaction.reply({ content: result.message, flags: MessageFlags.Ephemeral });
      }

      delete session.entries[session.selectedDay];
      session.existingDays.delete(session.selectedDay);
      if (!streamScheduleManager.getStreamer(session.guildId, session.streamerName)) {
        session.isExistingStreamer = false;
        session.canEditStreamerInfo = true;
        session.canEditSchedule = true;
        session.existingDays.clear();
      }
      session.selectedIsRecurring = session.entries[session.selectedDay]?.[0]?.isRecurring ?? true;
      return interaction.update(renderScheduleBuilder(session, sessionId));
    }

    if (action === 'delete_streamer') {
      if (session.canEditSchedule === false || !session.isExistingStreamer) {
        return interaction.reply({ content: 'Only the streamer who created this schedule or a server admin can delete it.', flags: MessageFlags.Ephemeral });
      }
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`schedule_builder_confirm_delete:${sessionId}`)
          .setLabel('Delete streamer schedule')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(`schedule_builder_cancel_delete:${sessionId}`)
          .setLabel('Keep schedule')
          .setStyle(ButtonStyle.Secondary)
      );
      return interaction.reply({
        content: `Delete **${session.streamerName}** and all of its weekday entries? This cannot be undone.`,
        components: [row],
        flags: MessageFlags.Ephemeral
      });
    }

    if (action === 'cancel_delete') {
      return interaction.update({ content: 'Streamer schedule kept.', components: [] });
    }

    if (action === 'confirm_delete') {
      if (session.canEditSchedule === false || !session.isExistingStreamer) {
        return interaction.update({ content: 'This streamer schedule can no longer be deleted from this builder.', components: [] });
      }
      const result = streamScheduleManager.deleteStreamer(
        session.guildId,
        session.streamerName,
        session.userId,
        session.isAdmin
      );
      if (!result.success) {
        return interaction.update({ content: result.message, components: [] });
      }
      scheduleBuilderSessions.delete(sessionId);
      return interaction.update({ content: `Deleted **${session.streamerName}** and all of its schedule entries.`, components: [] });
    }
  },

  async handleScheduleBuilderModal(interaction) {
    const [step, sessionId] = interaction.customId.replace('schedule_builder_', '').split(':');

    if (step === 'details') {
      const session = scheduleBuilderSessions.get(sessionId);
      if (!session || session.userId !== interaction.user.id || session.guildId !== interaction.guildId) {
        scheduleBuilderSessions.delete(sessionId);
        return interaction.reply({ content: 'This schedule builder expired. Run `/schedule add` to start again.', flags: MessageFlags.Ephemeral });
      }

      const streamerName = interaction.fields.getTextInputValue('streamer_name').trim();
      session.streamerName = streamerName;
      const existingStreamer = streamScheduleManager.getStreamer(session.guildId, streamerName);
      session.isExistingStreamer = Boolean(existingStreamer);
      session.canEditStreamerInfo = !existingStreamer || existingStreamer.addedBy === session.userId || session.isAdmin;
      session.canEditSchedule = session.canEditStreamerInfo;
      session.timezone = existingStreamer?.timezone || null;
      const submittedStreamUrl = interaction.fields.getTextInputValue('stream_url').trim();
      session.streamUrl = session.canEditStreamerInfo
        ? submittedStreamUrl.toLowerCase() === 'none' ? null : submittedStreamUrl || existingStreamer?.streamUrl || null
        : existingStreamer?.streamUrl || null;
      session.discordUserId = existingStreamer?.discordUserId || null;
      if (existingStreamer) {
        session.existingDays = new Set();
        for (const [dayOfWeek, day] of DAYS_OF_WEEK.entries()) {
          const entry = existingStreamer[day.name.toLowerCase()];
          if (!entry) continue;
          session.existingDays.add(dayOfWeek);
          const entries = Array.isArray(entry) ? entry : [entry];
          session.entries[dayOfWeek] = entries.map(segment => ({
            startTime: convertTo12Hour(segment.startTime),
            endTime: convertTo12Hour(segment.endTime),
            isRecurring: segment.isRecurring !== false,
            specificDate: segment.specificDate || null
          }));
          if (session.selectedDay === null) session.selectedDay = dayOfWeek;
        }
        if (session.selectedDay !== null) {
          session.selectedIsRecurring = session.entries[session.selectedDay][0].isRecurring;
        }
      }

      return interaction.reply({ ...renderScheduleBuilder(session, sessionId), flags: MessageFlags.Ephemeral });
    }

    if (step === 'times') {
      const session = getBuilderSession(sessionId, interaction);
      if (!session) {
        return interaction.reply({ content: 'This schedule builder expired. Run `/schedule add` to start again.', flags: MessageFlags.Ephemeral });
      }

      const startTimes = interaction.fields.getTextInputValue('start_time').split(',').map(time => time.trim());
      const endTimes = interaction.fields.getTextInputValue('end_time').split(',').map(time => time.trim());
      const specificDate = interaction.fields.getTextInputValue('specific_date').trim() || null;
      if (!session.timezone || session.selectedDay === null) {
        return interaction.reply({ content: 'Choose a timezone and weekday before entering times.', flags: MessageFlags.Ephemeral });
      }
      if (startTimes.length === 0 || startTimes.length !== endTimes.length || startTimes.some(time => !isValid12HourTime(time)) || endTimes.some(time => !isValid12HourTime(time))) {
        return interaction.reply({ content: 'Enter matching comma-separated start and end times in `H:MM AM/PM` format, for example `7:30 PM, 10:00 PM`.', flags: MessageFlags.Ephemeral });
      }

      if (session.selectedIsRecurring && specificDate) {
        return interaction.reply({ content: 'Remove the one-time date for a weekly schedule, or select One-time event.', flags: MessageFlags.Ephemeral });
      }
      if (!session.selectedIsRecurring && (!specificDate || !isValidDate(specificDate))) {
        return interaction.reply({ content: 'For a one-time event, enter a valid date in `YYYY-MM-DD` format.', flags: MessageFlags.Ephemeral });
      }
      if (specificDate && getMondayBasedDay(specificDate) !== session.selectedDay) {
        return interaction.reply({ content: 'That date does not fall on the selected weekday.', flags: MessageFlags.Ephemeral });
      }

      const dayEntries = startTimes.map((startTime, index) => ({
        startTime,
        endTime: endTimes[index],
        isRecurring: session.selectedIsRecurring,
        specificDate
      }));
      const localSegments = dayEntries.map(entry => ({
        startTime: convertTo24Hour(entry.startTime),
        endTime: convertTo24Hour(entry.endTime),
        isRecurring: entry.isRecurring,
        specificDate: entry.specificDate
      }));
      const overlap = findTimeOverlap(localSegments);
      if (overlap) {
        return interaction.reply({ content: overlap, flags: MessageFlags.Ephemeral });
      }

      session.entries[session.selectedDay] = dayEntries;
      const builder = renderScheduleBuilder(session, sessionId);
      if (interaction.isFromMessage()) {
        return interaction.update(builder);
      }
      return interaction.reply({ ...builder, flags: MessageFlags.Ephemeral });
    }
  }
};

async function handleAdd(interaction, guildId, userId, isAdmin) {
  for (const [sessionId, session] of scheduleBuilderSessions) {
    if (Date.now() - session.createdAt > 30 * 60 * 1000) {
      scheduleBuilderSessions.delete(sessionId);
    }
  }

  const sessionId = randomUUID().replaceAll('-', '');
  scheduleBuilderSessions.set(sessionId, {
    userId,
    guildId,
    isAdmin,
    createdAt: Date.now(),
    selectedDay: null,
    entries: {},
    discordUserId: null,
    timezone: null,
    selectedIsRecurring: true
  });
  await interaction.showModal(createScheduleDetailsModal(sessionId));
}

function createScheduleDetailsModal(sessionId) {
  const streamerName = new TextInputBuilder()
    .setCustomId('streamer_name')
    .setLabel('Streamer name')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(80);
  const streamUrl = new TextInputBuilder()
    .setCustomId('stream_url')
    .setLabel('Stream URL (blank keeps; NONE clears)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(200);
  return new ModalBuilder()
    .setCustomId(`schedule_builder_details:${sessionId}`)
    .setTitle('New Stream Schedule')
    .addComponents(
      new ActionRowBuilder().addComponents(streamerName),
      new ActionRowBuilder().addComponents(streamUrl)
    );
}

function createScheduleTimesModal(session, sessionId) {
  const existingEntries = session.entries[session.selectedDay] || [];
  const startTime = new TextInputBuilder()
    .setCustomId('start_time')
    .setLabel('Start times, comma-separated')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(200)
    .setPlaceholder('7:30 PM, 10:00 PM');
  const endTime = new TextInputBuilder()
    .setCustomId('end_time')
    .setLabel('Matching end times, comma-separated')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(200)
    .setPlaceholder('9:00 PM, 11:00 PM');
  const specificDate = new TextInputBuilder()
    .setCustomId('specific_date')
    .setLabel('One-time date (YYYY-MM-DD; weekly blank)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(10);

  if (existingEntries.length) {
    startTime.setValue(existingEntries.map(entry => entry.startTime).join(', '));
    endTime.setValue(existingEntries.map(entry => entry.endTime).join(', '));
    if (existingEntries[0].specificDate) specificDate.setValue(existingEntries[0].specificDate);
  }

  return new ModalBuilder()
    .setCustomId(`schedule_builder_times:${sessionId}`)
    .setTitle(`${DAYS_OF_WEEK[session.selectedDay].name} Times`)
    .addComponents(
      new ActionRowBuilder().addComponents(startTime),
      new ActionRowBuilder().addComponents(endTime),
      new ActionRowBuilder().addComponents(specificDate)
    );
}

function renderScheduleBuilder(session, sessionId) {
  const allScheduledDays = Object.keys(session.entries)
    .map(Number)
    .sort((a, b) => a - b)
    .flatMap(day => session.entries[day].map((entry, index) => {
      const type = entry.isRecurring ? 'Weekly' : `One-time ${entry.specificDate}`;
      const savedLabel = session.existingDays?.has(day) ? ' (saved)' : '';
      return `${DAYS_OF_WEEK[day].name}${session.entries[day].length > 1 ? ` #${index + 1}` : ''}: ${entry.startTime} - ${entry.endTime} (${type})${savedLabel}`;
    }));
  const scheduledDays = [];
  let descriptionLength = 0;
  for (const entry of allScheduledDays) {
    if (descriptionLength + entry.length + 1 > 3500) break;
    scheduledDays.push(entry);
    descriptionLength += entry.length + 1;
  }
  if (scheduledDays.length < allScheduledDays.length) {
    scheduledDays.push(`…and ${allScheduledDays.length - scheduledDays.length} more entries`);
  }
  const embed = new EmbedBuilder()
    .setTitle(`Schedule Builder: ${session.streamerName}`)
    .setDescription([
      `Timezone: **${session.timezone || 'Choose a timezone below'}**`,
      `Event type for new entries on selected day: **${session.selectedIsRecurring ? 'Weekly' : 'One-time'}**`,
      session.selectedDay === null ? 'Choose a weekday, then set its times.' : `Selected weekday: **${DAYS_OF_WEEK[session.selectedDay].name}**`,
      scheduledDays.length ? `\n**Configured days**\n${scheduledDays.join('\n')}` : '\nNo days configured yet.'
    ].join('\n'))
    .setColor(0x18A999);
  const daySelect = new StringSelectMenuBuilder()
    .setCustomId(`schedule_builder_day:${sessionId}`)
    .setPlaceholder('Choose a weekday')
    .setDisabled(session.canEditSchedule === false)
    .addOptions(DAYS_OF_WEEK.map((day, index) => ({
      label: `${day.name}${session.existingDays?.has(index) ? ' (saved)' : ''}`,
      value: String(index)
    })));
  const timezoneSelect = new StringSelectMenuBuilder()
    .setCustomId(`schedule_builder_timezone:${sessionId}`)
    .setPlaceholder(session.timezone ? TIMEZONES.find(timezone => timezone.value === session.timezone)?.label : 'Choose a timezone')
    .setDisabled(session.canEditStreamerInfo === false)
    .addOptions(TIMEZONES.map(timezone => ({
      label: timezone.label,
      value: timezone.value,
      default: timezone.value === session.timezone
    })));
  const eventTypeSelect = new StringSelectMenuBuilder()
    .setCustomId(`schedule_builder_event:${sessionId}`)
    .setPlaceholder('Choose event type for selected day')
    .addOptions(
      { label: 'Weekly recurring', value: 'weekly', default: session.selectedIsRecurring },
      { label: 'One-time event', value: 'once', default: !session.selectedIsRecurring }
    )
    .setDisabled(session.selectedDay === null || session.canEditSchedule === false);
  const userSelect = new UserSelectMenuBuilder()
    .setCustomId(`schedule_builder_user:${sessionId}`)
    .setPlaceholder(session.discordUserId ? 'Discord user linked' : 'Link a Discord user (optional)')
    .setMinValues(0)
    .setMaxValues(1)
    .setDisabled(session.canEditStreamerInfo === false);
  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`schedule_builder_times:${sessionId}`)
      .setLabel(session.selectedDay === null ? 'Set times' : `Set ${DAYS_OF_WEEK[session.selectedDay].name} times`)
      .setStyle(ButtonStyle.Primary)
      .setDisabled(session.selectedDay === null || !session.timezone || session.canEditSchedule === false),
    new ButtonBuilder()
      .setCustomId(`schedule_builder_finish:${sessionId}`)
      .setLabel('Save schedule')
      .setStyle(ButtonStyle.Success)
      .setDisabled(scheduledDays.length === 0 || session.canEditSchedule === false),
    new ButtonBuilder()
      .setCustomId(`schedule_builder_delete_day:${sessionId}`)
      .setLabel(session.selectedDay === null ? 'Delete day' : `Delete ${DAYS_OF_WEEK[session.selectedDay].name}`)
      .setStyle(ButtonStyle.Danger)
      .setDisabled(session.selectedDay === null || !session.existingDays?.has(session.selectedDay) || session.canEditSchedule === false),
    new ButtonBuilder()
      .setCustomId(`schedule_builder_delete_streamer:${sessionId}`)
      .setLabel('Delete streamer')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!session.isExistingStreamer || session.canEditSchedule === false),
    new ButtonBuilder()
      .setCustomId(`schedule_builder_cancel:${sessionId}`)
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary)
  );

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(timezoneSelect),
      new ActionRowBuilder().addComponents(daySelect),
      new ActionRowBuilder().addComponents(eventTypeSelect),
      new ActionRowBuilder().addComponents(userSelect),
      buttons
    ]
  };
}

function getBuilderSession(sessionId, interaction) {
  const session = scheduleBuilderSessions.get(sessionId);
  if (!session || session.userId !== interaction.user.id || session.guildId !== interaction.guildId || Date.now() - session.createdAt > 30 * 60 * 1000) {
    scheduleBuilderSessions.delete(sessionId);
    return null;
  }
  return session;
}

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function getMondayBasedDay(value) {
  const weekday = new Date(`${value}T00:00:00.000Z`).getUTCDay();
  return weekday === 0 ? 6 : weekday - 1;
}

function findTimeOverlap(entries) {
  const minutes = value => {
    const [hours, mins] = value.split(':').map(Number);
    return hours * 60 + mins;
  };
  for (let i = 0; i < entries.length; i += 1) {
    const start = minutes(entries[i].startTime);
    const end = minutes(entries[i].endTime);
    if (start >= end) {
      return 'Each end time must be later than its start time on the same day.';
    }
    for (let j = i + 1; j < entries.length; j += 1) {
      const otherStart = minutes(entries[j].startTime);
      const otherEnd = minutes(entries[j].endTime);
      if (start < otherEnd && otherStart < end) {
        return 'These time entries overlap. Adjust the times so each event ends before the next one starts.';
      }
    }
  }
  return null;
}

async function saveScheduleBuilder(interaction, session, sessionId) {
  if (session.canEditSchedule === false) {
    return interaction.reply({ content: 'Only the streamer who created this schedule or a server admin can change it.', flags: MessageFlags.Ephemeral });
  }
  const dayIndexes = Object.keys(session.entries).map(Number);
  const entries = dayIndexes.flatMap(dayOfWeek => session.entries[dayOfWeek].map(entry => ({
    dayOfWeek,
    startTime: convertTo24Hour(entry.startTime),
    endTime: convertTo24Hour(entry.endTime),
    displayStartTime: entry.startTime,
    displayEndTime: entry.endTime,
    isRecurring: entry.isRecurring,
    specificDate: entry.specificDate
  })));
  if (entries.length === 0) {
    return interaction.reply({ content: 'Configure at least one weekday before saving.', flags: MessageFlags.Ephemeral });
  }
  const existingStreamer = streamScheduleManager.getStreamer(session.guildId, session.streamerName);
  const result = streamScheduleManager.saveScheduleEntries(
    session.guildId,
    session.streamerName,
    entries,
    session.userId,
    session.isAdmin,
    session.discordUserId,
    session.timezone
  );
  if (!result.success) {
    return interaction.reply({ content: result.message, flags: MessageFlags.Ephemeral });
  }

  if (session.canEditStreamerInfo) {
    streamScheduleManager.updateStreamerInfo(session.guildId, session.streamerName, {
      timezone: session.timezone,
      streamUrl: session.streamUrl,
      discordUserId: session.discordUserId
    }, session.userId, session.isAdmin);
  }

  scheduleBuilderSessions.delete(sessionId);
  const embed = new EmbedBuilder()
    .setTitle(existingStreamer ? 'Streamer schedule updated' : 'Streamer schedule created')
    .setDescription(`Saved ${entries.length} schedule entr${entries.length === 1 ? 'y' : 'ies'} across ${dayIndexes.length} day${dayIndexes.length === 1 ? '' : 's'} for **${session.streamerName}**. Other weekdays were left unchanged.`)
    .setColor(0x18A999)
    .addFields({
      name: 'Schedule',
      value: entries.map(entry =>
        `${DAYS_OF_WEEK[entry.dayOfWeek].name}: ${entry.displayStartTime} - ${entry.displayEndTime} (${entry.isRecurring ? 'Weekly' : `One-time ${entry.specificDate}`})`
      ).join('\n').slice(0, 1024),
      inline: false
    });
  return interaction.update({ embeds: [embed], components: [] });
}

async function handleConfig(interaction, guildId, isAdmin) {
  if (!isAdmin) {
    return interaction.reply({ 
      content: '❌ You need administrator permissions to use this command.',
      flags: MessageFlags.Ephemeral
    });
  }

  const action = interaction.options.getString('action');

  if (action === 'view') {
    const settings = guildSettings.getSettings(guildId);
    const scheduleConfig = settings.streamSchedule || {};

    const embed = new EmbedBuilder()
      .setTitle('⚙️ Schedule Configuration')
      .setColor('#00BFFF')
      .addFields(
        { 
          name: 'Status', 
          value: scheduleConfig.enabled !== false ? '✅ Enabled' : '❌ Disabled', 
          inline: true 
        },
        { 
          name: 'Channel', 
          value: scheduleConfig.channelId ? `<#${scheduleConfig.channelId}>` : 'Not set', 
          inline: true 
        }
      );

    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  if (action === 'set_channel') {
    const channel = interaction.options.getChannel('channel');
    if (!channel) {
      return interaction.reply({ 
        content: '❌ Please specify a channel.',
        flags: MessageFlags.Ephemeral
      });
    }

    guildSettings.updateSettings(guildId, {
      streamSchedule: {
        channelId: channel.id,
        enabled: true
      }
    });

    const embed = new EmbedBuilder()
      .setTitle('✅ Channel Set')
      .setDescription(`Schedule embed will be posted in <#${channel.id}>`)
      .setColor('#00FF00');

    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  if (action === 'toggle') {
    const enabled = interaction.options.getBoolean('enabled');
    if (enabled === null) {
      return interaction.reply({ 
        content: '❌ Please specify enabled status.',
        flags: MessageFlags.Ephemeral
      });
    }

    const currentSettings = guildSettings.getSettings(guildId);
    guildSettings.updateSettings(guildId, {
      streamSchedule: {
        ...currentSettings.streamSchedule,
        enabled
      }
    });

    const embed = new EmbedBuilder()
      .setTitle('✅ Setting Updated')
      .setDescription(`Schedule posting is now ${enabled ? 'enabled' : 'disabled'}`)
      .setColor('#00FF00');

    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }
}

async function handlePost(interaction, guildId, isAdmin) {
  if (!isAdmin) {
    return interaction.reply({ 
      content: '❌ You need administrator permissions to use this command.',
      flags: MessageFlags.Ephemeral
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const settings = guildSettings.getSettings(guildId);
  const scheduleConfig = settings.streamSchedule || {};

  if (!scheduleConfig.channelId) {
    return interaction.editReply('❌ Schedule channel not configured. Use `/schedule config set_channel` first.');
  }

  try {
    const channel = await interaction.client.channels.fetch(scheduleConfig.channelId);
    if (!channel || !channel.isTextBased()) {
      return interaction.editReply('❌ Invalid channel or cannot send messages to it.');
    }

    const { embed, components } = await generateWeeklyScheduleEmbed(guildId, 0, interaction.client);

    // Delete old message if exists
    if (scheduleConfig.messageId) {
      try {
        const oldMessage = await channel.messages.fetch(scheduleConfig.messageId).catch(() => null);
        if (oldMessage) {
          await oldMessage.delete();
        }
      } catch (error) {
        console.error('[Schedule] Error deleting old message:', error.message);
      }
    }

    const message = await channel.send({ embeds: [embed], components });

    // Update components with actual message ID for persistence
    const { components: updatedComponents } = await generateWeeklyScheduleEmbed(guildId, 0, interaction.client, message.id);
    await message.edit({ components: updatedComponents });

    // Update settings with new message ID
    guildSettings.updateSettings(guildId, {
      streamSchedule: {
        ...scheduleConfig,
        messageId: message.id
      }
    });

    await interaction.editReply('✅ Weekly schedule posted successfully!');
  } catch (error) {
    console.error('[Schedule] Error posting schedule:', error);
    await interaction.editReply(`❌ Error posting schedule: ${error.message}`);
  }
}