const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const logger = require('../modules/logger');
const configLoader = require('../modules/configLoader');
const config = configLoader.config;
const twitchConfig = configLoader.twitch;
const { buildStreamEmbed } = require('../modules/streamEmbeds');

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
    .setDMPermission(false)
    .setDescription('Manage stream registry and presence-based live notifications')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(subcommand =>
      subcommand
        .setName('add')
        .setDescription('Add a streamer entry to this server registry')
        .addStringOption(o => o.setName('platform').setDescription('twitch, youtube, rumble, tiktok, or kick').setRequired(true).addChoices({ name: 'twitch', value: 'twitch' }, { name: 'youtube', value: 'youtube' }, { name: 'kick', value: 'kick' }, { name: 'rumble', value: 'rumble' }, { name: 'tiktok', value: 'tiktok' }, { name: 'instagram', value: 'instagram' }, { name: 'discord', value: 'discord' }, { name: 'facebook', value: 'facebook' }, { name: 'x', value: 'x' }))
        .addStringOption(o => o.setName('id').setDescription('Username or id / @handle').setRequired(true))
        .addChannelOption(o => o.setName('channel').setDescription('Channel to post notifications').setRequired(true))
        .addUserOption(o => o.setName('discord_user').setDescription('Discord user to give live role to (optional)'))
        .addRoleOption(o => o.setName('live_role').setDescription('Role to assign while live (optional)'))
        .addStringOption(o => o.setName('live_roles').setDescription('Comma-separated role mentions/IDs to assign while live'))
        .addStringOption(o => o.setName('whitelist_roles').setDescription('Comma-separated role mentions/IDs required to trigger notifications'))
        .addStringOption(o => o.setName('message').setDescription('Custom live message: {name} {title} {url}'))
        .addStringOption(o => o.setName('vod_message').setDescription('Custom VOD message: {name} {title} {url} (YouTube only)')))
    .addSubcommand(subcommand =>
      subcommand
        .setName('remove')
        .setDescription('Remove a streamer entry from this server registry')
        .addStringOption(o => o.setName('platform').setDescription('twitch, youtube, rumble, tiktok, or kick').setRequired(true).addChoices({ name: 'twitch', value: 'twitch' }, { name: 'youtube', value: 'youtube' }, { name: 'kick', value: 'kick' }, { name: 'rumble', value: 'rumble' }, { name: 'tiktok', value: 'tiktok' }, { name: 'instagram', value: 'instagram' }, { name: 'discord', value: 'discord' }, { name: 'facebook', value: 'facebook' }, { name: 'x', value: 'x' }))
        .addStringOption(o => o.setName('id').setDescription('Username or id / @handle').setRequired(true)))
    .addSubcommand(subcommand =>
      subcommand
        .setName('edit')
        .setDescription('Edit a streamer entry for this server registry')
        .addStringOption(o => o.setName('platform').setDescription('twitch, youtube, rumble, tiktok, or kick').setRequired(true).addChoices({ name: 'twitch', value: 'twitch' }, { name: 'youtube', value: 'youtube' }, { name: 'kick', value: 'kick' }, { name: 'rumble', value: 'rumble' }, { name: 'tiktok', value: 'tiktok' }, { name: 'instagram', value: 'instagram' }, { name: 'discord', value: 'discord' }, { name: 'facebook', value: 'facebook' }, { name: 'x', value: 'x' }))
        .addStringOption(o => o.setName('id').setDescription('Existing username or id / @handle').setRequired(true).setAutocomplete(true))
        .addChannelOption(o => o.setName('channel').setDescription('New channel for notifications'))
        .addUserOption(o => o.setName('discord_user').setDescription('Discord user to give live role to'))
        .addRoleOption(o => o.setName('live_role').setDescription('Role to assign while live'))
        .addStringOption(o => o.setName('live_roles').setDescription('Comma-separated role mentions/IDs to assign while live'))
        .addStringOption(o => o.setName('whitelist_roles').setDescription('Comma-separated role mentions/IDs required to trigger notifications'))
        .addStringOption(o => o.setName('message').setDescription('New live message: {name} {title} {url}'))
        .addStringOption(o => o.setName('vod_message').setDescription('New VOD message (YouTube): {name} {title} {url}')))
    .addSubcommand(subcommand =>
      subcommand
        .setName('edit_all')
        .setDescription('Bulk edit all entries for a platform in this server')
        .addStringOption(o => o.setName('platform').setDescription('twitch, youtube, rumble, tiktok, or kick').setRequired(true).addChoices({ name: 'twitch', value: 'twitch' }, { name: 'youtube', value: 'youtube' }, { name: 'kick', value: 'kick' }, { name: 'rumble', value: 'rumble' }, { name: 'tiktok', value: 'tiktok' }, { name: 'instagram', value: 'instagram' }, { name: 'discord', value: 'discord' }, { name: 'facebook', value: 'facebook' }, { name: 'x', value: 'x' }))
        .addChannelOption(o => o.setName('channel').setDescription('New channel for notifications'))
        .addUserOption(o => o.setName('discord_user').setDescription('Discord user to give live role to'))
        .addRoleOption(o => o.setName('live_role').setDescription('Role to assign while live'))
        .addStringOption(o => o.setName('live_roles').setDescription('Comma-separated role mentions/IDs to assign while live'))
        .addStringOption(o => o.setName('whitelist_roles').setDescription('Comma-separated role mentions/IDs required to trigger notifications'))
        .addStringOption(o => o.setName('message').setDescription('New live message: {name} {title} {url}'))
        .addStringOption(o => o.setName('vod_message').setDescription('New VOD message (YouTube): {name} {title} {url}')))
    .addSubcommand(subcommand =>
      subcommand
        .setName('list')
        .setDescription('List streamer entries for this server')
        .addStringOption(o => o.setName('platform').setDescription('Filter by platform').addChoices({ name: 'twitch', value: 'twitch' }, { name: 'youtube', value: 'youtube' }, { name: 'kick', value: 'kick' }, { name: 'rumble', value: 'rumble' }, { name: 'tiktok', value: 'tiktok' }, { name: 'instagram', value: 'instagram' }, { name: 'discord', value: 'discord' }, { name: 'facebook', value: 'facebook' }, { name: 'x', value: 'x' })))
    .addSubcommand(subcommand =>
      subcommand
        .setName('presence_set')
        .setDescription('Set presence-based live notifications (no per-user entries needed)')
        .addStringOption(o => o.setName('platform').setDescription('twitch, youtube, rumble, tiktok, or kick').setRequired(true).addChoices({ name: 'twitch', value: 'twitch' }, { name: 'youtube', value: 'youtube' }, { name: 'kick', value: 'kick' }, { name: 'rumble', value: 'rumble' }, { name: 'tiktok', value: 'tiktok' }, { name: 'instagram', value: 'instagram' }, { name: 'discord', value: 'discord' }, { name: 'facebook', value: 'facebook' }, { name: 'x', value: 'x' }))
        .addChannelOption(o => o.setName('channel').setDescription('Channel to post notifications').setRequired(true))
        .addStringOption(o => o.setName('whitelist_roles').setDescription('Comma-separated role mentions/IDs required to trigger notifications').setRequired(true))
        .addRoleOption(o => o.setName('live_role').setDescription('Role to assign while live'))
        .addStringOption(o => o.setName('live_roles').setDescription('Comma-separated role mentions/IDs to assign while live'))
        .addStringOption(o => o.setName('message').setDescription('Custom live message: {name} {title} {url}')))
    .addSubcommand(subcommand =>
      subcommand
        .setName('presence_clear')
        .setDescription('Clear presence-based live notifications for a platform (or all if omitted)')
        .addStringOption(o => o.setName('platform').setDescription('twitch, youtube, rumble, tiktok, or kick (omit to clear all)').addChoices({ name: 'twitch', value: 'twitch' }, { name: 'youtube', value: 'youtube' }, { name: 'kick', value: 'kick' }, { name: 'rumble', value: 'rumble' }, { name: 'tiktok', value: 'tiktok' }, { name: 'instagram', value: 'instagram' }, { name: 'discord', value: 'discord' }, { name: 'facebook', value: 'facebook' }, { name: 'x', value: 'x' })))
    .addSubcommand(subcommand =>
      subcommand
        .setName('test')
        .setDescription('Send test stream notifications for configured entries (Admin only)')
        .addStringOption(o => o
          .setName('platform')
          .setDescription('Filter to a single platform')
          .addChoices(
            { name: 'all', value: 'all' },
            { name: 'twitch', value: 'twitch' },
            { name: 'youtube', value: 'youtube' },
            { name: 'kick', value: 'kick' },
            { name: 'rumble', value: 'rumble' },
            { name: 'tiktok', value: 'tiktok' },
            { name: 'instagram', value: 'instagram' },
            { name: 'discord', value: 'discord' }, { name: 'facebook', value: 'facebook' }, { name: 'x', value: 'x' }
          )))
    .addSubcommand(subcommand =>
      subcommand
        .setName('check_live_roles')
        .setDescription('Manually check and assign live roles to users currently streaming')
        .addStringOption(o => o.setName('platform').setDescription('Check specific platform or all').addChoices({ name: 'all', value: 'all' }, { name: 'twitch', value: 'twitch' }, { name: 'youtube', value: 'youtube' }, { name: 'kick', value: 'kick' }, { name: 'rumble', value: 'rumble' }, { name: 'tiktok', value: 'tiktok' }, { name: 'instagram', value: 'instagram' }, { name: 'discord', value: 'discord' }, { name: 'facebook', value: 'facebook' }, { name: 'x', value: 'x' }))),

  /**
   * Execute the stream command
   * @param {import('discord.js').CommandInteraction} interaction - The interaction object
   */
  async execute(interaction) {
    try {
      if (!interaction.inGuild()) {
        return interaction.reply({ 
          content: '❌ This command can only be used in a server.',
          flags: 64,
          ephemeral: true 
        });
      }

      await interaction.deferReply({ flags: 64 });

    const sub = interaction.options.getSubcommand();

    if (sub === 'add') {
      const platform = interaction.options.getString('platform', true);
      const id = interaction.options.getString('id', true);
      const channel = interaction.options.getChannel('channel', true);
      const message = interaction.options.getString('message');
      const vodMessage = interaction.options.getString('vod_message');
      const discordUser = interaction.options.getUser('discord_user');
      const liveRole = interaction.options.getRole('live_role');
      const liveRolesStr = interaction.options.getString('live_roles');
      const whitelistRolesStr = interaction.options.getString('whitelist_roles');
      const liveRoleIds = Array.from(new Set([...(liveRole ? [liveRole.id] : []), ...parseIds(liveRolesStr)]));
      const whitelistRoleIds = parseIds(whitelistRolesStr);
      const registry = require('../modules/streamRegistry');
      const res = registry.add(interaction.guild.id, { 
        platform, 
        id, 
        channelId: channel.id, 
        message, 
        vodMessage, 
        discordUser: discordUser ? discordUser.id : null, 
        liveRoleIds, 
        whitelistRoleIds 
      });
      
      if (!res.ok) {
        return interaction.editReply({ 
          content: `❌ Failed to add streamer: ${res.reason || 'Unknown error'}`,
          flags: 64
        });
      }
      
      return interaction.editReply({ 
        content: `✅ Added ${platform}:${id} -> ${channel}`,
        flags: 64
      });
    }

    if (sub === 'remove') {
      const platform = interaction.options.getString('platform', true);
      const id = interaction.options.getString('id', true);
      const registry = require('../modules/streamRegistry');
      const res = registry.remove(interaction.guild.id, platform, id);
      if (res.removed) {
        return interaction.editReply({ content: `✅ Removed ${platform}:${id}`, flags: 64 });
      }
      // If not found, show current entries for this platform to help user
      const list = registry.list(interaction.guild.id).filter(e => e.platform === platform);
      if (!list.length) {
        return interaction.editReply({ content: `❌ No matching entry found. No ${platform} entries configured.`, flags: 64 });
      }
      const names = list.map(e => e.id).join(', ');
      return interaction.editReply({ content: `❌ No matching entry found. Available ${platform} IDs: ${names}`, flags: 64 });
    }

    if (sub === 'edit') {
      const platform = interaction.options.getString('platform', true);
      const id = interaction.options.getString('id', true);
      const channel = interaction.options.getChannel('channel');
      const message = interaction.options.getString('message');
      const vodMessage = interaction.options.getString('vod_message');
      const discordUser = interaction.options.getUser('discord_user');
      const liveRole = interaction.options.getRole('live_role');
      const liveRolesStr = interaction.options.getString('live_roles');
      const whitelistRolesStr = interaction.options.getString('whitelist_roles');
      const parseIds = (str) => (str || '').split(',').map(s => s.trim()).filter(Boolean).map(s => s.replace(/[^0-9]/g, '')).filter(Boolean);
      if (!channel && (message === null || message === undefined) && (vodMessage === null || vodMessage === undefined) && !discordUser && !liveRole && !liveRolesStr && !whitelistRolesStr) {
        return await interaction.editReply({ content: 'Provide at least one field to update: channel, message, vod_message, discord_user, live_role, live_roles, or whitelist_roles.' });
      }
      const registry = require('../modules/streamRegistry');
      const patch = {};
      if (channel) patch.channelId = channel.id;
      if (message !== null && message !== undefined) patch.message = message;
      if (vodMessage !== null && vodMessage !== undefined) patch.vodMessage = vodMessage;
      if (discordUser) patch.discordUser = discordUser.id;
      if (liveRole) patch.liveRoleId = liveRole.id; // normalized to array in registry.update
      if (liveRolesStr) patch.liveRoleIds = parseIds(liveRolesStr);
      if (whitelistRolesStr) patch.whitelistRoleIds = parseIds(whitelistRolesStr);
      const res = registry.update(interaction.guild.id, platform, id, patch);
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
      if (liveRole) updates.push(`live role: ${liveRole}`);
      if (liveRolesStr) updates.push(`live roles: ${liveRolesStr}`);
      if (whitelistRolesStr) updates.push(`whitelist roles: ${whitelistRolesStr}`);
      
      return interaction.editReply({ 
        content: `✅ Updated ${platform}:${id}${updates.length ? '\n' + updates.join('\n') : ''}`,
        flags: 64
      });
    }

    if (sub === 'list') {
      const registry = require('../modules/streamRegistry');
      const filterPlatform = interaction.options.getString('platform');
      let list = registry.list(interaction.guild.id);
      
      if (filterPlatform) {
        list = list.filter(e => e.platform === filterPlatform);
      }
      
      if (!list.length) {
        const msg = filterPlatform ? `No ${filterPlatform} entries found.` : 'No streamer entries set for this server.';
        return await interaction.editReply(msg);
      }

      const groups = {
        twitch: list.filter(e => e.platform === 'twitch'),
        youtube: list.filter(e => e.platform === 'youtube'),
        kick: list.filter(e => e.platform === 'kick'),
        rumble: list.filter(e => e.platform === 'rumble'),
        tiktok: list.filter(e => e.platform === 'tiktok'),
        instagram: list.filter(e => e.platform === 'instagram'),
        discord: list.filter(e => e.platform === 'discord'),
        facebook: list.filter(e => e.platform === 'facebook'),
        x: list.filter(e => e.platform === 'x')
      };

      const platformEmojis = {
        twitch: '🟣',
        youtube: '🔴', 
        kick: '🟢',
        rumble: '🟢',
        tiktok: '🔴',
        instagram: '🟣',
        discord: '🔵',
        facebook: '🔵',
        x: '⚫'
      };

      let output = '';
      for (const platform of ['twitch', 'youtube', 'kick', 'rumble', 'tiktok', 'instagram', 'discord', 'facebook', 'x']) {
        const entries = groups[platform];
        if (!entries || !entries.length) continue;
        const emoji = platformEmojis[platform] || '📺';
        const usernames = entries.map(e => e.id).join(', ');
        output += `${emoji} **${platform.toUpperCase()}**: ${usernames}\n`;
      }

      return await interaction.editReply(output || 'No entries found.');
    }

    if (sub === 'edit_all') {
      const platform = interaction.options.getString('platform', true);
      const channel = interaction.options.getChannel('channel');
      const message = interaction.options.getString('message');
      const vodMessage = interaction.options.getString('vod_message');
      const discordUser = interaction.options.getUser('discord_user');
      const liveRole = interaction.options.getRole('live_role');
      const liveRolesStr = interaction.options.getString('live_roles');
      const whitelistRolesStr = interaction.options.getString('whitelist_roles');
      const parseIds = (str) => (str || '').split(',').map(s => s.trim()).filter(Boolean).map(s => s.replace(/[^0-9]/g, '')).filter(Boolean);

      if (!channel && (message === null || message === undefined) && (vodMessage === null || vodMessage === undefined) && !discordUser && !liveRole && !liveRolesStr && !whitelistRolesStr) {
        return await interaction.editReply({ content: 'Provide at least one field to update: channel, message, vod_message, discord_user, live_role, live_roles, or whitelist_roles.' });
      }

      const registry = require('../modules/streamRegistry');
      const list = registry.list(interaction.guild.id).filter(e => e.platform === platform);
      if (!list.length) return await interaction.editReply({ content: `No ${platform} entries found.` });

      let updated = 0;
      for (const e of list) {
        const patch = {};
        if (channel) patch.channelId = channel.id;
        if (message !== null && message !== undefined) patch.message = message;
        if (vodMessage !== null && vodMessage !== undefined) patch.vodMessage = vodMessage;
        if (discordUser) patch.discordUser = discordUser.id;
        if (liveRole) patch.liveRoleId = liveRole.id; // normalized to array in registry.update
        if (liveRolesStr) patch.liveRoleIds = parseIds(liveRolesStr);
        if (whitelistRolesStr) patch.whitelistRoleIds = parseIds(whitelistRolesStr);
        const res = registry.update(interaction.guild.id, platform, e.id, patch);
        if (res.ok) updated++;
      }

      return await interaction.editReply({ content: `Updated ${updated} ${platform} entr${updated === 1 ? 'y' : 'ies'}.` });
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
          let baseName = e.platform === 'twitch' ? parseTwitchLoginFromInput(e.id) : (e.id.startsWith('@') ? e.id.slice(1) : e.id);
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
          } else if (e.platform === 'instagram') {
            watchUrl = `https://instagram.com/${baseName}`;
          } else if (e.platform === 'discord') {
            watchUrl = `https://discord.com/users/${baseName}`;
          } else if (e.platform === 'facebook') {
            watchUrl = `https://facebook.com/${baseName}`;
          } else if (e.platform === 'x') {
            watchUrl = `https://x.com/${baseName}`;
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
            if (/^https?:\/\//i.test(e.id)) {
              const parts = parseYouTubeUrlToParts(e.id);
              if (parts?.type === 'handle' && parts.handle) {
                displayName = parts.handle.replace(/^@/, '');
              }
            }

            const apiKey = config?.youtube?.apiKey || config?.youtube?.youtube_api_key || config?.YOUTUBE_API_KEY || process.env.YOUTUBE_API_KEY;
            if (!apiKey) {
              notes.push('missing YouTube API key');
            } else {
              try {
                const channelId = await resolveYouTubeChannelId(e.id, apiKey);
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
                    watchUrl = `https://www.youtube.com/@${e.id.replace('@', '')}`;
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
            (resultsBy[e.platform] || resultsBy.youtube).push(`${e.platform}:${e.id} failed: channel not found or cannot send`);
            continue;
          }
          if (me) {
            const missing = [];
            const perms = ch.permissionsFor(me);
            if (!perms || !perms.has(PermissionFlagsBits.ViewChannel)) missing.push('ViewChannel');
            if (!perms || !perms.has(PermissionFlagsBits.SendMessages)) missing.push('SendMessages');
            if (!perms || !perms.has(PermissionFlagsBits.EmbedLinks)) missing.push('EmbedLinks');
            if (missing.length) {
              (resultsBy[e.platform] || resultsBy.youtube).push(`${e.platform}:${e.id} failed: missing permissions [${missing.join(', ')}] in #${ch.name || ch.id}`);
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

          const tpl = e.message || (e.platform === 'twitch' ? '{name} is live on Twitch: {title} {url}' : 
            e.platform === 'youtube' ? '{name} is live on YouTube: {title} {url}' : 
            e.platform === 'rumble' ? '{name} is live on Rumble: {title} {url}' :
            e.platform === 'tiktok' ? '{name} is live on TikTok: {title} {url}' :
            e.platform === 'kick' ? '{name} is live on Kick: {title} {url}' :
            e.platform === 'discord' ? '{name} is live on Discord: {title} {url}' :
            e.platform === 'facebook' ? '{name} is live on Facebook: {title} {url}' :
            e.platform === 'x' ? '{name} is live on X: {title} {url}' :
            '{name} is live on Instagram: {title} {url}');
          const content = tpl.replaceAll('{name}', displayName).replaceAll('{title}', titleText).replaceAll('{url}', watchUrl);

          await ch.send({ content, embeds: [embed] });
          (resultsBy[e.platform] || resultsBy.youtube).push(`${e.platform}:${e.id} sent${notes.length ? ' (notes: ' + notes.join('; ') + ')' : ''}`);
        } catch (err) {
          try { logger.error(`stream test failed for ${e.platform}:${e.id}`, err); } catch {}
          console.log('Full error object:', err);
          const errorMsg = err?.response?.data || err?.message || err?.toString() || 'unknown error';
          (resultsBy[e.platform] || resultsBy.youtube).push(`${e.platform}:${e.id} failed: ${JSON.stringify(errorMsg)}`);
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

    if (sub === 'presence_set') {
      const platform = interaction.options.getString('platform', true);
      const channel = interaction.options.getChannel('channel', true);
      const whitelistRolesStr = interaction.options.getString('whitelist_roles', true);
      const liveRole = interaction.options.getRole('live_role');
      const liveRolesStr = interaction.options.getString('live_roles');
      const message = interaction.options.getString('message');
      const parseIds = (str) => (str || '').split(',').map(s => s.trim()).filter(Boolean).map(s => s.replace(/[^0-9]/g, '')).filter(Boolean);
      const whitelistRoleIds = parseIds(whitelistRolesStr);
      const liveRoleIds = Array.from(new Set([...(liveRole ? [liveRole.id] : []), ...parseIds(liveRolesStr)]));
      if (!whitelistRoleIds.length) return await interaction.editReply({ content: 'Provide at least one whitelist role.' });
      const registry = require('../modules/streamRegistry');
      const res = registry.setPresence(interaction.guild.id, platform, { channelId: channel.id, message: message || null, liveRoleIds, whitelistRoleIds });
      if (!res.ok) return await interaction.editReply({ content: 'Failed to set presence rule.' });
      return await interaction.editReply({ content: `Presence rule set for ${platform} -> <#${channel.id}> | whitelist: ${whitelistRolesStr}${liveRoleIds.length ? ` | roles: ${liveRoleIds.map(id => `<@&${id}>`).join(', ')}` : ''}` });
    }

    if (sub === 'presence_clear') {
      const platform = interaction.options.getString('platform');
      const registry = require('../modules/streamRegistry');
      registry.clearPresence(interaction.guild.id, platform || undefined);
      return await interaction.editReply({ content: platform ? `Cleared presence rule for ${platform}.` : 'Cleared all presence rules for this server.' });
    }

    if (sub === 'check_live_roles') {
      const filterPlatform = interaction.options.getString('platform') || 'all';
      const registry = require('../modules/streamRegistry');
      const presenceRules = registry.getPresence(interaction.guild.id);
      
      let assigned = 0;
      let checked = 0;
      const results = [];
      
      const platforms = filterPlatform === 'all' ? ['twitch', 'youtube', 'kick', 'rumble', 'tiktok', 'instagram', 'discord', 'facebook', 'x'] : [filterPlatform];
      
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
          
          if (isStreaming && rules.whitelistRoleIds?.some(r => member.roles.cache.has(r))) {
            checked++;
            let rolesAdded = 0;
            
            for (const rid of rules.liveRoleIds) {
              if (rid && !member.roles.cache.has(rid)) {
                try {
                  await member.roles.add(rid);
                  rolesAdded++;
                  assigned++;
                } catch {}
              }
            }
            
            if (rolesAdded > 0) {
              results.push(`${member.user.username} (${platform}) - added ${rolesAdded} role(s)`);
            }
          }
        }
      }
      
      const summary = `Checked ${checked} streaming users, assigned ${assigned} roles.`;
      const details = results.length > 0 ? '\n\n' + results.join('\n') : '';
      
      return await interaction.editReply({ content: summary + details });
    }
    } catch (error) {
      console.error('Error in stream command:', error);
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({
          content: '❌ An error occurred while processing this command.',
          flags: 64
        });
      } else {
        await interaction.reply({
          content: '❌ An error occurred while processing this command.',
          flags: 64,
          ephemeral: true
        });
      }
    }
  },

  async autocomplete(interaction) {
    const focusedOption = interaction.options.getFocused(true);
    if (focusedOption.name === 'id') {
      const platform = interaction.options.getString('platform');
      if (platform) {
        const registry = require('../modules/streamRegistry');
        const entries = registry.list(interaction.guild.id).filter(e => e.platform === platform);
        const choices = entries.map(e => ({ name: e.id, value: e.id })).slice(0, 25);
        await interaction.respond(choices);
      } else {
        await interaction.respond([]);
      }
    }
  },
};
