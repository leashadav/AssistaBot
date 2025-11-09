const { sendLog } = require('../modules/logger');
const { getLogChannel } = require('../modules/guildSettings');

const DEBUG = /^(1|true)$/i.test(String(process.env.ASSISTABOT_DEBUG || ''));

// Simple in-process rate limiter: max N events per time window
const WINDOW_MS = 60_000; // 1 minute
const MAX_EVENTS = 20;    // tune as needed
let buckets = [];

function rateLimitAllow() {
  const now = Date.now();
  buckets = buckets.filter(ts => now - ts < WINDOW_MS);
  if (buckets.length >= MAX_EVENTS) return false;
  buckets.push(now);
  return true;
}

module.exports = {
  name: 'messageUpdate',
  async execute(oldMessage, newMessage, client) {
    // Fetch partials safely (always)
    try {
      if (oldMessage?.partial && typeof oldMessage.fetch === 'function') {
        oldMessage = await oldMessage.fetch();
      }
    } catch (error) {
      // Ignore fetch errors for partial messages
    }

    try {
      if (newMessage?.partial && typeof newMessage.fetch === 'function') {
        newMessage = await newMessage.fetch();
      }
    } catch (error) {
      // Ignore fetch errors for partial messages
    }

    const oldId = oldMessage?.id;
    const newId = newMessage?.id;
    const oldPartial = !!oldMessage?.partial;
    const newPartial = !!newMessage?.partial;
    const guildId = newMessage.guildId || oldMessage?.guildId || newMessage.guild?.id || oldMessage?.guild?.id;
    const channelId = newMessage.channelId || oldMessage?.channelId || newMessage.channel?.id || oldMessage?.channel?.id;

    const oldContent = typeof oldMessage?.content === 'string' ? oldMessage.content : null;
    const newContent = typeof newMessage?.content === 'string' ? newMessage.content : null;

    // Console logging only when DEBUG and under rate limit
    if (DEBUG && rateLimitAllow()) {
      console.info({
        event: 'message_update',
        oldId,
        newId,
        oldPartial,
        newPartial,
        guild: guildId,
        channel: channelId,
        oldContent: oldContent ?? '(unavailable)',
        newContent: newContent ?? '(unavailable)'
      });
    }

    // Always allow embed send when there is an actual content change available
    if (guildId && channelId && oldContent !== null && newContent !== null && oldContent !== newContent) {
      const content = [
        `Message updated in <#${channelId}>`,
        `Old: ${oldContent || '[empty]'}`,
        `New: ${newContent || '[empty]'}`
      ].join('\n');
      try {
        await sendLog(client, guildId, 'messageUpdate', content);
      } catch (error) {
        // Ignore log send errors
      }
    }
  }
};