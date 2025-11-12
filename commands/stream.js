const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const logger = require('../modules/logger');
const configLoader = require('../modules/configLoader');
const config = configLoader.config;
const twitchConfig = configLoader.twitch;
const { buildStreamEmbed } = require('../modules/streamEmbeds');
const registry = require('../modules/streamRegistry');

const fetch = globalThis.fetch || ((...args) => import('node-fetch').then(({ default: f }) => f(...args)));

/** @typedef {{ token: string, clientId: string, exp: number }} TwitchToken */
/** @typedef {{ [key: string]: { val: any, exp: number } }} CacheMap */

const _cache = {
  twitchToken: { token: null, clientId: null, exp: 0 },
  twitchUser: new Map(),
  twitchLive: new Map(),
  ytChannelId: new Map(),
  ytAvatar: new Map(),
  ytLive: new Map(),
  ytChannelInfo: new Map() // Combined avatar + title cache
};

function _getFromMapCache(map, key) {
  const v = map.get(key);
  if (!v) return null;
  if (v.exp && v.exp < Date.now()) { map.delete(key); return null; }
  return v.val;
}

function _setMapCache(map, key, val, ttlMs) {
  map.set(key, { val, exp: ttlMs ? Date.now() + ttlMs : 0 });
}

// Enhanced cache for YouTube channel info
function _getYtChannelInfo(channelId) {
  const cached = _cache.ytChannelInfo.get(channelId);
  if (!cached || (cached.exp && cached.exp < Date.now())) {
    _cache.ytChannelInfo.delete(channelId);
    return null;
  }
  return cached;
}

function _setYtChannelInfo(channelId, info, ttlMs = 6 * 60 * 60 * 1000) { // 6h default
  _cache.ytChannelInfo.set(channelId, { ...info, exp: Date.now() + ttlMs });
}

function parseIds(str) {
  return (str || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => s.replace(/[^0-9]/g, ''))
    .filter(Boolean);
}

function parseTwitchLoginFromInput(input) {
  try {
    if (/^https?:\/\//i.test(input)) {
      const u = new URL(input);
      if (u.hostname.replace(/^www\./,'').includes('twitch.tv')) {
        const seg = u.pathname.split('/').filter(Boolean)[0];
        if (seg) return seg.toLowerCase();
      }
    }
  } catch {}
  return String(input).toLowerCase();
}

async function getTwitchAppToken() {
  try {
    const clientId = twitchConfig?.twitch_client_id;
    const clientSecret = twitchConfig?.twitch_client_secret;
    if (!clientId || !clientSecret) return null;
    if (_cache.twitchToken.token && _cache.twitchToken.clientId === clientId && _cache.twitchToken.exp > Date.now()) {
      return { token: _cache.twitchToken.token, clientId };
    }
    const params = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials' });
    const res = await fetch('https://id.twitch.tv/oauth2/token', { method: 'POST', body: params });
    if (!res.ok) return null;
    const data = await res.json();
    const ttl = Math.max(0, (data?.expires_in || 3600) - 60) * 1000;
    _cache.twitchToken = { token: data.access_token, clientId, exp: Date.now() + ttl };
    return { token: data.access_token, clientId };
  } catch {
    return null;
  }
}

async function getTwitchUser(login, auth) {
  try {
    const key = String(login).toLowerCase();
    const cached = _getFromMapCache(_cache.twitchUser, key);
    if (cached) return cached;
    const url = `https://api.twitch.tv/helix/users?login=${encodeURIComponent(login)}`;
    const res = await fetch(url, { headers: { 'Client-Id': auth.clientId, 'Authorization': `Bearer ${auth.token}` } });
    if (!res.ok) return null;
    const data = await res.json();
    const val = data?.data?.[0] || null;
    if (val) _setMapCache(_cache.twitchUser, key, val, 10 * 60 * 1000);
    return val;
  } catch {
    return null;
  }
}

async function getTwitchLive(login, auth) {
  try {
    const key = String(login).toLowerCase();
    const cached = _getFromMapCache(_cache.twitchLive, key);
    if (cached !== null && cached !== undefined) return cached;
    const url = `https://api.twitch.tv/helix/streams?user_login=${encodeURIComponent(login)}`;
    const res = await fetch(url, { headers: { 'Client-Id': auth.clientId, 'Authorization': `Bearer ${auth.token}` } });
    if (!res.ok) return null;
    const data = await res.json();
    const val = Array.isArray(data?.data) && data.data.length ? data.data[0] : null;
    _setMapCache(_cache.twitchLive, key, val, 30 * 1000);
    return val;
  } catch { return null; }
}

async function getYouTubeLive(channelId, apiKey) {
  try {
    const key = String(channelId);
    const cached = _getFromMapCache(_cache.ytLive, key);
    if (cached !== null && cached !== undefined) return cached;
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${encodeURIComponent(channelId)}&eventType=live&type=video&maxResults=1&key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const val = Array.isArray(data?.items) && data.items.length ? data.items[0] : null;
    _setMapCache(_cache.ytLive, key, val, 30 * 1000);
    return val;
  } catch { return null; }
}

async function getYouTubeChannelIdFromVideo(videoId, apiKey) {
  try {
    if (!videoId) return null;
    const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${encodeURIComponent(videoId)}&key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    return data?.items?.[0]?.snippet?.channelId || null;
  } catch { return null; }
}

function parseYouTubeUrlToParts(input) {
  try {
    const u = new URL(input);
    const host = u.hostname.replace(/^www\./, '');
    const path = u.pathname.replace(/\/+$/, '');
    if (host === 'youtu.be') {
      const vid = path.split('/')[1] || null;
      return { type: 'video', videoId: vid };
    }
    if (host.endsWith('youtube.com')) {
      if (u.pathname.startsWith('/watch')) {
        const vid = u.searchParams.get('v');
        return { type: 'video', videoId: vid };
      }
      if (path.startsWith('/channel/')) return { type: 'channel', channelId: path.split('/')[2] || null };
      if (path.startsWith('/@')) return { type: 'handle', handle: path.slice(1) };
      if (path.startsWith('/user/')) return { type: 'user', username: path.split('/')[2] || null };
      if (path.startsWith('/c/')) return { type: 'custom', custom: path.split('/')[2] || null };
    }
  } catch {}
  return null;
}

async function resolveYouTubeChannelId(identifier, apiKey) {
  if (!identifier) return null;
  if (identifier.startsWith('UC')) return identifier;
  try {
    const key = String(identifier).toLowerCase();
    const cached = _getFromMapCache(_cache.ytChannelId, key);
    if (cached) return cached;

    let channelId = null;

    // Try forHandle API first for @handles (most efficient)
    if (identifier.startsWith('@')) {
      const hUrl = `https://www.googleapis.com/youtube/v3/channels?part=id&forHandle=${encodeURIComponent(identifier)}&key=${encodeURIComponent(apiKey)}`;
      const hRes = await fetch(hUrl);
      if (hRes.ok) {
        const hData = await hRes.json();
        if (!hData.error) {
          channelId = hData?.items?.[0]?.id || null;
        }
      }
    }

    // Fallback to URL parsing for complex URLs
    if (!channelId && /^https?:\/\//i.test(identifier)) {
      const parts = parseYouTubeUrlToParts(identifier);
      if (parts) {
        if (parts.type === 'channel' && parts.channelId?.startsWith('UC')) {
          channelId = parts.channelId;
        } else if (parts.type === 'video' && parts.videoId) {
          channelId = await getYouTubeChannelIdFromVideo(parts.videoId, apiKey);
        }
      }
    }

    // Final fallback to search (least efficient)
    if (!channelId) {
      const query = identifier.startsWith('@') ? identifier.slice(1) : identifier;
      const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&q=${encodeURIComponent(query)}&maxResults=1&key=${encodeURIComponent(apiKey)}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (!data.error) {
          channelId = data?.items?.[0]?.id?.channelId || null;
        }
      }
    }

    // Cache for 24 hours
    if (channelId) _setMapCache(_cache.ytChannelId, key, channelId, 24 * 60 * 60 * 1000);
    return channelId;
  } catch { return null; }
}

async function getYouTubeChannelInfo(channelId, apiKey) {
  try {
    // Check cache first
    const cached = _getYtChannelInfo(channelId);
    if (cached) return { avatar: cached.avatar, title: cached.title };
    
    const url = `https://www.googleapis.com/youtube/v3/channels?part=snippet&id=${encodeURIComponent(channelId)}&key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url);
    if (!res.ok) return { avatar: null, title: null };
    const data = await res.json();
    if (data.error) return { avatar: null, title: null };
    
    const snippet = data?.items?.[0]?.snippet;
    const info = {
      avatar: snippet?.thumbnails?.default?.url || null,
      title: snippet?.title || null
    };
    
    // Cache for 6 hours
    _setYtChannelInfo(channelId, info);
    return info;
  } catch { return { avatar: null, title: null }; }
}

// Legacy functions for backward compatibility
async function getYouTubeChannelAvatar(channelId, apiKey) {
  const info = await getYouTubeChannelInfo(channelId, apiKey);
  return info.avatar;
}

async function getYouTubeChannelTitle(channelId, apiKey) {
  const info = await getYouTubeChannelInfo(channelId, apiKey);
  return info.title;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stream')
    .setDescription('Manage stream notifications and live roles')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(subcommand =>
      subcommand
        .setName('test_notification')
        .setDescription('Test notification for a specific user')
        .addUserOption(option =>
          option.setName('user')
            .setDescription('User to test notification for')
            .setRequired(true)
        )
        .addStringOption(option =>
          option.setName('platform')
            .setDescription('Platform to test (or ALL for all platforms)')
            .setRequired(true)
            .addChoices(
              { name: 'ALL Platforms', value: 'all' },
              { name: 'Twitch', value: 'twitch' },
              { name: 'YouTube', value: 'youtube' },
              { name: 'Kick', value: 'kick' },
              { name: 'Rumble', value: 'rumble' },
              { name: 'TikTok', value: 'tiktok' },
              { name: 'Facebook', value: 'facebook' },
              { name: 'X (Twitter)', value: 'x' },
              { name: 'Instagram', value: 'instagram' },
              { name: 'Discord', value: 'discord' }
            )
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('add')
        .setDescription('Add a new streamer')
        .addStringOption(option =>
          option.setName('platform')
            .setDescription('Streaming Platform(s)')
            .setRequired(true)
            .addChoices(
              { name: 'ALL Platforms', value: 'all' },
              { name: 'Twitch', value: 'twitch' },
              { name: 'YouTube', value: 'youtube' },
              { name: 'Kick', value: 'kick' },
              { name: 'Rumble', value: 'rumble' },
              { name: 'TikTok', value: 'tiktok' },
              { name: 'Facebook', value: 'facebook' },
              { name: 'X (Twitter)', value: 'x' },
              { name: 'Instagram', value: 'instagram' },
              { name: 'Discord', value: 'discord' }
            )
        )
        .addStringOption(option =>
          option.setName('name')
            .setDescription('Streamer\'s username on the platform')
            .setRequired(true)
        )
        .addChannelOption(option =>
          option.setName('channel')
            .setDescription('Channel to post notifications in')
            .setRequired(true)
        )
        .addUserOption(option =>
          option.setName('discord_user')
            .setDescription('Discord user to give live role(s) to')
            .setRequired(false)
        )
        .addStringOption(option =>
          option.setName('live_roles')
            .setDescription('Role(s) to assign when live (comma-separated for multiple)')
            .setRequired(false)
        )
        .addStringOption(option =>
          option.setName('whitelist_roles')
            .setDescription('Role(s) that can receive notifications (comma-separated for multiple)')
            .setRequired(false)
        )
        .addStringOption(option =>
          option.setName('message')
            .setDescription('Custom live notification message (supports {name}, {title}, {url}, {platform})')
            .setRequired(false)
        )
        .addStringOption(option =>
          option.setName('vod_message')
            .setDescription('Custom VOD notification message (supports {name}, {title}, {url}, {platform})')
            .setRequired(false)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('remove')
        .setDescription('Remove a streamer entry from this server registry')
        .addStringOption(option => option.setName('platform')
          .setDescription('Platform of the stream to remove')
          .setRequired(true)
          .addChoices(
            { name: 'ALL Platforms', value: 'all' },
            { name: 'Twitch', value: 'twitch' },
            { name: 'YouTube', value: 'youtube' },
            { name: 'Kick', value: 'kick' },
            { name: 'Rumble', value: 'rumble' },
            { name: 'TikTok', value: 'tiktok' },
            { name: 'Facebook', value: 'facebook' },
            { name: 'X (Twitter)', value: 'x' },
            { name: 'Instagram', value: 'instagram' },
            { name: 'Discord', value: 'discord' }
          ))
        .addStringOption(option => option.setName('name')
        .setDescription('Streamer username')
        .setRequired(true)
        .setAutocomplete(true)))
    .addSubcommand(subcommand =>
      subcommand
        .setName('edit')
        .setDescription('Edit an existing streamer')
        .addStringOption(option => option.setName('platform')
          .setDescription('Streaming Platform')
          .setRequired(true)
          .addChoices(
            { name: 'ALL Platforms', value: 'all' },
            { name: 'Twitch', value: 'twitch' },
            { name: 'YouTube', value: 'youtube' },
            { name: 'Kick', value: 'kick' },
            { name: 'Rumble', value: 'rumble' },
            { name: 'TikTok', value: 'tiktok' },
            { name: 'Facebook', value: 'facebook' },
            { name: 'X (Twitter)', value: 'x' },
            { name: 'Instagram', value: 'instagram' },
            { name: 'Discord', value: 'discord' }
          ))
        .addStringOption(option => option.setName('name')
          .setDescription('Existing streamer username')
          .setRequired(true)
          .setAutocomplete(true))
        .addChannelOption(option => option.setName('channel')
          .setDescription('Channel to post notifications in')
          .setRequired(false))
        .addUserOption(option => option.setName('discord_user')
          .setDescription('Discord user to give live role(s) to')
          .setRequired(false))
        .addStringOption(option => option.setName('live_roles')
          .setDescription('Role(s) to assign when live (comma-separated for multiple)')
          .setRequired(false))
        .addStringOption(option => option.setName('whitelist_roles')
          .setDescription('Role(s) that can receive notifications (comma-separated for multiple)')
          .setRequired(false))
        .addStringOption(option => option.setName('message')
          .setDescription('Custom live notification message (supports {name}, {title}, {url}, {platform})')
          .setRequired(false))
        .addStringOption(option => option.setName('vod_message')
          .setDescription('Custom VOD notification message (supports {name}, {title}, {url}, {platform})')
          .setRequired(false)))
    .addSubcommand(subcommand =>
      subcommand
        .setName('edit_all')
        .setDescription('Bulk edit all streamers for a platform')
        .addStringOption(option => option.setName('platform')
          .setDescription('Streaming Platform')
          .setRequired(true)
          .addChoices(
            { name: 'ALL Platforms', value: 'all' },
            { name: 'Twitch', value: 'twitch' },
            { name: 'YouTube', value: 'youtube' },
            { name: 'Kick', value: 'kick' },
            { name: 'Rumble', value: 'rumble' },
            { name: 'TikTok', value: 'tiktok' },
            { name: 'Facebook', value: 'facebook' },
            { name: 'X (Twitter)', value: 'x' },
            { name: 'Instagram', value: 'instagram' },
            { name: 'Discord', value: 'discord' }
          ))
        .addChannelOption(option => option.setName('channel')
          .setDescription('Channel to post notifications in')
          .setRequired(false))
        .addUserOption(option => option.setName('discord_user')
          .setDescription('Discord user to give live role(s) to')
          .setRequired(false))
        .addStringOption(option => option.setName('live_roles')
          .setDescription('Role(s) to assign when live (comma-separated for multiple)')
          .setRequired(false))
        .addStringOption(option => option.setName('whitelist_roles')
          .setDescription('Role(s) that can receive notifications (comma-separated for multiple)')
          .setRequired(false))
        .addStringOption(option => option.setName('message')
          .setDescription('Custom live notification message (supports {name}, {title}, {url}, {platform})')
          .setRequired(false))
        .addStringOption(option => option.setName('vod_message')
          .setDescription('Custom VOD notification message (supports {name}, {title}, {url}, {platform})')
          .setRequired(false)))
    .addSubcommand(subcommand =>
      subcommand
        .setName('list')
        .setDescription('List all tracked streamers')
        .addStringOption(option => option.setName('platform')
          .setDescription('Filter by platform')
          .setRequired(false)
          .addChoices(
            { name: 'ALL Platforms', value: 'all' },
            { name: 'Twitch', value: 'twitch' },
            { name: 'YouTube', value: 'youtube' },
            { name: 'Kick', value: 'kick' },
            { name: 'Rumble', value: 'rumble' },
            { name: 'TikTok', value: 'tiktok' },
            { name: 'Facebook', value: 'facebook' },
            { name: 'X (Twitter)', value: 'x' },
            { name: 'Instagram', value: 'instagram' },
            { name: 'Discord', value: 'discord' }
          )))
    .addSubcommand(subcommand =>
      subcommand
        .setName('live_roles_set')
        .setDescription('Configure automatic role assignments for streamers')
        .addStringOption(option => 
          option.setName('platform')
           .setDescription('Platform to configure (or ALL for all platforms)')
           .setRequired(true)
           .addChoices(
             { name: 'ALL Platforms', value: 'all' },
             { name: 'Twitch', value: 'twitch' },
             { name: 'YouTube', value: 'youtube' },
             { name: 'Kick', value: 'kick' },
             { name: 'Rumble', value: 'rumble' },
             { name: 'TikTok', value: 'tiktok' },
             { name: 'Facebook', value: 'facebook' },
             { name: 'X (Twitter)', value: 'x' },
             { name: 'Instagram', value: 'instagram' },
             { name: 'Discord', value: 'discord' }
           ))
        .addStringOption(option => 
          option.setName('whitelist_roles')
           .setDescription('Comma-separated role mentions/IDs that can receive the live role')
           .setRequired(true))
        .addStringOption(option => 
          option.setName('live_roles')
           .setDescription('Comma-separated role mentions/IDs to assign when streaming')
           .setRequired(true)))
    .addSubcommand(subcommand =>
      subcommand
        .setName('live_roles_clear')
        .setDescription('Remove automatic role assignments for a platform')
        .addStringOption(option => 
          option.setName('platform')
           .setDescription('Platform to clear (or ALL for all platforms)')
           .setRequired(false)
           .addChoices(
             { name: 'ALL Platforms', value: 'all' },
             { name: 'Twitch', value: 'twitch' },
             { name: 'YouTube', value: 'youtube' },
             { name: 'Kick', value: 'kick' },
             { name: 'Rumble', value: 'rumble' },
             { name: 'TikTok', value: 'tiktok' },
             { name: 'Facebook', value: 'facebook' },
             { name: 'X (Twitter)', value: 'x' },
             { name: 'Instagram', value: 'instagram' },
             { name: 'Discord', value: 'discord' }
           )))
    
    // Stream Notifications Commands
    .addSubcommand(subcommand =>
      subcommand
        .setName('notifications_set')
        .setDescription('Configure stream notifications')
        .addStringOption(option => 
          option.setName('platform')
           .setDescription('Platform to configure')
           .setRequired(true)
           .addChoices(
             { name: 'ALL Platforms', value: 'all' },
             { name: 'Twitch', value: 'twitch' },
             { name: 'YouTube', value: 'youtube' },
             { name: 'Kick', value: 'kick' },
             { name: 'Rumble', value: 'rumble' },
             { name: 'TikTok', value: 'tiktok' },
             { name: 'Facebook', value: 'facebook' },
             { name: 'X (Twitter)', value: 'x' },
             { name: 'Instagram', value: 'instagram' },
             { name: 'Discord', value: 'discord' }
           ))
        .addChannelOption(option => 
          option.setName('channel')
           .setDescription('Channel to post notifications')
           .setRequired(true))
        .addStringOption(option => 
          option.setName('whitelist_roles')
           .setDescription('Comma-separated role mentions/IDs that can trigger notifications')
           .setRequired(true))
        .addStringOption(option => 
          option.setName('message')
           .setDescription('Custom notification message (use {name} for username, {title} for stream title)')
           .setRequired(false)))
    .addSubcommand(subcommand =>
      subcommand
        .setName('notifications_clear')
        .setDescription('Remove stream notifications for a platform')
        .addStringOption(option => 
          option.setName('platform')
           .setDescription('Platform to clear (leave empty for all platforms)')
           .setRequired(false)
           .addChoices(
             { name: 'ALL Platforms', value: 'all' },
             { name: 'Twitch', value: 'twitch' },
             { name: 'YouTube', value: 'youtube' },
             { name: 'Kick', value: 'kick' },
             { name: 'Rumble', value: 'rumble' },
             { name: 'TikTok', value: 'tiktok' },
             { name: 'Facebook', value: 'facebook' },
             { name: 'X (Twitter)', value: 'x' },
             { name: 'Instagram', value: 'instagram' },
             { name: 'Discord', value: 'discord' }
           )))
    .addSubcommand(subcommand =>
      subcommand
        .setName('test')
        .setDescription('Send test stream notifications for configured entries (Admin only)')
        .addStringOption(option => option
          .setName('platform')
          .setDescription('Filter to a single platform')
          .addChoices(
            { name: 'ALL Platforms', value: 'all' },
            { name: 'Twitch', value: 'twitch' },
            { name: 'YouTube', value: 'youtube' },
            { name: 'Kick', value: 'kick' },
            { name: 'Rumble', value: 'rumble' },
            { name: 'TikTok', value: 'tiktok' },
            { name: 'Facebook', value: 'facebook' },
            { name: 'X (Twitter)', value: 'x' },
            { name: 'Instagram', value: 'instagram' },
            { name: 'Discord', value: 'discord' }
          )))
    .addSubcommand(subcommand =>
      subcommand
        .setName('check_live_roles')
        .setDescription('Manually check and assign live roles to users currently streaming')
        .addStringOption(option => option.setName('platform')
        .setDescription('Check specific platform or all')
        .addChoices(
            { name: 'ALL Platforms', value: 'all' },
            { name: 'Twitch', value: 'twitch' },
            { name: 'YouTube', value: 'youtube' },
            { name: 'Kick', value: 'kick' },
            { name: 'Rumble', value: 'rumble' },
            { name: 'TikTok', value: 'tiktok' },
            { name: 'Facebook', value: 'facebook' },
            { name: 'X (Twitter)', value: 'x' },
            { name: 'Instagram', value: 'instagram' },
            { name: 'Discord', value: 'discord' }
          ))),

  /**
   * Execute the stream command
   * @param {import('discord.js').CommandInteraction} interaction - The interaction object
   */
  async execute(interaction) {
    // Track interaction state
    const interactionState = {
      isHandled: false,
      isDeferred: false,
      isReplied: false
    };

    // Helper function to safely defer the reply
    const safeDefer = async () => {
      if (interactionState.isDeferred || interactionState.isReplied) return true;
      try {
        await interaction.deferReply({ flags: 64 /* EPHEMERAL */ });
        interactionState.isDeferred = true;
        return true;
      } catch (error) {
        console.error('Failed to defer reply:', error);
        return false;
      }
    };

    // Helper function to safely send responses
    const safeReply = async (content, options = {}) => {
      if (interactionState.isHandled) return null;
      interactionState.isHandled = true;

      try {
        if (interactionState.isReplied) {
          return interaction.followUp({ 
            content, 
            ...options, 
            flags: 64 /* EPHEMERAL */
          });
        } else if (interactionState.isDeferred) {
          return interaction.editReply({ content, ...options });
        } else {
          const response = await interaction.reply({ 
            content, 
            ...options, 
            flags: 64 /* EPHEMERAL */,
            fetchReply: true
          });
          interactionState.isReplied = true;
          return response;
        }
      } catch (error) {
        console.error('Failed to send response:', error);
        return null;
      }
    };

    try {
      // Defer the reply first thing
      await safeDefer();
      
      if (!interaction.inGuild()) {
        return await safeReply('❌ This command can only be used in a server.');
      }
      
      const sub = interaction.options.getSubcommand();
      const registry = require('../modules/streamRegistry');

    if (sub === 'add') {
      try {
        const platform = interaction.options.getString('platform');
        const name = interaction.options.getString('name');
        const channel = interaction.options.getChannel('channel');
        const message = interaction.options.getString('message');
        const vodMessage = interaction.options.getString('vod_message');
        const discordUser = interaction.options.getUser('discord_user');
        const liveRolesStr = interaction.options.getString('live_roles');
        const whitelistRolesStr = interaction.options.getString('whitelist_roles');
        
        // Validate required inputs
        if (!platform || !name || !channel) {
          const missing = [];
          if (!platform) missing.push('platform');
          if (!name) missing.push('name');
          if (!channel) missing.push('channel');
          return interaction.editReply(`❌ Missing required fields: ${missing.join(', ')}`);
        }
        
        const liveRoleIds = parseIds(liveRolesStr);
        
        const whitelistRoleIds = parseIds(whitelistRolesStr);
        
        const res = registry.add(interaction.guild.id, { 
          platform, 
          name: name, 
          channelId: channel.id, 
          message, 
          vodMessage, 
          discordUser: discordUser?.id, 
          liveRoleIds, 
          whitelistRoleIds 
        });
        
        if (!res.ok) {
          return interaction.editReply(`❌ Failed to add streamer: ${res.reason || 'Unknown error'}`);
        }
        
        return interaction.editReply(`✅ Added ${platform} streamer: ${name} -> ${channel}`);
        
      } catch (error) {
        console.error('Error in stream add:', error);
        return interaction.editReply('❌ An error occurred while adding the streamer.');
      }
    }

    if (sub === 'remove') {
      try {
        const platform = interaction.options.getString('platform', true);
        const name = interaction.options.getString('name', true);
        
        const res = registry.remove(interaction.guild.id, platform, name);
        
        if (res.removed) {
          return interaction.editReply(`✅ Removed ${platform} streamer: ${name}`);
        }
        
        // If not found, show current entries for this platform to help user
        const list = registry.list(interaction.guild.id).filter(e => e.platform === platform);
        if (!list.length) {
          return interaction.editReply(`❌ No ${platform} entries are currently configured.`);
        }
        
        const names = list.map(e => `• ${e.name}`).join('\n');
        return interaction.editReply({
          content: `❌ No matching entry found. Current ${platform} streamers:\n${names}`,
          flags: 64 // EPHEMERAL
        });
        
      } catch (error) {
        console.error('Error in stream remove:', error);
        return interaction.editReply('❌ An error occurred while removing the streamer.');
      }
    }

    if (sub === 'edit') {
      const platform = interaction.options.getString('platform', true);
      const name = interaction.options.getString('name', true);
      const channel = interaction.options.getChannel('channel');
      const message = interaction.options.getString('message');
      const vodMessage = interaction.options.getString('vod_message');
      const discordUser = interaction.options.getUser('discord_user');
      const liveRolesStr = interaction.options.getString('live_roles');
      const whitelistRolesStr = interaction.options.getString('whitelist_roles');
      const parseIds = (str) => (str || '').split(',').map(s => s.trim()).filter(Boolean).map(s => s.replace(/[^0-9]/g, '')).filter(Boolean);
      if (!channel && (message === null || message === undefined) && (vodMessage === null || vodMessage === undefined) && !discordUser && !liveRolesStr && !whitelistRolesStr) {
        return await interaction.editReply({ content: 'Provide at least one field to update: channel, message, vod_message, discord_user, live_roles, or whitelist_roles.' });
      }
      const registry = require('../modules/streamRegistry');
      const patch = {};
      if (channel) patch.channelId = channel.id;
      if (message !== null && message !== undefined) patch.message = message;
      if (vodMessage !== null && vodMessage !== undefined) patch.vodMessage = vodMessage;
      if (discordUser) patch.discordUser = discordUser.id;
      
      // Handle live_roles option
      if (liveRolesStr) {
        patch.liveRoleIds = [...new Set(parseIds(liveRolesStr))]; // Remove duplicates
      }
      
      if (whitelistRolesStr) patch.whitelistRoleIds = parseIds(whitelistRolesStr);
      const res = registry.update(interaction.guild.id, platform, name, patch);
      if (!res.ok) {
        return interaction.editReply({ 
          content: '❌ No matching entry found to edit.',
          flags: 64
        });
      }
      
      const updates = [];
      if (channel) updates.push(`channel: ${channel}`);
      if (message) updates.push(`live message: ${message}`);
      if (vodMessage) updates.push(`VOD message: ${vodMessage}`);
      if (discordUser) updates.push(`user: ${discordUser}`);
      if (liveRolesStr) {
        const roleIds = patch.liveRoleIds || [];
        updates.push(`live roles: ${roleIds.map(id => `<@&${id}>`).join(', ') || 'None'}`);
      }
      if (whitelistRolesStr) {
        updates.push(`whitelist roles: ${patch.whitelistRoleIds?.map(id => `<@&${id}>`).join(', ') || 'None'}`);
      }
      
      return interaction.editReply({ 
        content: `✅ Updated ${platform}:${name}${updates.length ? '\n' + updates.join('\n') : ''}`,
        flags: 64
      });
    }

    if (sub === 'list') {
      const registry = require('../modules/streamRegistry');
      let filterPlatform = interaction.options.getString('platform');
      const list = registry.list(interaction.guild.id);
      
      if (!list || !list.length) {
        return await interaction.editReply('No streamer entries set for this server.');
      }

      // If a specific platform is filtered
      if (filterPlatform) {
        // Handle case-insensitive platform matching
        const platformMap = {
          'all': 'all',
          'twitch': 'twitch',
          'youtube': 'youtube',
          'kick': 'kick',
          'rumble': 'rumble',
          'tiktok': 'tiktok',
          'facebook': 'facebook',
          'x': 'x',
          'twitter': 'x', // Alias for X
          'instagram': 'instagram',
          'discord': 'discord'
        };
        
        // Normalize the platform name
        const normalizedPlatform = platformMap[filterPlatform.toLowerCase()];
        
        if (normalizedPlatform === 'all') {
          // Show all platforms (same as no filter)
          filterPlatform = null;
        } else if (normalizedPlatform) {
          // Filter by the normalized platform name
          const platformList = list.filter(e => e.platform.toLowerCase() === normalizedPlatform);
          if (!platformList.length) {
            return await interaction.editReply(`No ${normalizedPlatform} entries found.`);
          }
          
          const formattedList = platformList.map(entry => {
            const details = [];
            if (entry.channelId) details.push(`<#${entry.channelId}>`);
            if (entry.message) details.push(`"${entry.message}"`);
            if (entry.liveRoleIds?.length) details.push(`Live Roles: ${entry.liveRoleIds.map(id => `<@&${id}>`).join(', ')}`);
            return `• **${entry.name}**${details.length ? ` (${details.join(' | ')})` : ''}`;
          }).join('\n');
          
          return await interaction.editReply(`**${normalizedPlatform.toUpperCase()} Streamers:**\n${formattedList}`);
        } else {
          // If platform not found in map, try a case-insensitive search
          const platformList = list.filter(e => e.platform.toLowerCase() === filterPlatform.toLowerCase());
          if (platformList.length) {
            const formattedList = platformList.map(entry => {
              const details = [];
              if (entry.channelId) details.push(`<#${entry.channelId}>`);
              if (entry.message) details.push(`"${entry.message}"`);
              if (entry.liveRoleIds?.length) details.push(`Live Roles: ${entry.liveRoleIds.map(id => `<@&${id}>`).join(', ')}`);
              return `• **${entry.name}**${details.length ? ` (${details.join(' | ')})` : ''}`;
            }).join('\n');
            
            return await interaction.editReply(`**${platformList[0].platform.toUpperCase()} Streamers:**\n${formattedList}`);
          }
          
          return await interaction.editReply(`No matching platform found. Available platforms: ${Object.values(platformMap).filter(p => p !== 'all' && p !== 'twitter').join(', ')}`);
        }
      }
      
      // Group by platform
      const platformGroups = list.reduce((acc, entry) => {
        if (!acc[entry.platform]) acc[entry.platform] = [];
        acc[entry.platform].push(entry);
        return acc;
      }, {});

      const platformEmojis = {
        twitch: '🟣',
        youtube: '🔴', 
        kick: '🟢',
        rumble: '🟢',
        tiktok: '🔴',
        facebook: '🔵',
        x: '⚫',
        instagram: '🟣',
        discord: '🔵'
      };

      let output = [];
      
      // Sort platforms alphabetically
      const sortedPlatforms = Object.keys(platformGroups).sort((a, b) => a.localeCompare(b));
      
      for (const platform of sortedPlatforms) {
        const entries = platformGroups[platform];
        if (!entries || !entries.length) continue;
        
        const emoji = platformEmojis[platform.toLowerCase()] || '📺';
        const usernames = entries.map(e => e.name).filter(Boolean).join(', ');
        if (!usernames) continue;
        
        output.push(`${emoji} **${platform.toUpperCase()}**: ${usernames}`);
      }

      if (!output.length) {
        return await interaction.editReply('No streamer entries found.');
      }
      
      // Add header and format the output
      const finalOutput = ['**📺 Streamer List**', ...output].join('\n');
      return await interaction.editReply(finalOutput);
    }

    if (sub === 'edit_all') {
      const platform = interaction.options.getString('platform', true);
      const channel = interaction.options.getChannel('channel');
      const message = interaction.options.getString('message');
      const vodMessage = interaction.options.getString('vod_message');
      const discordUser = interaction.options.getUser('discord_user');
      const liveRolesStr = interaction.options.getString('live_roles');
      const whitelistRolesStr = interaction.options.getString('whitelist_roles');
      const parseIds = (str) => (str || '').split(',').map(s => s.trim()).filter(Boolean).map(s => s.replace(/[^0-9]/g, '')).filter(Boolean);

      if (!channel && (message === null || message === undefined) && (vodMessage === null || vodMessage === undefined) && !discordUser && !liveRolesStr && !whitelistRolesStr) {
        return await interaction.editReply({ content: 'Provide at least one field to update: channel, message, vod_message, discord_user, live_roles, or whitelist_roles.' });
      }

      const registry = require('../modules/streamRegistry');
      let list = registry.list(interaction.guild.id);
      
      // If platform is not 'all', filter the list by the specified platform
      if (platform !== 'all') {
        list = list.filter(e => e.platform === platform);
        if (!list.length) return await interaction.editReply({ content: `No ${platform} entries found.` });
      } else if (!list.length) {
        return await interaction.editReply({ content: 'No streamer entries found in this server.' });
      }

      let updated = 0;
      for (const entry of list) {
        const patch = {};
        if (channel) patch.channelId = channel.id;
        if (message !== null && message !== undefined) patch.message = message;
        if (vodMessage !== null && vodMessage !== undefined) patch.vodMessage = vodMessage;
        if (discordUser) patch.discordUser = discordUser.id;
        
        // Handle live_roles option
        if (liveRolesStr) {
          patch.liveRoleIds = parseIds(liveRolesStr);
        }
        
        if (whitelistRolesStr) patch.whitelistRoleIds = parseIds(whitelistRolesStr);
        
        try {
          // Use the entry's id for the update
          const res = registry.update(interaction.guild.id, entry.platform, entry.name, patch);
          if (res && res.ok) {
            updated++;
          } else {
            console.warn(`Failed to update ${entry.platform}:${entry.name}`, res?.reason || 'Unknown error');
          }
        } catch (error) {
          console.error(`Error updating ${entry.platform}:${entry.name}:`, error);
        }
      }

      const platformText = platform === 'all' ? '' : `${platform} `;
      return await interaction.editReply({ content: `Updated ${updated} ${platformText}entr${updated === 1 ? 'y' : 'ies'}.` });
    }

    if (sub === 'test') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.editReply({ content: '❌ You do not have permission.' });
      }

      const filterPlatform = interaction.options.getString('platform') || 'all';
      const registry = require('../modules/streamRegistry');
      let entries = registry.list(interaction.guild.id);
      if (filterPlatform !== 'all') entries = entries.filter(e => e.platform === filterPlatform);
      if (!entries.length) return interaction.editReply('No streamer entries found for the selected filter.');

      const resultsBy = { twitch: [], youtube: [], kick: [], rumble: [], tiktok: [], instagram: [], discord: [], facebook: [], x: [] };
      for (const e of entries) {
        try {
          const ch = interaction.client.channels.cache.get(e.channelId) || await interaction.client.channels.fetch(e.channelId);
          let baseName = '';
          if (e.platform === 'twitch') {
            baseName = parseTwitchLoginFromInput(e.name || '');
          } else {
            baseName = (e.name && typeof e.name === 'string') ? (e.name.startsWith('@') ? e.name.slice(1) : e.name) : '';
          }
          let watchUrl;
          if (e.platform === 'twitch') {
            watchUrl = `https://twitch.tv/${baseName}`;
          } else if (e.platform === 'youtube') {
            watchUrl = `https://www.youtube.com/@${baseName}`;
          } else if (e.platform === 'rumble') {
            watchUrl = `https://rumble.com/user/${baseName}`;
          } else if (e.platform === 'tiktok') {
            watchUrl = `https://tiktok.com/@${baseName}`;
          } else if (e.platform === 'kick') {
            watchUrl = `https://kick.com/${baseName}`;
          } else if (e.platform === 'facebook') {
            watchUrl = `https://facebook.com/${baseName}`;
          } else if (e.platform === 'x') {
            watchUrl = `https://x.com/${baseName}`;
          } else if (e.platform === 'instagram') {
            watchUrl = `https://instagram.com/${baseName}`;
          } else if (e.platform === 'discord') {
            watchUrl = `https://discord.com/users/${baseName}`;
          }

          let titleText = 'Test Stream Title';
          let gameText = e.platform === 'twitch' ? 'Test Game' : (e.platform === 'rumble' ? 'Test Category' : null);
          let avatarUrl = null;
          let displayName = baseName;
          let imageUrl = null;
          let notes = [];

          if (e.platform === 'twitch') {
            const auth = await getTwitchAppToken();
            if (!auth) notes.push('missing Twitch credentials');
            if (auth) {
              const [u, live] = await Promise.all([
                getTwitchUser(baseName, auth),
                getTwitchLive(baseName, auth)
              ]);
              if (u) {
                displayName = u.display_name || baseName;
                avatarUrl = u.profile_image_url || null;
              }
              if (live) {
                titleText = live.title || titleText;
                gameText = live.game_name || gameText;
                imageUrl = live.thumbnail_url ? live.thumbnail_url.replace('{width}','1280').replace('{height}','720') : null;
              }
            }
          } else if (e.platform === 'youtube') {
            if (/^https?:\/\//i.test(e.name)) {
              const parts = parseYouTubeUrlToParts(e.name);
              if (parts?.type === 'handle' && parts.handle) {
                displayName = parts.handle.replace(/^@/, '');
              }
            }

            const apiKey = config?.youtube?.apiKey || config?.youtube?.youtube_api_key || config?.YOUTUBE_API_KEY || process.env.YOUTUBE_API_KEY;
            if (!apiKey) {
              notes.push('missing YouTube API key');
            } else {
              try {
                const channelId = await resolveYouTubeChannelId(e.name, apiKey);
                if (!channelId) {
                  notes.push('YouTube channel not found');
                } else {
                  const [channelInfo, live] = await Promise.all([
                    getYouTubeChannelInfo(channelId, apiKey),
                    getYouTubeLive(channelId, apiKey)
                  ]);
                  
                  avatarUrl = channelInfo.avatar;
                  if (channelInfo.title) displayName = channelInfo.title;
                  
                  if (live) {
                    const vid = live?.id?.videoId;
                    if (vid) watchUrl = `https://www.youtube.com/watch?v=${vid}`;
                    titleText = live?.snippet?.title || titleText;
                    imageUrl = live?.snippet?.thumbnails?.high?.url || live?.snippet?.thumbnails?.medium?.url || avatarUrl;
                    if (live?.snippet?.channelTitle) displayName = live.snippet.channelTitle;
                  } else {
                    watchUrl = `https://www.youtube.com/@${e.name.replace('@', '')}`;
                  }
                }
              } catch (error) {
                notes.push(`YouTube API error: ${error.message}`);
              }
            }
          } else if (e.platform === 'rumble') {
            // Rumble has no API - just use test data
            displayName = baseName;
            notes.push('Rumble has no API - presence-based only');
          } else if (e.platform === 'tiktok') {
            // TikTok has no API - just use test data
            displayName = baseName;
            notes.push('TikTok has no API - presence-based only');
          } else if (e.platform === 'kick') {
            // Kick has no API - just use test data
            displayName = baseName;
            notes.push('Kick has no API - presence-based only');
          } else if (e.platform === 'instagram') {
            // Instagram has no API - just use test data
            displayName = baseName;
            notes.push('Instagram has no API - presence-based only');
          } else if (e.platform === 'discord') {
            // Discord has no API - just use test data
            displayName = baseName;
            notes.push('Discord has no API - presence-based only');
          } else if (e.platform === 'facebook') {
            // Facebook has no API - just use test data
            displayName = baseName;
            notes.push('Facebook has no API - presence-based only');
          } else if (e.platform === 'x') {
            // X has no API - just use test data
            displayName = baseName;
            notes.push('X has no API - presence-based only');
          }

          const me = interaction.guild?.members?.me;
          if (!ch || !ch.send) {
            (resultsBy[e.platform] || resultsBy.youtube).push(`${e.platform}:${e.name} failed: channel not found or cannot send`);
            continue;
          }
          if (me) {
            const missing = [];
            const perms = ch.permissionsFor(me);
            if (!perms || !perms.has(PermissionFlagsBits.ViewChannel)) missing.push('ViewChannel');
            if (!perms || !perms.has(PermissionFlagsBits.SendMessages)) missing.push('SendMessages');
            if (!perms || !perms.has(PermissionFlagsBits.EmbedLinks)) missing.push('EmbedLinks');
            if (missing.length) {
              (resultsBy[e.platform] || resultsBy.youtube).push(`${e.platform}:${e.name} failed: missing permissions [${missing.join(', ')}] in #${ch.name || ch.id}`);
              continue;
            }
          }

          const embed = buildStreamEmbed({
            platform: e.platform,
            username: displayName,
            avatarUrl,
            url: watchUrl,
            title: titleText,
            game: gameText,
            imageUrl
          });

          const tpl = e.message || (e.platform === 'twitch' ? '{name} is live on Twitch {title} {url}' : 
            e.platform === 'youtube' ? '{name} is live on YouTube {title} {url}' : 
            e.platform === 'rumble' ? '{name} is live on Rumble {title} {url}' :
            e.platform === 'tiktok' ? '{name} is live on TikTok {title} {url}' :
            e.platform === 'kick' ? '{name} is live on Kick {title} {url}' :
            e.platform === 'discord' ? '{name} is live on Discord {title} {url}' :
            e.platform === 'facebook' ? '{name} is live on Facebook {title} {url}' :
            e.platform === 'x' ? '{name} is live on X (Twitter) {title} {url}' :
            e.platform === 'instagram' ? '{name} is live on Instagram {title} {url}' : '');
          const content = tpl.replaceAll('{name}', displayName).replaceAll('{title}', titleText).replaceAll('{url}', watchUrl);

          await ch.send({ content, embeds: [embed] });
          (resultsBy[e.platform] || resultsBy.youtube).push(`${e.platform}:${e.name} sent${notes.length ? ' (notes: ' + notes.join('; ') + ')' : ''}`);
        } catch (err) {
          try { logger.error(`stream test failed for ${e.platform}:${e.name}`, err); } catch {}
          console.log('Full error object:', err);
          const errorMsg = err?.response?.data || err?.message || err?.toString() || 'unknown error';
          (resultsBy[e.platform] || resultsBy.youtube).push(`${e.platform}:${e.name} failed: ${JSON.stringify(errorMsg)}`);
        }
      }

      const twitchOut = resultsBy.twitch.length ? `Twitch:\n${resultsBy.twitch.join('\n')}` : (filterPlatform === 'twitch' ? 'Twitch:\n(none)' : '');
      const ytOut = resultsBy.youtube.length ? `YouTube:\n${resultsBy.youtube.join('\n')}` : (filterPlatform === 'youtube' ? 'YouTube:\n(none)' : '');
      const rumbleOut = resultsBy.rumble.length ? `Rumble:\n${resultsBy.rumble.join('\n')}` : (filterPlatform === 'rumble' ? 'Rumble:\n(none)' : '');
      const tiktokOut = resultsBy.tiktok.length ? `TikTok:\n${resultsBy.tiktok.join('\n')}` : (filterPlatform === 'tiktok' ? 'TikTok:\n(none)' : '');
      const kickOut = resultsBy.kick.length ? `Kick:\n${resultsBy.kick.join('\n')}` : (filterPlatform === 'kick' ? 'Kick:\n(none)' : '');
      const instagramOut = resultsBy.instagram.length ? `Instagram:\n${resultsBy.instagram.join('\n')}` : (filterPlatform === 'instagram' ? 'Instagram:\n(none)' : '');
      const discordOut = resultsBy.discord.length ? `Discord:\n${resultsBy.discord.join('\n')}` : (filterPlatform === 'discord' ? 'Discord:\n(none)' : '');
      const facebookOut = resultsBy.facebook.length ? `Facebook:\n${resultsBy.facebook.join('\n')}` : (filterPlatform === 'facebook' ? 'Facebook:\n(none)' : '');
      const xOut = resultsBy.x.length ? `X:\n${resultsBy.x.join('\n')}` : (filterPlatform === 'x' ? 'X:\n(none)' : '');
      const sections = [twitchOut, ytOut, kickOut, rumbleOut, tiktokOut, instagramOut, discordOut, facebookOut, xOut].filter(Boolean).join('\n\n');
      return interaction.editReply(`Stream test results:\n\n${sections}`);
    }

    // Live Roles Commands
    if (sub === 'live_roles_set') {
      try {
        const platform = interaction.options.getString('platform', true);
        const whitelistRolesStr = interaction.options.getString('whitelist_roles', true);
        const liveRolesStr = interaction.options.getString('live_roles', true);
        
        // Parse role IDs
        const parseIds = (str) => (str || '').split(',').map(s => s.trim()).filter(Boolean).map(s => s.replace(/[^0-9]/g, '')).filter(Boolean);
        const whitelistRoleIds = parseIds(whitelistRolesStr);
        const liveRoleIds = parseIds(liveRolesStr);

        const platforms = platform.toLowerCase() === 'all' 
          ? ['twitch', 'youtube', 'kick', 'rumble', 'tiktok', 'instagram', 'discord', 'facebook', 'x']
          : [platform];

        const results = [];
        
        for (const plat of platforms) {
          // Get current presence settings
          const currentPresence = registry.getPresence(interaction.guild.id)[plat] || {};
          
          // Update presence with new role settings
          const res = registry.setPresence(
            interaction.guild.id, 
            plat, 
            { 
              ...currentPresence, // Keep existing settings
              liveRoleIds,
              whitelistRoleIds
            }
          );
          
          if (res.ok) {
            results.push(`✅ **${plat.charAt(0).toUpperCase() + plat.slice(1)}**: Updated`);
          } else {
            results.push(`❌ **${plat.charAt(0).toUpperCase() + plat.slice(1)}**: Failed to update`);
          }
        }
        
        const embed = {
          title: `✅ Live Roles ${platform.toLowerCase() === 'all' ? 'for All Platforms' : 'Updated'}`,
          description: [
            `**Live Roles:** ${liveRoleIds.map(id => `<@&${id}>`).join(', ')}`,
            `**Whitelist Roles:** ${whitelistRoleIds.map(id => `<@&${id}>`).join(', ')}`,
            '',
            '**Results:**',
            ...results
          ].join('\n'),
          color: 0x00ff00,
          timestamp: new Date()
        };
        
        return interaction.editReply({ embeds: [embed] });
        
      } catch (error) {
        console.error('Error in live_roles_set:', error);
        return interaction.editReply('❌ An error occurred while updating live role settings.');
      }
    }

    if (sub === 'live_roles_clear') {
      try {
        const platform = interaction.options.getString('platform');
        
        const platforms = [];
        if (!platform || platform.toLowerCase() === 'all') {
          // Clear all platforms
          platforms.push(...['twitch', 'youtube', 'kick', 'rumble', 'tiktok', 'facebook', 'x', 'instagram', 'discord']);
        } else {
          // Clear specific platform
          platforms.push(platform);
        }

        const results = [];
        
        for (const plat of platforms) {
          const currentPresence = registry.getPresence(interaction.guild.id)[plat] || {};
          if (!currentPresence || (!currentPresence.liveRoleIds?.length && !currentPresence.whitelistRoleIds?.length)) {
            results.push(`ℹ️ **${plat.charAt(0).toUpperCase() + plat.slice(1)}**: No live roles configured`);
            continue;
          }
          
          // Keep other settings, just clear the roles
          const res = registry.setPresence(
            interaction.guild.id,
            plat,
            {
              ...currentPresence,
              liveRoleIds: [],
              whitelistRoleIds: []
            }
          );
          
          if (res.ok) {
            results.push(`✅ **${plat.charAt(0).toUpperCase() + plat.slice(1)}**: Cleared`);
          } else {
            results.push(`❌ **${plat.charAt(0).toUpperCase() + plat.slice(1)}**: Failed to clear`);
          }
        }
        
        const embed = {
          title: `✅ Live Roles Cleared`,
          description: [
            `Cleared live roles for ${platforms.length} platform${platforms.length === 1 ? '' : 's'}.`,
            '',
            '**Results:**',
            ...results
          ].join('\n'),
          color: 0x00ff00,
          timestamp: new Date()
        };
        
        return interaction.editReply({ embeds: [embed] });
      } catch (error) {
        console.error('Error in live_roles_clear:', error);
        return interaction.editReply('❌ An error occurred while clearing live roles.');
      }
    }

    // Stream Notifications Commands
    if (sub === 'notifications_set') {
      try {
        const platform = interaction.options.getString('platform', true);
        const channel = interaction.options.getChannel('channel', true);
        const whitelistRolesStr = interaction.options.getString('whitelist_roles', true);
        const message = interaction.options.getString('message');
        
        // Parse role IDs
        const parseIds = (str) => (str || '').split(',').map(s => s.trim()).filter(Boolean).map(s => s.replace(/[^0-9]/g, '')).filter(Boolean);
        const whitelistRoleIds = parseIds(whitelistRolesStr);
        
        if (!whitelistRoleIds.length) {
          return interaction.editReply('❌ You must provide at least one whitelist role.');
        }
        
        // Get current presence settings
        const currentPresence = registry.getPresence(interaction.guild.id)[platform] || {};
        
        // Update presence with new notification settings
        const res = registry.setPresence(
          interaction.guild.id, 
          platform, 
          { 
            ...currentPresence, // Keep existing settings
            channelId: channel.id,
            message: message || null,
            whitelistRoleIds
          }
        );
        
        if (!res.ok) {
          return interaction.editReply('❌ Failed to update notification settings. Please check the logs for more details.');
        }
        
        const embed = {
          title: `✅ ${platform.charAt(0).toUpperCase() + platform.slice(1)} Notifications Updated`,
          description: [
            `**Channel:** <#${channel.id}>`,
            `**Whitelist Roles:** ${whitelistRoleIds.map(id => `<@&${id}>`).join(', ')}`,
            message ? `**Custom Message:** "${message}"` : '**Using default notification message**'
          ].join('\n'),
          color: 0x00ff00,
          timestamp: new Date()
        };
        
        return interaction.editReply({ embeds: [embed] });
        
      } catch (error) {
        console.error('Error in notifications_set:', error);
        return interaction.editReply('❌ An error occurred while updating notification settings.');
      }
    }

    if (sub === 'notifications_clear') {
      try {
        const platform = interaction.options.getString('platform');
        
        if (platform) {
          // Clear notifications for specific platform
          const currentPresence = registry.getPresence(interaction.guild.id)[platform] || {};
          if (!currentPresence) {
            return interaction.editReply(`❌ No notifications configured for ${platform}.`);
          }
          
          // Keep other settings, just clear the notification settings
          registry.setPresence(
            interaction.guild.id,
            platform,
            {
              ...currentPresence,
              channelId: null,
              message: null
            }
          );
          
          return interaction.editReply(`✅ Cleared notifications for ${platform}.`);
        } else {
          // Clear all notifications across all platforms
          const allPlatforms = ['twitch', 'youtube', 'kick', 'rumble', 'tiktok', 'instagram', 'discord', 'facebook', 'x'];
          for (const p of allPlatforms) {
            const current = registry.getPresence(interaction.guild.id)[p];
            if (current) {
              registry.setPresence(
                interaction.guild.id,
                p,
                {
                  ...current,
                  channelId: null,
                  message: null
                }
              );
            }
          }
          return interaction.editReply('✅ Cleared all notifications for all platforms.');
        }
      } catch (error) {
        console.error('Error in notifications_clear:', error);
        return interaction.editReply('❌ An error occurred while clearing notifications.');
      }
    }

    if (sub === 'test_notification') {
      try {
        const user = interaction.options.getUser('user', true);
        const platform = interaction.options.getString('platform', true);
        const member = interaction.guild.members.cache.get(user.id);
        
        if (!member) {
          return interaction.editReply('❌ User not found in this server.');
        }

        const allPlatforms = ['twitch', 'youtube', 'kick', 'rumble', 'tiktok', 'instagram', 'discord', 'facebook', 'x'];
        const platforms = platform === 'all' ? allPlatforms : [platform];
        
        let successCount = 0;
        const failedPlatforms = [];
        const results = [];

        for (const p of platforms) {
          // Simulate a streaming activity with proper format for the notification handler
          const activity = {
            name: p === 'twitch' ? 'Twitch' : p.charAt(0).toUpperCase() + p.slice(1),
            type: 1, // STREAMING
            url: p === 'twitch' 
              ? `https://twitch.tv/${user.username}` 
              : `https://${p}.com/${user.username}`,
            details: `Test stream on ${p}`,
            state: `Testing ${p} notification`,
            application_id: null,
            assets: {
              large_image: null,
              large_text: null,
              small_image: null,
              small_text: null
            },
            timestamps: {
              start: Date.now()
            }
          };

          // Get presence rules for this platform
          const presenceRules = registry.getPresence(interaction.guild.id)?.[p];
          if (!presenceRules || !presenceRules.channelId) {
            failedPlatforms.push(`${p} (no rules)`);
            continue;
          }

          // Call the appropriate notifier based on platform
          if (!['twitch', 'youtube', 'kick', 'rumble', 'tiktok', 'facebook', 'x', 'instagram', 'discord'].includes(p)) {
            failedPlatforms.push(`${p} (unsupported platform)`);
            continue;
          }
          
          try {
            // Import notifiers with error handling
            let apiNotifier, presenceNotifier;
            try {
              apiNotifier = require('../modules/apiStreamNotifier');
              presenceNotifier = require('../modules/presenceStreamNotifier');
            } catch (error) {
              console.error(`Failed to load notifier modules:`, error);
              failedPlatforms.push(`${p} (internal error)`);
              continue;
            }
            
            // For API-based platforms, use the API notifier
            if (['twitch', 'youtube', 'kick', 'rumble', 'tiktok'].includes(p)) {
              try {
                await apiNotifier.checkPlatforms(interaction.client);
                successCount++;
                results.push(`✅ ${p}`);
              } catch (error) {
                console.error(`API notifier error for ${p}:`, error);
                failedPlatforms.push(`${p} (API error: ${error.message})`);
              }
            } 
            // For presence-based platforms, use the presence notifier
            else {
              try {
                const activityData = {
                  type: 'STREAMING',
                  url: activity.url || `https://${p}.com/${member.user.username}`,
                  name: activity.name || 'Streaming',
                  details: activity.details || 'Streaming',
                  state: activity.state || 'Live',
                  createdTimestamp: Date.now(),
                  platform: p
                };

                await presenceNotifier.checkActivity(
                  interaction.client,
                  interaction.guild,
                  member,
                  activityData,
                  { [p]: presenceRules }
                );
                
                successCount++;
                results.push(`✅ ${p}`);
              } catch (error) {
                console.error(`Error handling ${p} notification:`, error);
                failedPlatforms.push(`${p} (${error.message})`);
              }
            }
          } catch (error) {
            console.error(`Error sending test notification for ${p}:`, error);
            failedPlatforms.push(p);
          }
          }

        let reply = '';
        if (successCount > 0) {
          reply = `✅ Sent ${successCount} test notification${successCount > 1 ? 's' : ''} for ${user.tag}:\n${results.join('\n')}`;
        } else {
          reply = '❌ Failed to send any test notifications.';
        }
        
        if (failedPlatforms.length > 0) {
          reply += `\n\n❌ Failed for: ${failedPlatforms.join(', ')}`;
        }

        return interaction.editReply(reply);

      } catch (error) {
        console.error('Error in test_notification:', error);
        return interaction.editReply('❌ An error occurred while sending the test notification.');
      }
    }

    if (sub === 'check_live_roles') {
      const filterPlatform = interaction.options.getString('platform') || 'all';
      const registry = require('../modules/streamRegistry');
      const presenceRules = registry.getPresence(interaction.guild.id);
      const entries = registry.list(interaction.guild.id);
      
      let assigned = 0;
      let checked = 0;
      const results = [];
      
      const platforms = filterPlatform === 'all' ? ['twitch', 'youtube', 'kick', 'rumble', 'tiktok', 'instagram', 'discord', 'facebook', 'x'] : [filterPlatform];
      
      // Check presence-based streaming (Discord, etc.)
      for (const platform of platforms) {
        const rules = presenceRules[platform];
        if (!rules || !rules.liveRoleIds?.length) continue;
        
        for (const [userId, member] of interaction.guild.members.cache) {
          if (!member.presence?.activities || member.user.bot) continue;
          
          let isStreaming = false;
          
          if (platform === 'twitch') {
            isStreaming = member.presence.activities.some(a => a.name === 'Twitch' && a.url?.includes('twitch.tv'));
          } else if (platform === 'youtube') {
            isStreaming = member.presence.activities.some(a => a.name === 'YouTube' || a.url?.includes('youtube.com'));
          } else if (platform === 'kick') {
            isStreaming = member.presence.activities.some(a => a.name === 'Kick' || a.url?.includes('kick.com'));
          } else if (platform === 'rumble') {
            isStreaming = member.presence.activities.some(a => a.name === 'Rumble' || a.url?.includes('rumble.com'));
          } else if (platform === 'tiktok') {
            isStreaming = member.presence.activities.some(a => a.name === 'TikTok' || a.url?.includes('tiktok.com'));
          } else if (platform === 'instagram') {
            isStreaming = member.presence.activities.some(a => a.name === 'Instagram' || a.url?.includes('instagram.com'));
          } else if (platform === 'discord') {
            isStreaming = !!member.voice?.channel;
          } else if (platform === 'facebook') {
            isStreaming = member.presence.activities.some(a => a.name === 'Facebook' || a.url?.includes('facebook.com'));
          } else if (platform === 'x') {
            isStreaming = member.presence.activities.some(a => a.name === 'X' || a.name === 'Twitter' || a.url?.includes('x.com') || a.url?.includes('twitter.com'));
          }
          
          if (isStreaming) {
            const hasWhitelist = !rules.whitelistRoleIds?.length || rules.whitelistRoleIds.some(r => member.roles.cache.has(r));
            if (hasWhitelist) {
              checked++;
              let rolesAdded = 0;
              
              for (const rid of rules.liveRoleIds) {
                if (rid && !member.roles.cache.has(rid)) {
                  try {
                    await member.roles.add(rid);
                    rolesAdded++;
                    assigned++;
                  } catch (error) {
                    console.error(`Error adding role ${rid} to ${member.user.tag}:`, error.message);
                  }
                }
              }
              
              if (rolesAdded > 0) {
                results.push(`${member.user.username} (${platform} presence) - added ${rolesAdded} role(s)`);
              }
            }
          }
        }
      }
      
      // Check API-based streaming (Twitch, YouTube, etc.)
      for (const entry of entries) {
        if (!platforms.includes(entry.platform) || !entry.liveRoleIds?.length) continue;
        
        // Skip presence-based platforms that were already checked
        if (entry.platform === 'discord') continue;
        
        let member;
        try {
          if (entry.discordUser) {
            member = await interaction.guild.members.fetch(entry.discordUser).catch(() => null);
          }
          
          if (!member) {
            // Try to find member by username if discordUser is not set
            const username = entry.name.split('/').pop().split('@').pop().split('?')[0];
            member = interaction.guild.members.cache.find(m => 
              m.user.username.toLowerCase() === username.toLowerCase() ||
              m.displayName.toLowerCase() === username.toLowerCase()
            );
          }
          
          if (!member) continue;
          
          // Check whitelist roles if any are set
          const hasWhitelist = !entry.whitelistRoleIds?.length || 
            entry.whitelistRoleIds.some(r => member.roles.cache.has(r));
          
          if (!hasWhitelist) continue;
          
          let isLive = false;
          
          if (entry.platform === 'twitch') {
            const auth = await getTwitchAppToken();
            if (auth) {
              const login = entry.name.split('/').pop().split('?')[0];
              const liveData = await getTwitchLive(login, auth);
              isLive = !!liveData;
              checked++;
            }
          } else if (entry.platform === 'youtube') {
            const apiKey = config?.youtube?.apiKey || config?.youtube?.youtube_api_key || 
                         config?.YOUTUBE_API_KEY || process.env.YOUTUBE_API_KEY;
            if (apiKey) {
              const channelId = await resolveYouTubeChannelId(entry.name, apiKey);
              if (channelId) {
                const live = await getYouTubeLive(channelId, apiKey);
                isLive = !!live;
                checked++;
              }
            }
          }
          
          if (isLive) {
            let rolesAdded = 0;
            
            for (const rid of entry.liveRoleIds) {
              if (rid && !member.roles.cache.has(rid)) {
                try {
                  await member.roles.add(rid);
                  rolesAdded++;
                  assigned++;
                } catch (error) {
                  console.error(`Error adding role ${rid} to ${member.user.tag}:`, error.message);
                }
              }
            }
            
            if (rolesAdded > 0) {
              results.push(`${member.user.username} (${entry.platform} API) - added ${rolesAdded} role(s)`);
            }
          }
          
        } catch (error) {
          console.error(`Error checking ${entry.platform} stream for ${entry.id}:`, error);
        }
      }
      
      const summary = `Checked ${checked} streaming users, assigned ${assigned} roles.`;
      const details = results.length > 0 ? '\n\n' + results.join('\n') : '';
      
      return await safeReply(summary + details);
    }

    // If we get here, the subcommand wasn't recognized
    return await safeReply('❌ Unknown subcommand.');
    
  } catch (error) {
    console.error('Error in stream command:', error);
    try {
      await safeReply('❌ An error occurred while processing this command.');
    } catch (err) {
      console.error('Failed to send error response:', err);
    }
  }
  },

  async autocomplete(interaction) {
    try {
      if (!interaction.guildId) {
        return interaction.respond([]);
      }

      const focusedOption = interaction.options.getFocused(true);
      const subcommand = interaction.options.getSubcommand();
      
      // Handle name autocomplete for relevant subcommands
      if (['edit', 'remove'].includes(subcommand) && focusedOption.name === 'name') {
        try {
          const platform = interaction.options.getString('platform');
          if (!platform) {
            return interaction.respond([{ name: '⚠️ Select a platform first', value: 'select_platform' }]);
          }
          
          const entries = registry.list(interaction.guildId)
            .filter(e => e.platform && e.platform.toLowerCase() === platform.toLowerCase())
            .map(e => ({
              name: `${e.name} (${e.platform})`,
              value: e.name
            }))
            .slice(0, 25);
          
          if (entries.length === 0) {
            return interaction.respond([{ name: `No streamers found for ${platform}`, value: 'no_streamers' }]);
          }
          
          return interaction.respond(entries);
        } catch (error) {
          console.error('Error in name autocomplete:', error);
          return interaction.respond([{ name: '❌ Error loading streamers', value: 'error' }]);
        }
      }
      
      // Handle platform autocomplete
      if (focusedOption.name === 'platform') {
        try {
          const platforms = [
            { name: 'Twitch', value: 'twitch' },
            { name: 'YouTube', value: 'youtube' },
            { name: 'Kick', value: 'kick' },
            { name: 'Rumble', value: 'rumble' },
            { name: 'TikTok', value: 'tiktok' },
            { name: 'Instagram', value: 'instagram' },
            { name: 'Discord', value: 'discord' },
            { name: 'Facebook', value: 'facebook' },
            { name: 'X (Twitter)', value: 'x' }
          ];
          
          const search = focusedOption.value.toLowerCase();
          const filtered = search 
            ? platforms.filter(p => 
                p.name.toLowerCase().includes(search) || 
                p.value.includes(search)
              )
            : platforms;
            
          return interaction.respond(filtered.slice(0, 25));
        } catch (error) {
          console.error('Error in platform autocomplete:', error);
          return interaction.respond([{ name: '❌ Error loading platforms', value: 'error' }]);
        }
      }
      
      // Default empty response if no matches
      return interaction.respond([]);
      
    } catch (error) {
      console.error('Error in autocomplete:', error);
      return interaction.respond([{ name: '❌ An error occurred', value: 'error' }]);
    }
  },
};