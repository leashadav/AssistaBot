const cron = require('node-cron');
const { generateWeeklyScheduleEmbed } = require('./streamScheduleEmbed');
const guildSettings = require('./guildSettings');
const streamScheduleManager = require('./streamScheduleManager');
const { DEFAULT_TIMEZONE } = require('../utils/timezone');

class StreamSchedulePoster {
  constructor(client) {
    this.client = client;
    this.isRunning = false;
  }

  start() {
    if (this.isRunning) {
      console.log('[SchedulePoster] Already running');
      return;
    }

    this.isRunning = true;

    // Keep the posting time at 3:00 AM in the configured time zone.
    cron.schedule('0 3 * * 1', async () => {
      await this.postWeeklySchedules();
    }, {
      timezone: DEFAULT_TIMEZONE
    });

    // Also schedule daily cleanup of expired one-time events at midnight UTC
    cron.schedule('0 0 * * *', async () => {
      streamScheduleManager.cleanupExpiredEvents();
    }, {
      timezone: 'UTC'
    });

  }

  async postWeeklySchedules() {
    for (const [guildId] of this.client.guilds.cache) {
      try {
        const settings = guildSettings.getSettings(guildId);
        const scheduleConfig = settings.streamSchedule || {};

        // Skip if not enabled or no channel configured
        if (scheduleConfig.enabled === false || !scheduleConfig.channelId) {
          continue;
        }

        const channel = await this.client.channels.fetch(scheduleConfig.channelId).catch(() => null);
        if (!channel || !channel.isTextBased()) {
          console.error(`[SchedulePoster] Invalid channel for guild ${guildId}`);
          continue;
        }

        // Generate and post the weekly schedule embed
        const { embed, components } = await generateWeeklyScheduleEmbed(guildId, 0, this.client);

        // Delete old message if exists
        if (scheduleConfig.messageId) {
          try {
            const oldMessage = await channel.messages.fetch(scheduleConfig.messageId).catch(() => null);
            if (oldMessage) {
              await oldMessage.delete();
            }
          } catch (error) {
            console.error(`[SchedulePoster] Error deleting old message for guild ${guildId}:`, error.message);
          }
        }

        // Post new message with initial components
        const message = await channel.send({ embeds: [embed], components });

        // Update components with actual message ID for persistence
        const { components: updatedComponents } = await generateWeeklyScheduleEmbed(guildId, 0, this.client, message.id);
        await message.edit({ components: updatedComponents });

        // Update settings with new message ID
        guildSettings.updateSettings(guildId, {
          streamSchedule: {
            ...scheduleConfig,
            messageId: message.id
          }
        });
      } catch (error) {
        console.error(`[SchedulePoster] Error posting schedule for guild ${guildId}:`, error);
      }
    }
  }

  stop() {
    this.isRunning = false;
    console.log('[SchedulePoster] Stopped');
  }
}

module.exports = StreamSchedulePoster;