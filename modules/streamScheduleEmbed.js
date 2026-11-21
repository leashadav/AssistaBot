const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const streamScheduleManager = require('./streamScheduleManager');
const guildSettings = require('./guildSettings');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const {
  getDateForWeekdayInTimezone,
  getLocalTimeTimestamp
} = require('../utils/timezone');

dayjs.extend(utc);

// Helper function to convert 24-hour format to 12-hour format for display
function convertTo12Hour(time24h) {
  let [hours, minutes] = time24h.split(':');
  hours = parseInt(hours, 10);
  
  const modifier = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12; // 0 should be 12
  
  return `${hours}:${minutes} ${modifier}`;
}

function getDiscordTimestamp(dayOfWeek, localTime, timezone, specificDate = null, nextDay = false) {
  let date = specificDate || getDateForWeekdayInTimezone(dayOfWeek, timezone);
  if (nextDay) {
    date = dayjs.utc(`${date}T00:00:00Z`).add(1, 'day').format('YYYY-MM-DD');
  }
  return getLocalTimeTimestamp(date, localTime, timezone);
}

// Helper function to get the date for a specific day of the current week (Monday-start)
function getDateForDayOfWeek(dayOfWeek) {
  const today = dayjs();
  const currentDay = today.day(); // Sunday = 0, Monday = 1, etc. (dayjs method)
  
  // Convert to Monday-start: Monday = 0, Tuesday = 1, ..., Sunday = 6
  const mondayStartCurrentDay = currentDay === 0 ? 6 : currentDay - 1;
  
  const diff = dayOfWeek - mondayStartCurrentDay;
  const targetDate = today.add(diff, 'day');
  
  return targetDate.format('dddd, MMMM D, YYYY');
}

const DAYS_OF_WEEK = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday'
];

// Helper function to get guild-specific embed color
function getEmbedColor(guildId) {
  try {
    const settings = guildSettings.getSettings(guildId);
    const raw = settings?.embedColor;
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      return raw >>> 0; // ensure uint32
    } else if (typeof raw === 'string' && raw.trim()) {
      let s = raw.trim();
      if (s.startsWith('#')) s = s.slice(1);
      const n = parseInt(s, 16);
      if (!Number.isNaN(n)) return n >>> 0;
    }
  } catch (error) {
    console.error('Error getting embed color:', error);
  }
  return 0x00BFFF; // Default blue
}

// Generate embed for a specific day
async function generateDayEmbed(guildId, dayIndex, client) {
  const schedules = streamScheduleManager.getSchedulesForDay(guildId, dayIndex);
  const embedColor = getEmbedColor(guildId);
  const date = getDateForDayOfWeek(dayIndex);
  
  const embed = new EmbedBuilder()
    .setTitle(`📅 ${date} Streamer Schedules`)
    .setColor(embedColor);

  if (schedules.length === 0) {
    embed.addFields({
      name: '',
      value: '**There are no streams scheduled for this day.**',
      inline: false
    });
    return embed;
  }

  // Schedules are stored in the streamer's local wall-clock time.
  schedules.sort((a, b) => {
    const [aHour, aMin] = a.startTime.split(':').map(Number);
    const [bHour, bMin] = b.startTime.split(':').map(Number);
    const aTime = aHour * 60 + aMin;
    const bTime = bHour * 60 + bMin;
    
    // First sort by local start time
    if (aTime !== bTime) {
      return aTime - bTime;
    }
    
    // If same time, sort alphabetically by streamer name
    return a.streamerName.localeCompare(b.streamerName);
  });

  // Create schedule display without grid
  const scheduleEntries = [];
  for (const [index, schedule] of schedules.entries()) {
    // Get display name (nickname if Discord user, otherwise streamer name)
    let displayName = schedule.streamerName;
    if (schedule.discordUserId && client) {
      try {
        const guild = await client.guilds.fetch(guildId);
        const member = await guild.members.fetch(schedule.discordUserId).catch(() => null);
        if (member) {
          displayName = member.displayName;
        }
      } catch (error) {
        // Fall back to streamer name if Discord fetch fails
        console.error('Error fetching Discord nickname:', error.message);
      }
    }
    
    // Link display name to stream URL if provided
    let streamerInfo;
    if (schedule.streamUrl) {
      streamerInfo = `[${displayName}](${schedule.streamUrl})`;
    } else {
      streamerInfo = `**${displayName}**`;
    }
    
    let eventType = schedule.isRecurring ? '' : '✨ Special Event';
    if (!schedule.isRecurring && schedule.specificDate) {
      eventType += ` (${schedule.specificDate})`;
    }

    // Get Discord timestamps for timezone-aware display
    const startTimeTimestamp = getDiscordTimestamp(
      dayIndex,
      schedule.startTime,
      schedule.timezone || 'UTC',
      schedule.specificDate
    );
    const endsNextDay = schedule.endTime <= schedule.startTime;
    const endTimeTimestamp = getDiscordTimestamp(
      dayIndex,
      schedule.endTime,
      schedule.timezone || 'UTC',
      schedule.specificDate,
      endsNextDay
    );
    
    scheduleEntries.push(`${index + 1}. **${streamerInfo}**\n   📡<t:${startTimeTimestamp}:t> - <t:${endTimeTimestamp}:t> ${eventType}\n`);
  }

  const fieldValues = [];
  let fieldValue = '';
  let totalCharacters = 0;
  let omittedEntries = 0;
  for (let index = 0; index < scheduleEntries.length; index += 1) {
    const entry = scheduleEntries[index];
    const requiresNewField = fieldValue.length + entry.length > 1024;
    if (totalCharacters + entry.length > 5400) {
      omittedEntries = scheduleEntries.length - index;
      break;
    }
    if (requiresNewField) {
      fieldValues.push(fieldValue);
      fieldValue = '';
      if (fieldValues.length >= 23) {
        omittedEntries = scheduleEntries.length - index;
        break;
      }
    }
    fieldValue += entry;
    totalCharacters += entry.length;
  }

  if (fieldValue) fieldValues.push(fieldValue);
  for (const value of fieldValues) embed.addFields({ name: 'Schedule', value, inline: false });
  if (omittedEntries) {
    embed.addFields({
      name: 'More scheduled streams',
      value: `${omittedEntries} additional entr${omittedEntries === 1 ? 'y was' : 'ies were'} omitted to fit Discord's embed limits.`,
      inline: false
    });
  }

  return embed;
}

// Generate the complete weekly schedule embed with pagination
async function generateWeeklyScheduleEmbed(guildId, currentPage = 0, client, messageId = null) {
  const embedColor = getEmbedColor(guildId);
  const totalPages = 7; // One page per day
  
  const embed = await generateDayEmbed(guildId, currentPage, client);
  embed.setFooter({ text: `Page ${currentPage + 1}/${totalPages}` });

  // Create navigation buttons with message-specific IDs for persistence
  const messageSuffix = messageId || 'initial';
  const row = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId(`schedule_prev_${messageSuffix}`)
        .setLabel('◀️')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`schedule_next_${messageSuffix}`)
        .setLabel('▶️')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`schedule_refresh_${messageSuffix}`)
        .setLabel('🔄')
        .setStyle(ButtonStyle.Secondary)
    );

  return { embed, components: [row] };
}

// Handle button interactions for pagination
async function handleScheduleButtonInteraction(interaction) {
  const customId = interaction.customId;
  const guildId = interaction.guildId;
  
  if (!customId.startsWith('schedule_')) {
    return;
  }

  // Parse customId: schedule_action_messageId or schedule_action (for backwards compatibility)
  const parts = customId.split('_');
  const action = parts[1]; // prev, next, or refresh
  const messageId = parts[2] || interaction.message.id; // Use message ID for persistence
  
  const currentEmbed = interaction.message.embeds[0];
  const footerText = currentEmbed.footer?.text || '';
  const pageMatch = footerText.match(/Page (\d+)\/7/);
  
  if (!pageMatch) {
    return interaction.reply({ 
      content: 'Error: Could not determine current page.', 
      ephemeral: true 
    });
  }

  let currentPage = parseInt(pageMatch[1]) - 1;
  const totalPages = 7;

  if (action === 'prev') {
    // Round-robin: if at page 0, go to last page
    currentPage = currentPage === 0 ? totalPages - 1 : currentPage - 1;
  } else if (action === 'next') {
    // Round-robin: if at last page, go to page 0
    currentPage = currentPage === totalPages - 1 ? 0 : currentPage + 1;
  } else if (action === 'refresh') {
    // Stay on same page but refresh data
  } else {
    return interaction.reply({ 
      content: 'Invalid action.', 
      ephemeral: true 
    });
  }

  const { embed, components } = await generateWeeklyScheduleEmbed(guildId, currentPage, interaction.client);

  await interaction.update({ embeds: [embed], components });
}

module.exports = {
  generateWeeklyScheduleEmbed,
  generateDayEmbed,
  handleScheduleButtonInteraction,
  DAYS_OF_WEEK,
  convertTo12Hour,
  getDiscordTimestamp
};