const { checkBirthdays } = require('../modules/birthdayManager');
const { initInvites } = require('../modules/inviteTracker');
const { ActivityType, PresenceUpdateStatus } = require('discord.js');
const { sendLog } = require('../modules/logger');
const streamNotifier = require('../modules/streamNotifier');
const { buildStreamEmbed } = require('../modules/streamEmbeds');
const streamRegistry = require('../modules/streamRegistry');
const DEBUG = /^(1|true)$/i.test(String(process.env.ASSISTABOT_DEBUG || ''));

// In-memory presence state per guild:user to avoid duplicate posts
const presenceState = new Map(); // key: `${gid}:${uid}` -> { live: boolean, lastPostAt: number }

function isStreamingPresence(presence) {
  if (!presence) return { streaming: false };
  const act = (presence.activities || []).find(a => a && a.type === ActivityType.Streaming && a.url);
  if (!act) return { streaming: false };
  return { streaming: true, activity: act };
}

function inferPlatformFromUrl(url) {
  try {
    const u = new URL(url);
    const h = u.hostname.toLowerCase();
    if (h.includes('twitch.tv')) return 'twitch';
    if (h.includes('youtube.com') || h.includes('youtu.be')) return 'youtube';
  } catch (error) {
    // Invalid URL, default to twitch
  }
  return 'twitch';
}

function renderMessage(template, ctx) {
  const base = template || `**[{name}]({url}) is now streaming!**`;
  return base.replaceAll('{name}', ctx.name || '')
    .replaceAll('{title}', ctx.title || '')
    .replaceAll('{url}', ctx.url || '');
}

module.exports = {
  name: 'clientReady',
  once: true,
  async execute(client) {
    if (DEBUG) console.log('client.channels:', client.channels);
    console.log(`Ready! Logged in as ${client.user.tag}`);

    client.user.setPresence({
      activities: [
        { name: "Using a fire extinguisher on Shadav's brain", type: ActivityType.Custom }
      ],
      status: PresenceUpdateStatus.Online
    });

    // Post an embed to each guild's assistabotLogging channel (if configured)
    try {
      const base = `<:hello:1410378395983937556> ${client.user} is online`;
      const extra = DEBUG ? `\nPID: ${process.pid} | Node: ${process.version} | Guilds: ${client.guilds.cache.size}` : '';
      const content = `${base}${extra}`;
      for (const [gid] of client.guilds.cache) {
        await sendLog(client, gid, 'assistabotLogging', content);
      }
    } catch (error) {
      // Ignore log send errors
    }

    // Init invite tracking
    initInvites(client);

    // Birthday checker every 24h
    setInterval(() => checkBirthdays(client), 86400000);

    // Presence-based streaming notifier (role + message based on Discord activity)
    client.on('presenceUpdate', async (oldPresence, newPresence) => {
      try {
        const p = newPresence || oldPresence;
        if (!p || !p.member || !p.guild) return;
        const gid = p.guild.id;
        const uid = p.member.id;
        const key = `${gid}:${uid}`;

        const { streaming, activity } = isStreamingPresence(newPresence);
        const prior = presenceState.get(key) || { live: false, lastPostAt: 0 };

        const rules = streamRegistry.getPresence(gid); // { twitch?: {...}, youtube?: {...} }
        const hasRules = !!(rules?.twitch || rules?.youtube);

        if (streaming) {
          const member = p.member;
          const now = Date.now();
          const url = activity.url || '';
          const platform = inferPlatformFromUrl(url);
          const username = member.displayName || member.user.username;
          const avatarUrl = member.displayAvatarURL({ size: 256 });
          const title = activity.details || activity.name || 'Live now';
          const game = activity.state || '';
          const imageUrl = null;

          // Prefer presence rules. If none, fallback to per-user entries.
          if (hasRules) {
            const rule = rules[platform];
            if (rule) {
              const whitelistOk = !rule.whitelistRoleIds?.length || rule.whitelistRoleIds.some(r => member.roles.cache.has(r));
              if (whitelistOk) {
                // Assign live roles from rule
                for (const rid of (rule.liveRoleIds || [])) {
                  if (rid && !member.roles.cache.has(rid)) {
                    await member.roles.add(rid).catch((error) => {
                      // Ignore role add errors
                    });
                  }
                }
                // Post with cooldown per user
                if (!(prior.live && (now - prior.lastPostAt) < 30 * 60 * 1000)) {
                  if (rule.channelId) {
                    const ch = client.channels.cache.get(rule.channelId);
                    if (ch?.isTextBased()) {
                      const embed = buildStreamEmbed({ platform, username, avatarUrl, url, title, game, imageUrl });
                      const content = renderMessage(rule.message, { name: username, title, url });
                      await ch.send({ content, embeds: [embed] }).catch((error) => {
                        // Ignore message send errors
                      });
                    }
                  }
                }
              }
            }
          } else {
            // Fallback: legacy per-user entries path
            const entries = (streamRegistry.list(gid) || []).filter(e => e.discordUser === uid);
            for (const entry of entries) {
              const whitelistOk = !entry.whitelistRoleIds?.length || entry.whitelistRoleIds.some(r => member.roles.cache.has(r));
              if (!whitelistOk) continue;
              const roles = Array.isArray(entry.liveRoleIds) ? entry.liveRoleIds : (entry.liveRoleId ? [entry.liveRoleId] : []);
              for (const rid of roles) {
                if (rid && !member.roles.cache.has(rid)) {
                  await member.roles.add(rid).catch((error) => {
                    // Ignore role add errors
                  });
                }
              }
              if (!(prior.live && (now - prior.lastPostAt) < 30 * 60 * 1000)) {
                const embed = buildStreamEmbed({ platform, username, avatarUrl, url, title, game, imageUrl });
                const content = renderMessage(entry.message, { name: username, title, url });
                if (entry.channelId) {
                  const ch = client.channels.cache.get(entry.channelId);
                  if (ch?.isTextBased()) {
                    await ch.send({ content, embeds: [embed] }).catch((error) => {
                      // Ignore message send errors
                    });
                  }
                }
              }
            }
          }

          presenceState.set(key, { live: true, lastPostAt: Date.now() });
        } else {
          // Remove roles when no longer streaming. Prefer rules if present; else legacy entries.
          const member = p.member;
          if (hasRules) {
            for (const plat of ['twitch', 'youtube']) {
              const rule = rules[plat];
              if (rule && member) {
                for (const rid of (rule.liveRoleIds || [])) {
                  if (rid && member.roles.cache.has(rid)) {
                    await member.roles.remove(rid).catch((error) => {
                      // Ignore role remove errors
                    });
                  }
                }
              }
            }
          } else {
            const entries = (streamRegistry.list(gid) || []).filter(e => e.discordUser === uid);
            for (const entry of entries) {
              if (member) {
                const roles = Array.isArray(entry.liveRoleIds) ? entry.liveRoleIds : (entry.liveRoleId ? [entry.liveRoleId] : []);
                for (const rid of roles) {
                  if (rid && member.roles.cache.has(rid)) {
                    await member.roles.remove(rid).catch((error) => {
                      // Ignore role remove errors
                    });
                  }
                }
              }
            }
          }
          const currentState = presenceState.get(key);
          presenceState.set(key, { live: false, lastPostAt: currentState?.lastPostAt || 0 });
        }
      } catch (error) {
        // Ignore presence update errors
      }
    });

    // Start stream polling (Twitch/YouTube) unless disabled
    if (!/^(1|true)$/i.test(String(process.env.ASSISTABOT_DISABLE_STREAM_POLLING || ''))) {
      try {
        await streamNotifier.start(client, 120000);
      } catch (error) {
        // Ignore stream notifier start errors
      }
    }
  },
};