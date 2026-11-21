const UPLOAD_NOTIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 1000;

function trackUploadNotification(notifier, entry, channelId, messageId) {
  if (!Array.isArray(entry._uploadNotifications)) entry._uploadNotifications = [];
  entry._uploadNotifications.push({
    channelId,
    messageId,
    deleteAt: Date.now() + UPLOAD_NOTIFICATION_TTL_MS
  });
  notifier.saveData();
}

async function cleanupExpiredUploadNotifications(notifier, platform) {
  let changed = false;
  const now = Date.now();

  for (const [, guildData] of notifier.guildChannels.entries()) {
    for (const entry of guildData.channels) {
      if (!Array.isArray(entry._uploadNotifications)) continue;

      const remaining = [];
      for (const notification of entry._uploadNotifications) {
        if (!Number.isFinite(notification.deleteAt) || notification.deleteAt > now) {
          remaining.push(notification);
          continue;
        }

        try {
          const channel = await notifier.client.channels.fetch(notification.channelId);
          if (!channel?.isTextBased()) {
            throw new Error(`Channel ${notification.channelId} is unavailable or not text-based`);
          }

          let message;
          try {
            message = await channel.messages.fetch(notification.messageId);
          } catch (err) {
            if (err.code === 10008) {
              changed = true;
              continue;
            }
            throw err;
          }

          await message.delete();
          changed = true;
        } catch (err) {
          if (err.code === 10008) {
            changed = true;
            continue;
          }
          console.error(`[${platform}] Error deleting expired upload notification:`, err.message);
          remaining.push(notification);
        }
      }

      if (remaining.length !== entry._uploadNotifications.length) {
        entry._uploadNotifications = remaining;
        changed = true;
      }
    }
  }

  if (changed) notifier.saveData();
}

function startUploadNotificationCleanup(notifier, platform) {
  if (notifier.uploadCleanupInterval) return;

  cleanupExpiredUploadNotifications(notifier, platform).catch(err => {
    console.error(`[${platform}] Upload notification cleanup failed:`, err.message);
  });
  notifier.uploadCleanupInterval = setInterval(() => {
    cleanupExpiredUploadNotifications(notifier, platform).catch(err => {
      console.error(`[${platform}] Upload notification cleanup failed:`, err.message);
    });
  }, CLEANUP_INTERVAL_MS);
  notifier.uploadCleanupInterval.unref?.();
}

function stopUploadNotificationCleanup(notifier) {
  if (!notifier.uploadCleanupInterval) return;
  clearInterval(notifier.uploadCleanupInterval);
  notifier.uploadCleanupInterval = null;
}

module.exports = {
  trackUploadNotification,
  startUploadNotificationCleanup,
  stopUploadNotificationCleanup
};
