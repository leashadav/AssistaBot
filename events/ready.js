const { checkBirthdays } = require('../modules/birthdayManager');
const { initInvites } = require('../modules/inviteTracker');
const { ActivityType, PresenceUpdateStatus, EmbedBuilder } = require('discord.js');
const { sendLog } = require('../modules/logger');
const streamNotifier = require('../modules/streamNotifier');
// buildStreamEmbed is now imported with platformMeta above
const streamRegistry = require('../modules/streamRegistry');
// Only log errors
const DEBUG = false;

// In-memory presence state per guild:user to track streaming status and notifications
const presenceState = new Map(); // key: `${gid}:${uid}` -> { live: boolean, lastPostAt: number, notificationMessageId: string, channelId: string }

function isStreamingPresence(presence) {
  if (!presence) return { streaming: false };
  
  // Check for any streaming activity
  const activities = presence.activities || [];
  
  // First, look for explicit streaming activities
  const streamingActivity = activities.find(a => a && (
    a.type === ActivityType.Streaming || // Standard streaming activity
    (a.type === ActivityType.Playing && a.name === 'Twitch') || // Some clients report Twitch streaming as Playing
    (a.type === ActivityType.Playing && a.name === 'YouTube') || // Some clients report YouTube streaming as Playing
    (a.type === ActivityType.Custom && a.state && a.state.includes('Streaming')) // Some custom statuses indicate streaming
  ));
  
  if (streamingActivity) {
    return { 
      streaming: true, 
      activity: {
        ...streamingActivity,
        // Ensure we have a URL for the activity
        url: streamingActivity.url || (() => {
          // Try to construct a URL based on the activity name
          const name = (streamingActivity.name || '').toLowerCase();
          if (name.includes('twitch')) return 'https://www.twitch.tv/';
          if (name.includes('youtube') || name.includes('youtu.be')) return 'https://www.youtube.com/';
          if (name.includes('kick')) return 'https://kick.com/';
          if (name.includes('rumble')) return 'https://rumble.com/';
          if (name.includes('tiktok')) return 'https://www.tiktok.com/';
          if (name.includes('instagram')) return 'https://www.instagram.com/';
          if (name.includes('facebook')) return 'https://www.facebook.com/';
          if (name.includes('x') || name.includes('twitter')) return 'https://x.com/';
          return 'https://discord.com/';
        })()
      }
    };
  }
  
  // Check if the user is in a voice channel with video or streaming
  if (presence.guild && presence.member?.voice?.channel) {
    // Check if the user is streaming (Discord's native streaming)
    const voiceState = presence.guild.voiceStates.cache.get(presence.member.id);
    if (voiceState?.streaming) {
      return {
        streaming: true,
        activity: {
          name: 'Discord Stream',
          type: ActivityType.Streaming,
          url: 'https://discord.com/',
          details: 'Streaming on Discord',
          state: 'In ' + presence.member.voice.channel.name
        }
      };
    }
  }
  
  return { streaming: false };
}

function inferPlatformFromUrl(url) {
  if (!url) return 'discord'; // Default to discord if no URL (e.g., Discord streaming)
  
  try {
    const u = new URL(url);
    const h = u.hostname.toLowerCase();
    
    // Check all supported platforms
    if (h.includes('twitch.tv')) return 'twitch';
    if (h.includes('youtube.com') || h.includes('youtu.be')) return 'youtube';
    if (h.includes('kick.com')) return 'kick';
    if (h.includes('rumble.com')) return 'rumble';
    if (h.includes('tiktok.com')) return 'tiktok';
    if (h.includes('instagram.com')) return 'instagram';
    if (h.includes('facebook.com')) return 'facebook';
    if (h.includes('x.com') || h.includes('twitter.com')) return 'x';
    
    // For Discord streaming, the URL might be a Discord URL or null
    if (h.includes('discord.com') || h.includes('discord.gg')) return 'discord';
    
  } catch (error) {
    // If URL parsing fails, try to match common patterns
    if (url.includes('kick.com')) return 'kick';
    if (url.includes('rumble.com')) return 'rumble';
    if (url.includes('tiktok.com')) return 'tiktok';
    if (url.includes('instagram.com')) return 'instagram';
    if (url.includes('facebook.com')) return 'facebook';
    if (url.includes('x.com') || url.includes('twitter.com')) return 'x';
    if (url.includes('discord.gg') || url.includes('discord.com')) return 'discord';
  }
  
  // Default to discord for any other case (e.g., Discord streaming without URL)
  return 'discord';
}

function renderMessage(template, ctx) {
  const base = template || `**[{name}]({url}) is now streaming!**`;
  return base.replaceAll('{name}', ctx.name || '')
    .replaceAll('{title}', ctx.title || '')
    .replaceAll('{url}', ctx.url || '');
}

// Import the buildStreamEmbed function and platformMeta from streamEmbeds
const { buildStreamEmbed, platformMeta } = require('../modules/streamEmbeds');

module.exports = {
  name: 'clientReady',
  once: true,
  async execute(client) {
    // Log bot ready status without debug info
    console.log(`[${new Date().toISOString()}] Bot ready: ${client.user.tag}`);

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
        if (!p || !p.member || !p.guild) {
          console.error(`[${new Date().toISOString()}] Presence update error: Missing presence, member, or guild`);
          return;
        }
        
        const gid = p.guild.id;
        const uid = p.member.id;
        const key = `${gid}:${uid}`;
        
        const { streaming, activity } = isStreamingPresence(newPresence);
        const userTag = p.member?.user?.tag || 'Unknown User';
        const activityName = activity?.name || 'None';
        // Only log presence updates if they're streaming
        if (streaming) {
          console.log(`[${new Date().toISOString()}] Stream detected: ${userTag} is streaming ${activity?.name || 'Unknown'}`);
        }

        const prior = presenceState.get(key) || { live: false, lastPostAt: 0 };
        const rules = streamRegistry.getPresence(gid);
        // Only log rules if there's an issue
        if (!rules || Object.keys(rules).length === 0) {
          console.error(`[${new Date().toISOString()}] No notification rules found for guild ${gid}`);
        }
        
        const supportedPlatforms = ['twitch', 'youtube', 'kick', 'rumble', 'tiktok', 'instagram', 'discord', 'facebook', 'x'];
        const hasRules = supportedPlatforms.some(platform => rules?.[platform]);
        
        if (streaming && !hasRules) {
          console.error(`[${new Date().toISOString()}] No notification rules found for any supported platform in guild ${gid}`);
        }

        if (streaming) {
          const member = p.member;
          const now = Date.now();
          const url = activity.url || '';
          const platform = inferPlatformFromUrl(url);
          
          // Extract streamer username from URL
          let streamerUsername = '';
          try {
            const urlObj = new URL(url);
            streamerUsername = urlObj.pathname.split('/').filter(Boolean).pop() || member.displayName || member.user.username;
          } catch (e) {
            streamerUsername = member.displayName || member.user.username;
          }
          
          // Use platform-specific avatar
          const platformIcons = {
            twitch: 'https://static.twitchcdn.net/assets/favicon-32-e29e246c157142c94346.png',
            youtube: 'https://www.youtube.com/s/desktop/c653c3bb/img/favicon_32x32.png',
            kick: 'https://kick.com/favicon.ico',
            rumble: 'https://rumble.com/favicon.ico',
            tiktok: 'https://sf16-website-login.neutral.ttwstatic.com/obj/tiktok_web_login_static/tiktok/webapp/main/webapp-desktop/8152caf0c8e8bc67ae0d.ico',
            instagram: 'https://www.instagram.com/static/images/ico/favicon-192.png/68d99ba29cc8.png',
            discord: 'https://discord.com/assets/847541504914fd33810e70a0ea73177e.ico',
            facebook: 'https://facebook.com/favicon.ico',
            x: 'https://abs.twimg.com/favicons/twitter.3.ico'
          };
          
          const avatarUrl = platformIcons[platform] || member.displayAvatarURL({ size: 256 });
          const username = streamerUsername;
          const title = activity.details || activity.name || 'Live now';
          const game = activity.state || '';
          
          // Get the best available thumbnail
          let imageUrl = null;
          if (activity.assets) {
            // Try to get the large image URL first (for Twitch, YouTube, etc.)
            if (activity.assets.largeImageURL) {
              imageUrl = activity.assets.largeImageURL;
            } 
            // Fallback to Discord's CDN for application assets
            else if (activity.assets.largeImage) {
              // Handle Discord's CDN format for application assets
              if (activity.assets.largeImage.startsWith('mp:external/')) {
                // For external media, the URL is already in the format we need
                imageUrl = `https://media.discordapp.net/${activity.assets.largeImage.replace('mp:', '')}`;
              } else if (activity.applicationId) {
                // For standard Discord application assets
                imageUrl = `https://cdn.discordapp.com/app-assets/${activity.applicationId}/${activity.assets.largeImage}.png`;
              }
            }
          }
          
          // Only log unsupported platforms as warnings
          if (!['twitch', 'kick', 'youtube'].includes(platform)) {
            console.warn(`[${new Date().toISOString()}] Unsupported platform: ${platform} (User: ${uid})`);
          }

          // Prefer presence rules. If none, fallback to per-user entries.
          if (hasRules) {
            const rule = rules[platform];
            if (rule) {
              const whitelistOk = !rule.whitelistRoleIds?.length || rule.whitelistRoleIds.some(r => member.roles.cache.has(r));
              
              // Only log whitelist check failures as warnings
              if (!whitelistOk) {
                console.warn(`[${new Date().toISOString()}] Whitelist check failed for ${member.user.tag} - Missing required role`);
              }
              
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
                const cooldown = 30 * 60 * 1000; // 30 minutes
                const canPost = !(prior.live && (now - prior.lastPostAt) < cooldown);
                
                // Only log cooldown status at debug level
                if (DEBUG && !canPost) {
                  console.log(`[${new Date().toISOString()}] Notification skipped: Cooldown active`);
                }
                
                if (canPost) {
                  if (rule.channelId) {
                    const ch = client.channels.cache.get(rule.channelId);
                    if (ch?.isTextBased()) {
                      const embed = buildStreamEmbed({ 
                        platform, 
                        username, 
                        avatarUrl, 
                        url, 
                        title, 
                        game, 
                        imageUrl: imageUrl || avatarUrl, // Fallback to avatar if no thumbnail
                        thumbnailUrl: avatarUrl // Use avatar as thumbnail
                      });
                      const content = renderMessage(rule.message, { name: username, title, url });
                      
                      // Delete previous notification if it exists
                      const previousState = presenceState.get(key);
                      if (previousState?.notificationMessageId && previousState?.channelId) {
                        try {
                          const prevChannel = client.channels.cache.get(previousState.channelId);
                          if (prevChannel?.isTextBased()) {
                            await prevChannel.messages.delete(previousState.notificationMessageId).catch(() => {});
                          }
                        } catch (error) {
                          // Ignore errors when deleting old messages
                        }
                      }
                      
                      // Send new notification and store its ID
                      const message = await ch.send({ content, embeds: [embed] }).catch((error) => {
                        console.error(`[${new Date().toISOString()}] Failed to send notification:`, error.message || 'Unknown error');
                        return null;
                      });
                      
                      // Update presence state with new notification info
                      if (message) {
                        presenceState.set(key, { 
                          ...(presenceState.get(key) || {}), 
                          notificationMessageId: message.id, 
                          channelId: ch.id 
                        });
                      }
                    } else {
                      console.error(`[${new Date().toISOString()}] Channel error: Invalid channel ${rule.channelId} for ${platform}`);
                    }
                  } else {
                    console.error(`[${new Date().toISOString()}] Configuration error: No channel ID for ${platform}`);
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
                // For legacy entries, use the streamer's username from the entry if available
                const entryUsername = entry.streamerName || username;
                const embed = buildStreamEmbed({ 
                  platform, 
                  username: entryUsername, 
                  avatarUrl, 
                  url, 
                  title, 
                  game, 
                  imageUrl: imageUrl || avatarUrl, // Fallback to avatar if no thumbnail
                  thumbnailUrl: avatarUrl // Use avatar as thumbnail
                });
                const content = renderMessage(entry.message, { name: entryUsername, title, url });
                if (entry.channelId) {
                  const ch = client.channels.cache.get(entry.channelId);
                  if (ch?.isTextBased()) {
                    // Delete previous notification if it exists
                    const previousState = presenceState.get(key);
                    if (previousState?.notificationMessageId && previousState?.channelId) {
                      try {
                        const prevChannel = client.channels.cache.get(previousState.channelId);
                        if (prevChannel?.isTextBased()) {
                          await prevChannel.messages.delete(previousState.notificationMessageId).catch(() => {});
                        }
                      } catch (error) {
                        // Ignore errors when deleting old messages
                      }
                    }
                    
                    // Send new notification and store its ID
                    const message = await ch.send({ content, embeds: [embed] }).catch((error) => {
                      console.error(`[${new Date().toISOString()}] Failed to send notification to ${ch.name}:`, error.message || 'Unknown error');
                      return null;
                    });
                    
                    // Update presence state with new notification info
                    if (message) {
                      presenceState.set(key, { 
                        ...(presenceState.get(key) || {}), 
                        notificationMessageId: message.id, 
                        channelId: ch.id 
                      });
                    }
                  }
                }
              }
            }
          }

          // Keep existing notification info when updating presence state
          presenceState.set(key, { 
            ...(presenceState.get(key) || {}), 
            live: true, 
            lastPostAt: Date.now() 
          });
        } else {
          // Remove roles when no longer streaming. Prefer rules if present; else legacy entries.
          const member = p.member;
          
          // Delete the notification message if it exists
          const streamState = presenceState.get(key);
          if (streamState?.notificationMessageId && streamState?.channelId) {
            try {
              const channel = client.channels.cache.get(streamState.channelId);
              if (channel?.isTextBased()) {
                await channel.messages.delete(streamState.notificationMessageId).catch(() => {});
              }
            } catch (error) {
              console.error(`[${new Date().toISOString()}] Cleanup error: Failed to delete notification -`, error.message || 'Unknown error');
            }
          }
          
          if (hasRules) {
            for (const plat of supportedPlatforms) {
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
          // Clear notification info when stream ends
          presenceState.set(key, { 
            live: false, 
            lastPostAt: streamState?.lastPostAt || 0,
            notificationMessageId: undefined,
            channelId: undefined
          });
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
        console.error(`[${new Date().toISOString()}] Startup error: Failed to initialize stream notifier -`, error.message || 'Unknown error');
      }
    }
  }
};