const fs = require('fs');
const path = require('path');
const { EmbedBuilder } = require('discord.js');
const guildSettings = require('./guildSettings');
const branding = require('./configLoader').load('branding');
const RENEWAL_CHECK_INTERVAL = 60 * 1000;
const RENEWAL_LOCK_HEARTBEAT_INTERVAL = 60 * 1000;
const RENEWAL_LOCK_STALE_AFTER = 3 * RENEWAL_LOCK_HEARTBEAT_INTERVAL;
const RENEWAL_LOCK_PATH = path.join(__dirname, '..', 'data', 'booster-renewal-monitor.lock');
const DEFAULT_START_MESSAGE =
  '{mention} started boosting the server! This is boost #{personalBoostCount} for them. The server now has {boostCount} boosts. {tier}';
const DEFAULT_CONTINUED_MESSAGE = branding.boosterContinuedDefaultMessage ||
  'Big thanks to {mention} for continuing to boost us—boost #{personalBoostCount}! We’re now at {boostCount} boosts and {tier}, helping the community grow!';
const DEFAULT_ANNOUNCEMENT_MESSAGE = 'Thank you {mention}!';
const LEGACY_DEFAULT_MESSAGE =
  '{mention} {boostType} the server! This is boost #{personalBoostCount} for them. The server now has {boostCount} boosts. {tier}';
let renewalMonitorStarted = false;
let renewalCheckInProgress = false;
let renewalMonitorLock = null;
let renewalMonitorInterval = null;
let renewalLockHeartbeat = null;
let renewalCheckPromise = null;

function acquireRenewalMonitorLock() {
  const token = `${process.pid}:${Date.now()}:${Math.random()}`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = fs.openSync(RENEWAL_LOCK_PATH, 'wx');
      fs.writeFileSync(fd, token);
      return { fd, token };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }

    let existingToken;
    try {
      existingToken = fs.readFileSync(RENEWAL_LOCK_PATH, 'utf8');
      const lockAge = Date.now() - fs.statSync(RENEWAL_LOCK_PATH).mtimeMs;
      if (!existingToken && lockAge < 10_000) return null;
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }

    let lockStats;
    try {
      lockStats = fs.statSync(RENEWAL_LOCK_PATH);
      if (Date.now() - lockStats.mtimeMs >= RENEWAL_LOCK_STALE_AFTER) {
        const currentToken = fs.readFileSync(RENEWAL_LOCK_PATH, 'utf8');
        const currentStats = fs.statSync(RENEWAL_LOCK_PATH);
        if (currentToken === existingToken &&
            Date.now() - currentStats.mtimeMs >= RENEWAL_LOCK_STALE_AFTER) {
          fs.unlinkSync(RENEWAL_LOCK_PATH);
        }
        continue;
      }
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }

    const ownerPid = Number(existingToken.split(':')[0]);
    if (Number.isInteger(ownerPid) && ownerPid > 0) {
      try {
        process.kill(ownerPid, 0);
        return null;
      } catch (error) {
        if (error.code !== 'ESRCH') return null;
      }
    } else if (Date.now() - lockStats.mtimeMs < 10_000) {
      return null;
    }

    try {
      if (fs.readFileSync(RENEWAL_LOCK_PATH, 'utf8') === existingToken) {
        fs.unlinkSync(RENEWAL_LOCK_PATH);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return null;
}

function releaseRenewalMonitorLock() {
  if (!renewalMonitorLock) return;
  const { fd, token } = renewalMonitorLock;
  renewalMonitorLock = null;
  try {
    fs.closeSync(fd);
    if (fs.readFileSync(RENEWAL_LOCK_PATH, 'utf8') === token) {
      fs.unlinkSync(RENEWAL_LOCK_PATH);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('booster: failed to release renewal monitor lock:', error?.message || error);
    }
  }
}

function getBoosterConfig(guildId) {
  const settings = guildSettings.getSettings(guildId);
  const current = settings.booster || {};
  const legacyMessage = typeof current.message === 'string' ? current.message : '';
  const legacyHasType = legacyMessage.includes('{boostType}');
  const migratedStartMessage = legacyHasType
    ? legacyMessage.replaceAll('{boostType}', 'started boosting')
    : legacyMessage && legacyMessage !== LEGACY_DEFAULT_MESSAGE
      ? legacyMessage
      : DEFAULT_START_MESSAGE;
  const migratedContinuedMessage = legacyHasType
    ? legacyMessage.replaceAll('{boostType}', 'continues to boost')
    : DEFAULT_CONTINUED_MESSAGE;
  const normalized = {
    ...current,
    enabled: current.enabled ?? false,
    channelId: current.channelId || null,
    imageUrl: typeof current.imageUrl === 'string' && current.imageUrl.trim()
      ? current.imageUrl.trim()
      : null,
    announcementMessage: typeof current.announcementMessage === 'string'
      ? current.announcementMessage
      : DEFAULT_ANNOUNCEMENT_MESSAGE,
    newBoostMessage: current.newBoostMessage || migratedStartMessage,
    continuedBoostMessage: current.continuedBoostMessage || migratedContinuedMessage,
    boostsPerMonth: current.boostsPerMonth || 1,
    tracking: current.tracking || {}
  };
  if (Object.keys(normalized).some(key => normalized[key] !== current[key])) {
    guildSettings.updateSettings(guildId, {
      booster: normalized
    });
  }
  return guildSettings.getSettings(guildId).booster;
}

function renderMessage(tpl, data) {
  return tpl
    .replaceAll('{user}', data.userTag || '')
    .replaceAll('{mention}', data.mention || '')
    .replaceAll('{guild}', data.guildName || '')
    .replaceAll('{boostCount}', String(data.boostCount ?? ''))
    .replaceAll('{tier}', data.tier || '')
    .replaceAll('{personalBoostCount}', String(data.personalBoostCount ?? ''))
    .replaceAll('{boostType}', data.boostType || '');
}

function getPremiumSinceTimestamp(member) {
  const value = member?.premiumSinceTimestamp ?? member?.premiumSince?.getTime?.() ?? null;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function getMonthAnniversary(startedAt, monthNumber) {
  const date = new Date(startedAt);
  const day = date.getUTCDate();
  const targetMonth = date.getUTCMonth() + monthNumber;
  const targetYear = date.getUTCFullYear() + Math.floor(targetMonth / 12);
  const normalizedMonth = ((targetMonth % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate();
  date.setUTCDate(1);
  date.setUTCFullYear(targetYear);
  date.setUTCMonth(normalizedMonth);
  date.setUTCDate(Math.min(day, lastDay));
  return date.getTime();
}

function getElapsedBoostMonths(startedAt, now = Date.now()) {
  let elapsed = 0;
  while (getMonthAnniversary(startedAt, elapsed + 1) <= now) elapsed += 1;
  return elapsed;
}

function saveTracking(guildId, userId, entry) {
  const config = getBoosterConfig(guildId);
  const tracking = { ...(config.tracking || {}), [userId]: entry };
  guildSettings.updateSettings(guildId, { booster: { ...config, tracking } });
  return tracking;
}

async function announceBoost(member, type, personalBoostCount, { isTest = false } = {}) {
  const guild = member.guild;
  const boosterCfg = getBoosterConfig(guild.id);
  if ((!boosterCfg.enabled && !isTest) || !boosterCfg.channelId) {
    if (isTest && !boosterCfg.channelId) {
      throw new Error('Set a booster announcement channel before sending a test.');
    }
    return;
  }

  const channel = guild.channels.cache.get(boosterCfg.channelId) ||
    await guild.channels.fetch(boosterCfg.channelId);
  if (!channel?.isTextBased() || typeof channel.send !== 'function') {
    throw new Error(`Booster announcement channel ${boosterCfg.channelId} is not a sendable text channel.`);
  }

  const boostCount = guild.premiumSubscriptionCount || 0;
  const tier = guild.premiumTier ? `Tier ${guild.premiumTier}` : '';
  const messageTemplate = type === 'renewal'
    ? boosterCfg.continuedBoostMessage
    : boosterCfg.newBoostMessage;
  const mention = `<@${member.id}>`;
  const messageData = {
    userTag: member.user?.tag,
    mention,
    guildName: guild.name,
    boostCount,
    tier,
    personalBoostCount,
    boostType: type === 'renewal' ? 'continues to boost' : 'started boosting'
  };
  const content = renderMessage(messageTemplate || '', messageData);
  const announcementMessage = renderMessage(boosterCfg.announcementMessage, messageData).trim();
  const fallbackMessage = `${member} ${type === 'renewal' ? 'continues to boost' : 'started boosting'} the server!`;
  const displayName = member.displayName || member.user?.username || 'A member';
  const image = boosterCfg.imageUrl || branding.boosterImage || '';
  let thumbnailUrl = null;
  let imageAttachment = null;
  if (/^https?:\/\//i.test(image)) {
    thumbnailUrl = image;
  } else if (image) {
    const imagePath = path.resolve(__dirname, '..', image);
    if (!fs.existsSync(imagePath)) {
      throw new Error(`Configured booster image file does not exist: ${imagePath}`);
    }
    const imageName = path.basename(imagePath);
    thumbnailUrl = `attachment://${imageName}`;
    imageAttachment = { attachment: imagePath, name: imageName };
  }
  const description = (content || fallbackMessage).replaceAll(mention, displayName).trim();
  const embed = new EmbedBuilder()
    .setAuthor({ name: displayName, iconURL: member.displayAvatarURL() })
    .setDescription(description);
  if (thumbnailUrl) embed.setThumbnail(thumbnailUrl);
  if (isTest) {
    embed
      .setTitle('Test booster announcement')
      .setFooter({ text: 'Test only — no boost was recorded.' });
  }

  await channel.send({
    content: announcementMessage,
    allowedMentions: { users: [member.id] },
    embeds: [embed],
    ...(imageAttachment ? { files: [imageAttachment] } : {})
  });
}

async function sendTestAnnouncement(member) {
  const config = getBoosterConfig(member.guild.id);
  const personalBoostCount = Number(config.tracking?.[member.id]?.personalBoostCount)
    || Math.max(1, Math.floor(Number(config.boostsPerMonth) || 1));
  await announceBoost(member, 'start', personalBoostCount, { isTest: true });
}

async function handleBoostStart(member, startedAt) {
  const guildId = member.guild.id;
  const config = getBoosterConfig(guildId);
  const previous = config.tracking?.[member.id];
  if (previous?.active && previous.premiumSince === startedAt) return;

  const perMonth = Math.max(1, Math.floor(Number(config.boostsPerMonth) || 1));
  const personalBoostCount = (Number(previous?.personalBoostCount) || 0) + perMonth;
  const entry = {
    active: true,
    premiumSince: startedAt,
    personalBoostCount,
    countedMonths: 1,
    nextAnniversaryAt: getMonthAnniversary(startedAt, 1)
  };
  saveTracking(guildId, member.id, entry);
  await announceBoost(member, 'start', personalBoostCount);
}

async function handleMemberUpdate(oldMember, newMember) {
  const oldBoost = getPremiumSinceTimestamp(oldMember);
  const newBoost = getPremiumSinceTimestamp(newMember);
  if (newBoost && newBoost !== oldBoost) {
    await handleBoostStart(newMember, newBoost);
    return;
  }
  if (oldBoost && !newBoost) {
    const config = getBoosterConfig(newMember.guild.id);
    const previous = config.tracking?.[newMember.id];
    if (previous) {
      saveTracking(newMember.guild.id, newMember.id, {
        ...previous,
        active: false,
        nextAnniversaryAt: null
      });
    }
  }
}

async function seedGuildBoosters(guild) {
  let config = getBoosterConfig(guild.id);
  if (!config.enabled || !config.channelId) return;
  let members;
  try {
    members = await guild.members.fetch();
  } catch (error) {
    console.error(`booster: failed to fetch members for renewal tracking in guild ${guild.id}:`, error?.message || error);
    return;
  }

  config = getBoosterConfig(guild.id);
  for (const member of members.values()) {
    const startedAt = getPremiumSinceTimestamp(member);
    if (!startedAt) continue;
    const previous = config.tracking?.[member.id];
    if (previous?.active && previous.premiumSince === startedAt) continue;
    const elapsedMonths = getElapsedBoostMonths(startedAt);
    const perMonth = Math.max(1, Math.floor(Number(config.boostsPerMonth) || 1));
    const personalBoostCount = (Number(previous?.personalBoostCount) || 0) + (elapsedMonths + 1) * perMonth;
    saveTracking(guild.id, member.id, {
      active: true,
      premiumSince: startedAt,
      personalBoostCount,
      countedMonths: elapsedMonths + 1,
      nextAnniversaryAt: getMonthAnniversary(startedAt, elapsedMonths + 1)
    });
  }
}

async function seedActiveBoosters(client) {
  for (const guild of client.guilds.cache.values()) {
    await seedGuildBoosters(guild);
  }
}

async function checkRenewals(client, now = Date.now()) {
  for (const guild of client.guilds.cache.values()) {
    let config = getBoosterConfig(guild.id);
    const dueEntries = Object.entries(config.tracking || {}).filter(([, entry]) =>
      entry?.active && entry.nextAnniversaryAt && entry.nextAnniversaryAt <= now
    );

    for (const [userId] of dueEntries) {
      config = getBoosterConfig(guild.id);
      let entry = config.tracking?.[userId];
      if (!entry?.active || !entry.nextAnniversaryAt || entry.nextAnniversaryAt > now) continue;

      let member;
      try {
        member = await guild.members.fetch(userId);
      } catch (error) {
        if (error.code === 10007) {
          const latestEntry = getBoosterConfig(guild.id).tracking?.[userId];
          if (latestEntry?.active && latestEntry.premiumSince === entry.premiumSince) {
            saveTracking(guild.id, userId, { ...latestEntry, active: false, nextAnniversaryAt: null });
          }
          continue;
        }
        console.error(`booster: failed to check member ${userId} in guild ${guild.id}:`, error?.message || error);
        continue;
      }

      config = getBoosterConfig(guild.id);
      const latestEntry = config.tracking?.[userId];
      if (!latestEntry?.active || latestEntry.premiumSince !== entry.premiumSince) continue;
      entry = latestEntry;

      const currentPremiumSince = getPremiumSinceTimestamp(member);
      if (currentPremiumSince !== entry.premiumSince) {
        if (currentPremiumSince) await handleBoostStart(member, currentPremiumSince);
        else saveTracking(guild.id, userId, { ...entry, active: false, nextAnniversaryAt: null });
        continue;
      }

      const elapsedMonths = getElapsedBoostMonths(entry.premiumSince, now);
      const newlyCountedMonths = Math.max(0, elapsedMonths + 1 - entry.countedMonths);
      if (!newlyCountedMonths) continue;

      const perMonth = Math.max(1, Math.floor(Number(config.boostsPerMonth) || 1));
      const personalBoostCount = entry.personalBoostCount + newlyCountedMonths * perMonth;
      const updated = {
        ...entry,
        personalBoostCount,
        countedMonths: elapsedMonths + 1,
        nextAnniversaryAt: getMonthAnniversary(entry.premiumSince, elapsedMonths + 1)
      };
      saveTracking(guild.id, userId, updated);
      try {
        await announceBoost(member, 'renewal', personalBoostCount);
      } catch (error) {
        console.error(`booster: failed to announce renewal for member ${userId} in guild ${guild.id}:`, error?.message || error);
      }
    }
  }
}

function startRenewalMonitor(client) {
  if (renewalMonitorStarted) return;
  renewalMonitorLock = acquireRenewalMonitorLock();
  if (!renewalMonitorLock) {
    console.warn('booster: renewal monitor is already running in another process; skipping this instance.');
    return;
  }
  renewalMonitorStarted = true;
  process.once('exit', releaseRenewalMonitorLock);
  const runCheck = async (seed = false) => {
    if (renewalCheckInProgress) return;
    renewalCheckInProgress = true;
    const checkPromise = (async () => {
      if (seed) await seedActiveBoosters(client);
      await checkRenewals(client);
    })();
    renewalCheckPromise = checkPromise;
    try {
      await checkPromise;
    } finally {
      renewalCheckInProgress = false;
      if (renewalCheckPromise === checkPromise) renewalCheckPromise = null;
    }
  };
  void runCheck(true).catch(error => console.error('booster: initial renewal tracking failed:', error?.message || error));

  renewalMonitorInterval = setInterval(() => {
    void runCheck().catch(error => console.error('booster: renewal check failed:', error?.message || error));
  }, RENEWAL_CHECK_INTERVAL);
  renewalLockHeartbeat = setInterval(() => {
    if (!renewalMonitorLock) return;
    const { fd, token } = renewalMonitorLock;
    try {
      if (fs.readFileSync(RENEWAL_LOCK_PATH, 'utf8') !== token) {
        void stopRenewalMonitor();
        return;
      }
      const now = new Date();
      fs.futimesSync(fd, now, now);
    } catch (error) {
      console.error('booster: failed to refresh renewal monitor lock:', error?.message || error);
      void stopRenewalMonitor();
    }
  }, RENEWAL_LOCK_HEARTBEAT_INTERVAL);
}

async function stopRenewalMonitor() {
  if (renewalMonitorInterval) {
    clearInterval(renewalMonitorInterval);
    renewalMonitorInterval = null;
  }
  if (renewalLockHeartbeat) {
    clearInterval(renewalLockHeartbeat);
    renewalLockHeartbeat = null;
  }
  if (renewalCheckPromise) {
    try {
      await renewalCheckPromise;
    } catch (error) {
      console.error('booster: renewal check failed during shutdown:', error?.message || error);
    }
  }
  renewalMonitorStarted = false;
  releaseRenewalMonitorLock();
}

function setEnabled(guildId, enabled) {
  const booster = getBoosterConfig(guildId);
  guildSettings.updateSettings(guildId, { booster: { ...booster, enabled: !!enabled } });
}

function setChannel(guildId, channelId) {
  const booster = getBoosterConfig(guildId);
  guildSettings.updateSettings(guildId, { booster: { ...booster, channelId } });
}

function setImageUrl(guildId, imageUrl) {
  const booster = getBoosterConfig(guildId);
  guildSettings.updateSettings(guildId, { booster: { ...booster, imageUrl } });
}

function setAnnouncementMessage(guildId, message) {
  const booster = getBoosterConfig(guildId);
  guildSettings.updateSettings(guildId, { booster: { ...booster, announcementMessage: message } });
}

function setMessage(guildId, message) {
  const booster = getBoosterConfig(guildId);
  guildSettings.updateSettings(guildId, {
    booster: {
      ...booster,
      newBoostMessage: message,
      continuedBoostMessage: message
    }
  });
}

function setNewBoostMessage(guildId, message) {
  const config = getBoosterConfig(guildId);
  guildSettings.updateSettings(guildId, { booster: { ...config, newBoostMessage: message } });
}

function setContinuedBoostMessage(guildId, message) {
  const config = getBoosterConfig(guildId);
  guildSettings.updateSettings(guildId, { booster: { ...config, continuedBoostMessage: message } });
}

function setBoostsPerMonth(guildId, boostsPerMonth) {
  const config = getBoosterConfig(guildId);
  const count = Number(boostsPerMonth);
  if (!Number.isInteger(count) || count < 1 || count > 10) {
    throw new RangeError('Boosts counted per booster each month must be an integer from 1 to 10.');
  }
  guildSettings.updateSettings(guildId, { booster: { ...config, boostsPerMonth: count } });
}

function getConfig(guildId) {
  return getBoosterConfig(guildId);
}

module.exports = {
  handleMemberUpdate,
  checkRenewals,
  seedGuildBoosters,
  startRenewalMonitor,
  stopRenewalMonitor,
  sendTestAnnouncement,
  setEnabled,
  setChannel,
  setImageUrl,
  setAnnouncementMessage,
  setMessage,
  setNewBoostMessage,
  setContinuedBoostMessage,
  setBoostsPerMonth,
  getConfig
};