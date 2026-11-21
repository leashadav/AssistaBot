const fs = require('fs');
const path = require('path');
const urlFetcher = require('./urlFetcher');
const { DEFAULT_TIMEZONE, getDateStringInTimezone } = require('../utils/timezone');

const customDataPath = path.join(__dirname, '..', 'data', 'customCommands.json');
const globalDataPath = path.join(__dirname, '..', 'data', 'globalCommands.json');
const timersDataPath = path.join(__dirname, '..', 'data', 'timers.json');
const brainScoresPath = path.join(__dirname, '..', 'data', 'brainScores.json');
const responsesPath = path.join(__dirname, '..', 'responses');

let customDb = {};
let globalDb = {};
let timersDb = {};
let brainScoresDb = {};

// In-memory cooldown tracking: { global: { [commandName]: { [userId]: lastUsedTs } }, [guildId]: { [commandName]: { [userId]: lastUsedTs } } }
const cooldowns = { global: {} };

function normalizeEntry(entry) {
  if (!entry || typeof entry !== 'object') return entry;
  const e = entry;
  if (e.aliases == null) e.aliases = [];
  if (!Array.isArray(e.aliases)) e.aliases = [String(e.aliases)];
  e.aliases = e.aliases
    .map(a => String(a).trim().toLowerCase())
    .filter(a => a && a.length);
  // Deduplicate
  e.aliases = Array.from(new Set(e.aliases));
  return e;
}

function resolveCommandKey(db, name) {
  const key = name.toLowerCase();
  if (db[key]) return { key, entry: db[key] };
  for (const k of Object.keys(db)) {
    const e = db[k];
    if (e && Array.isArray(e.aliases) && e.aliases.includes(key)) {
      return { key: k, entry: e };
    }
  }
  return { key: null, entry: null };
}

function transformDollarVars(text) {
  // Normalize various Nightbot/$(...) and ${...} and $name styles into the
  // internal {token} placeholder form used by the processor.
  if (!text || !text.includes('$')) return text;

  let result = text;

  // Handle $(urlfetchpick json|text URL [path]) and $(urlfetch json|text URL [path])
  // Encode URL and optional path so later parsing won't be broken by ':' in URLs.
  result = result.replace(/\$\(\s*urlfetchpick\s+(json|text)\s+([^\s)]+)(?:\s+([^)]+))?\s*\)/gi,
    (m, type, url, path) => {
      try {
        const encUrl = encodeURIComponent(url);
        const encPath = path ? encodeURIComponent(path) : null;
        return `{urlfetchpick:${type}:${encUrl}${encPath ? ':' + encPath : ''}}`;
      } catch (error) {
        return `{urlfetchpick:${type}:${url}${path ? ':' + path : ''}}`;
      }
    }
  );

  result = result.replace(/\$\(\s*urlfetch\s+(json|text)\s+([^\s)]+)(?:\s+([^)]+))?\s*\)/gi,
    (m, type, url, path) => {
      try {
        const encUrl = encodeURIComponent(url);
        const encPath = path ? encodeURIComponent(path) : null;
        return `{urlfetch:${type}:${encUrl}${encPath ? ':' + encPath : ''}}`;
      } catch (error) {
        return `{urlfetch:${type}:${url}${path ? ':' + path : ''}}`;
      }
    }
  );

  // Known simple tokens mapping (case-insensitive)
  const tokens = ['touser','todisplayname','displayname','user','username','tag','id','channel','server','guild','user_id','userid','user_mention','mention','uptime'];

  // ${token} -> {token}
  result = result.replace(/\$\{\s*([a-zA-Z0-9_]+)\s*\}/g, (m, tk) => {
    const key = tk.toLowerCase();
    return tokens.includes(key) ? `{${key}}` : m;
  });

  // $token -> {token} (only for known tokens, ensure word-boundary)
  result = result.replace(/\$([a-zA-Z0-9_]+)\b/g, (m, tk) => {
    const key = tk.toLowerCase();
    return tokens.includes(key) ? `{${key}}` : m;
  });

  // $(token) fallback -> {token}
  result = result.replace(/\$\(\s*([a-zA-Z0-9_]+)\s*\)/g, (m, tk) => {
    const key = tk.toLowerCase();
    return tokens.includes(key) ? `{${key}}` : m;
  });

  // Also handle existing {urlfetch:TYPE:rawUrl[:path]} and {urlfetchpick:TYPE:rawUrl[:path]}
  // Encode the URL and optional path so later parsing works (message processor
  // expects encoded url parts with no ':' characters).
  result = result.replace(/\{urlfetch:(json|text):([^}]+)\}/gi, (m, type, rest) => {
    try {
      // If the rest contains a ':' that isn't part of the protocol (e.g. 'http:'),
      // it's ambiguous. We'll assume the whole rest is the URL (common case).
      const enc = encodeURIComponent(rest.trim());
      return `{urlfetch:${type}:${enc}}`;
    } catch (error) {
      return m;
    }
  });

  result = result.replace(/\{urlfetchpick:(json|text):([^}]+)\}/gi, (m, type, rest) => {
    try {
      const enc = encodeURIComponent(rest.trim());
      return `{urlfetchpick:${type}:${enc}}`;
    } catch (error) {
      return m;
    }
  });

  return result;
}

function load() {
  try {
    if (fs.existsSync(customDataPath)) {
      const raw = fs.readFileSync(customDataPath, 'utf8');
      // Remove BOM if present
      const cleanRaw = raw.replace(/^\uFEFF/, '');
      customDb = JSON.parse(cleanRaw || '{}');
      // Normalize and transform variables in custom commands
      for (const guildId in customDb) {
        for (const cmdName in customDb[guildId]) {
          const entry = customDb[guildId][cmdName];
          customDb[guildId][cmdName] = normalizeEntry(entry);
          if (customDb[guildId][cmdName].response) {
            customDb[guildId][cmdName].response = transformDollarVars(customDb[guildId][cmdName].response);
          }
        }
      }
    } else {
      customDb = {};
      saveCustom();
    }

    if (fs.existsSync(globalDataPath)) {
      const raw = fs.readFileSync(globalDataPath, 'utf8');
      // Remove BOM if present
      const cleanRaw = raw.replace(/^\uFEFF/, '');
      globalDb = JSON.parse(cleanRaw || '{}');
      // Normalize and transform variables in global commands
      for (const cmdName in globalDb) {
        globalDb[cmdName] = normalizeEntry(globalDb[cmdName]);
        if (globalDb[cmdName].response) {
          globalDb[cmdName].response = transformDollarVars(globalDb[cmdName].response);
        }
      }
    } else {
      globalDb = {};
      saveGlobal();
    }

    // Load timers data for sponsor command integration
    if (fs.existsSync(timersDataPath)) {
      const raw = fs.readFileSync(timersDataPath, 'utf8');
      // Remove BOM if present
      const cleanRaw = raw.replace(/^\uFEFF/, '');
      timersDb = JSON.parse(cleanRaw || '{}');
    } else {
      timersDb = {};
    }

    // Load brain scores data
    if (fs.existsSync(brainScoresPath)) {
      const raw = fs.readFileSync(brainScoresPath, 'utf8');
      // Remove BOM if present
      const cleanRaw = raw.replace(/^\uFEFF/, '');
      brainScoresDb = JSON.parse(cleanRaw || '{}');
    } else {
      brainScoresDb = {};
    }
  } catch (error) {
    console.error('customCommands: failed to load data files', error);
    customDb = {};
    globalDb = {};
    timersDb = {};
    brainScoresDb = {};
  }
}

function saveCustom() {
  try {
    fs.writeFileSync(customDataPath, JSON.stringify(customDb, null, 2), 'utf8');
  } catch (error) {
    console.error('customCommands: failed to save custom data file', error);
  }
}

function saveGlobal() {
  try {
    fs.writeFileSync(globalDataPath, JSON.stringify(globalDb, null, 2), 'utf8');
  } catch (error) {
    console.error('customCommands: failed to save global data file', error);
  }
}

function saveBrainScores() {
  try {
    fs.writeFileSync(brainScoresPath, JSON.stringify(brainScoresDb, null, 2), 'utf8');
  } catch (error) {
    console.error('customCommands: failed to save brain scores data file', error);
  }
}

function ensureGuild(guildId) {
  if (!customDb[guildId]) {
    customDb[guildId] = {};
  }
}

function addCommand(guildId, name, response, creatorId, isGlobal = false) {
  // Allow pipe-delimited aliases: "hug|hugs|hugged"
  const parts = String(name).split('|').map(s => s.trim()).filter(Boolean);
  const primary = parts.shift().toLowerCase();
  const aliases = parts.map(s => s.toLowerCase());

  const now = Date.now();
  const base = normalizeEntry({ response, creatorId, createdAt: now, cooldown: 0, requiredPermission: null, allowedRoles: [], aliases });

  if (isGlobal) {
    // Prevent duplicates across primary or aliases
    const existing = resolveCommandKey(globalDb, primary);
    if (existing.entry) return false;
    for (const a of aliases) {
      if (resolveCommandKey(globalDb, a).entry) return false;
    }
    globalDb[primary] = base;
    saveGlobal();
  } else {
    ensureGuild(guildId);
    const guildDb = customDb[guildId];
    const existing = resolveCommandKey(guildDb, primary);
    if (existing.entry) return false;
    for (const a of aliases) {
      if (resolveCommandKey(guildDb, a).entry) return false;
    }
    guildDb[primary] = base;
    saveCustom();
  }
  return true;
}

function removeCommand(guildId, name, isGlobal = false) {
  const keyName = String(name).toLowerCase();

  if (isGlobal) {
    const { key } = resolveCommandKey(globalDb, keyName);
    if (!key) return false;
    delete globalDb[key];
    saveGlobal();
  } else {
    ensureGuild(guildId);
    const guildDb = customDb[guildId];
    const { key } = resolveCommandKey(guildDb, keyName);
    if (!key) return false;
    delete guildDb[key];
    saveCustom();
  }
  return true;
}

function getCommand(guildId, name) {
  const q = String(name).toLowerCase();

  // First check server-specific commands
  if (guildId) {
    ensureGuild(guildId);
    const { entry } = resolveCommandKey(customDb[guildId], q);
    if (entry) return entry;
  }
  // Then check global commands
  const { entry } = resolveCommandKey(globalDb, q);
  return entry || null;
}

function listCommands(guildId) {
  const globalCommands = Object.keys(globalDb);
  if (!guildId) return globalCommands;
  
  ensureGuild(guildId);
  const serverCommands = Object.keys(customDb[guildId] || {});
  
  // Return unique combination of both (server commands override global)
  return [...new Set([...serverCommands, ...globalCommands])];
}

function isGlobalCommand(name) {
  const { entry } = resolveCommandKey(globalDb, String(name).toLowerCase());
  return !!entry;
}

// Metadata setters
function setCooldown(guildId, name, seconds, isGlobal = false) {
  const q = String(name).toLowerCase();

  if (isGlobal) {
    const { entry } = resolveCommandKey(globalDb, q);
    if (!entry) return false;
    entry.cooldown = Number(seconds) || 0;
    saveGlobal();
  } else {
    ensureGuild(guildId);
    const { entry } = resolveCommandKey(customDb[guildId], q);
    if (!entry) return false;
    entry.cooldown = Number(seconds) || 0;
    saveCustom();
  }
  return true;
}

function setPermission(guildId, name, permissionName, isGlobal = false) {
  const q = String(name).toLowerCase();

  if (isGlobal) {
    const { entry } = resolveCommandKey(globalDb, q);
    if (!entry) return false;
    entry.requiredPermission = permissionName || null;
    saveGlobal();
  } else {
    ensureGuild(guildId);
    const { entry } = resolveCommandKey(customDb[guildId], q);
    if (!entry) return false;
    entry.requiredPermission = permissionName || null;
    saveCustom();
  }
  return true;
}

function setAllowedRoles(guildId, name, roleIds, isGlobal = false) {
  const q = String(name).toLowerCase();

  if (isGlobal) {
    const { entry } = resolveCommandKey(globalDb, q);
    if (!entry) return false;
    entry.allowedRoles = Array.isArray(roleIds) ? roleIds : [];
    saveGlobal();
  } else {
    ensureGuild(guildId);
    const { entry } = resolveCommandKey(customDb[guildId], q);
    if (!entry) return false;
    entry.allowedRoles = Array.isArray(roleIds) ? roleIds : [];
    saveCustom();
  }
  return true;
}

// Cooldown helpers (in-memory)
function ensureCooldownObj(guildId, name, isGlobal = false) {
  const scope = isGlobal ? 'global' : guildId;
  if (!cooldowns[scope]) {
    cooldowns[scope] = {};
  }
  if (!cooldowns[scope][name]) {
    cooldowns[scope][name] = {};
  }
}

function getCooldownRemaining(guildId, name, userId) {
  const q = String(name).toLowerCase();

  // Determine canonical key and command
  let isGlob = false;
  let key = null;
  let cmd = null;

  if (guildId) {
    ensureGuild(guildId);
    const r = resolveCommandKey(customDb[guildId], q);
    if (r.entry) { key = r.key; cmd = r.entry; }
  }
  if (!cmd) {
    const r2 = resolveCommandKey(globalDb, q);
    if (r2.entry) { key = r2.key; cmd = r2.entry; isGlob = true; }
  }

  if (!cmd || !cmd.cooldown || cmd.cooldown <= 0) return 0;

  const scope = isGlob ? 'global' : guildId;
  ensureCooldownObj(guildId, key, isGlob);
  const last = cooldowns[scope][key][userId] || 0;
  const now = Date.now();
  const diff = now - last;
  const remain = Math.ceil((cmd.cooldown * 1000 - diff) / 1000);
  return remain > 0 ? remain : 0;
}

function recordCommandUse(guildId, name, userId) {
  const q = String(name).toLowerCase();

  // Resolve canonical key
  let isGlob = false;
  let key = null;
  if (guildId) {
    ensureGuild(guildId);
    const r = resolveCommandKey(customDb[guildId], q);
    if (r.entry) key = r.key;
  }
  if (!key) {
    const r2 = resolveCommandKey(globalDb, q);
    if (r2.entry) { key = r2.key; isGlob = true; }
  }
  if (!key) return;

  ensureCooldownObj(guildId, key, isGlob);
  const scope = isGlob ? 'global' : guildId;
  cooldowns[scope][key][userId] = Date.now();
}

async function processResponse(response, context) {
  const { platform, message, targetUser, args = [] } = context;
  
  if (!response) return '';
  let resp = response;

  // First, resolve {query} and (query) using first arg (default 6)
  const arg0 = args?.[0] || null;
  let queryVal = parseInt(String(arg0 || '').replace(/[^0-9-]/g, ''), 10);
  if (!Number.isFinite(queryVal) || queryVal <= 0) queryVal = 6;
  resp = resp.replace(/\{\s*query\s*\}/gi, String(queryVal))
             .replace(/\(\s*query\s*\)/gi, String(queryVal));

  // Handle platform-specific user references
  if (platform === 'twitch') {
    // Twitch format (no @ mentions)
    const displayName = message['display-name'] || message.username;
    resp = resp
      .replace(/{user}/g, displayName)
      .replace(/{username}/g, message.username)
      .replace(/{displayname}/gi, displayName)
      .replace(/{channel}/g, context.channel)
      .replace(/{touser:([^}]+)}/g, (m, def) => targetUser || def)
      .replace(/{touser}/g, targetUser || message.username)
      // Twitch-specific variables
      .replace(/{subscriber}/g, message.subscriber ? 'Yes' : 'No')
      .replace(/{mod}/g, message.mod ? 'Yes' : 'No')
      .replace(/{vip}/g, message.vip ? 'Yes' : 'No')
      .replace(/{badges}/g, Object.keys(message.badges || {}).join(','))
      .replace(/{color}/g, message.color || '')
      .replace(/{user-id}/g, message.userId || '')
      .replace(/{message-id}/g, message.id || '')
      .replace(/{months}/g, message.subscriberMonths || '0');

    // Resolve target profile details when requested.
    if (resp.includes('{game}') || resp.includes('{todisplayname}')) {
      const login = (targetUser || message.username || '').toLowerCase();
      let userInfo = null;
      try {
        if (login) {
          userInfo = await require('./twitchShoutouts').getUserInfo(login);
        }
      } catch (error) {
        console.error('[Twitch] Failed to resolve shoutout target:', error?.message || error);
      }

      const activity = userInfo?.game_name || userInfo?.title || 'Unknown';
      const targetDisplayName = userInfo?.display_name || userInfo?.displayName ||
        (login === String(message.username || '').toLowerCase() ? displayName : targetUser || 'Unknown');
      resp = resp
        .replace(/\{game\}/g, activity)
        .replace(/\{todisplayname\}/gi, targetDisplayName);
    }

    // Resolve Twitch sub count if requested
    if (resp.includes('{subcount}')) {
      try {
        const twitchConfig = require('./configLoader').twitch;
        const broadcasterId = twitchConfig.twitch_channel_id;
        const broadcasterToken = twitchConfig.twitch_broadcaster_oauth;
        const clientId = twitchConfig.twitch_client_id;
        if (broadcasterId && broadcasterToken && clientId) {
          const axios = require('axios');
          const subResp = await axios.get('https://api.twitch.tv/helix/subscriptions', {
            headers: {
              'Client-ID': clientId,
              'Authorization': `Bearer ${broadcasterToken}`
            },
            params: { broadcaster_id: broadcasterId }
          });
          const total = subResp.data?.total ?? '?';
          resp = resp.replace(/\{subcount\}/g, String(total));
        } else {
          resp = resp.replace(/\{subcount\}/g, '?');
        }
      } catch {
        resp = resp.replace(/\{subcount\}/g, '?');
      }
    }

    // Resolve Twitch uptime if requested
    if (resp.includes('{uptime}')) {
      try {
        const login = (context.channel || message.username || '').toLowerCase();
        // Try IVR.fi API first (no rate limits)
        const ivr = await urlFetcher.fetchJson(`https://api.ivr.fi/v2/twitch/user?login=${encodeURIComponent(login)}`);
        const user = Array.isArray(ivr) && ivr.length ? ivr[0] : null;
        
        if (user?.stream?.startedAt) {
          const startTime = new Date(user.stream.startedAt);
          const now = new Date();
          const diffMs = now - startTime;
          const hours = Math.floor(diffMs / (1000 * 60 * 60));
          const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
          const uptimeText = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
          resp = resp.replace(/\{uptime\}/g, uptimeText);
        } else {
          resp = resp.replace(/\{uptime\}/g, 'Stream is offline');
        }
      } catch {
        resp = resp.replace(/\{uptime\}/g, 'Stream is offline');
      }
    }
  } else {
    // Discord format (with proper mentions)
    resp = resp
      .replace(/<@\{id\}>/g, `<@${message.author.id}>`)
      .replace(/{user}/g, message.author.username)
      .replace(/{username}/g, message.author.username)
      .replace(/{channel}/g, `#${message.channel.name}`)
      .replace(/{server}/g, message.guild?.name || '')
      .replace(/{touser:([^}]+)}/g, (m, def) => targetUser ? targetUser.username : def)
      .replace(/{touser}/g, targetUser ? targetUser.username : message.author.username);
  }

  // Common replacements for both platforms
  resp = resp.replace(/{args}/g, args.join(' '));

  // Handle {randpick:opt1,opt2,...} - pick a random option
  resp = resp.replace(/\{randpick:([^}]+)\}/g, (m, options) => {
    const choices = options.split(',').map(s => s.trim()).filter(Boolean);
    return choices.length ? choices[Math.floor(Math.random() * choices.length)] : m;
  });

  // Handle {eval:...} expressions (safe subset: Math operations only)
  resp = resp.replace(/\{eval:([^}]+)\}/g, (m, expr) => {
    try {
      const result = Function('Math', `"use strict"; return (${expr})`)(Math);
      return String(result);
    } catch {
      return m;
    }
  });

  // Handle random numbers
  resp = resp.replace(/\{rand:(-?\d+)[-,: ]+(-?\d+)\}/g, (m, a, b) => {
    const min = Number(a);
    const max = Number(b);
    if (Number.isNaN(min) || Number.isNaN(max)) return '';
    const lo = Math.min(min, max);
    const hi = Math.max(min, max);
    return String(Math.floor(Math.random() * (hi - lo + 1)) + lo);
  });

  // Basic random (0-100)
  resp = resp.replace(/\{random\}|\{rand\}/g, () => Math.floor(Math.random() * 101));

  // Math.random float
  resp = resp.replace(/\{\s*(?:Math|math)\.random\s*\(\s*\)\s*\}|\{\s*Math\.random\s*\}/g, () => Math.random());

  // Process URLs
  resp = await Promise.all(
    resp.split(/(\{(?:urlfetch|urlfetchpick):[^}]+\})/).map(async part => {
      let m = part.match(/^\{(urlfetch|urlfetchpick):(json|text):(.+)\}$/);
      if (!m) return part;

      const [, type, contentType, encodedUrl] = m;
      try {
        let url = decodeURIComponent(encodedUrl);

        // Perform placeholder substitution inside the URL prior to fetching
        if (platform === 'twitch') {
          url = url
            // Brace-style placeholders
            .replace(/\{user\}/g, message.username)
            .replace(/\{username\}/g, message.username)
            .replace(/\{channel\}/g, context.channel)
            .replace(/\{touser:([^}]+)\}/g, (mm, def) => targetUser || def)
            .replace(/\{touser\}/g, targetUser || message.username)
            // Nightbot-style placeholders
            .replace(/\$\(\s*user\s*\)/gi, message.username)
            .replace(/\$\(\s*username\s*\)/gi, message.username)
            .replace(/\$\(\s*channel\s*\)/gi, context.channel)
            .replace(/\$\(\s*touser(?:\s+([^)]*))?\s*\)/gi, (mm, def) => targetUser || (def ? def.trim() : message.username));
        } else {
          url = url
            .replace(/<@\{id\}>/g, `<@${message.author.id}>`)
            .replace(/\{user\}/g, message.author.username)
            .replace(/\{username\}/g, message.author.username)
            .replace(/\{channel\}/g, `#${message.channel.name}`)
            .replace(/\{server\}/g, message.guild?.name || '')
            .replace(/\{touser:([^}]+)\}/g, (mm, def) => targetUser ? targetUser.username : def)
            .replace(/\{touser\}/g, targetUser ? targetUser.username : message.author.username)
            // Nightbot-style placeholders
            .replace(/\$\(\s*user\s*\)/gi, message.author.username)
            .replace(/\$\(\s*username\s*\)/gi, message.author.username)
            .replace(/\$\(\s*channel\s*\)/gi, `#${message.channel.name}`)
            .replace(/\$\(\s*touser(?:\s+([^)]*))?\s*\)/gi, (mm, def) => targetUser ? targetUser.username : (def ? def.trim() : message.author.username));
        }

        // Common replacements that may appear in URLs
        url = url.replace(/\{args\}/g, args.join(' '))
                 .replace(/\$\(\s*args\s*\)/gi, args.join(' '));

        // Decode URL if it's encoded
        try {
          url = decodeURIComponent(url);
        } catch (e) {
          // If decoding fails, use as-is
        }

        // Check if URL is a local file path (no protocol)
        const isLocalFile = !url.match(/^https?:\/\//i);
        
        if (type === 'urlfetchpick') {
          let result;
          if (isLocalFile) {
            // Handle local file
            // Remove 'responses/' prefix if present to avoid double path
            const cleanUrl = url.replace(/^responses[\/\\]/, '');
            const filePath = path.join(responsesPath, cleanUrl);
            try {
              const content = fs.readFileSync(filePath, 'utf8');
              result = content;
            } catch (error) {
              console.warn('Local file fetch error:', error?.message || String(error), 'path:', filePath);
              return '';
            }
          } else {
            // Handle HTTP URL
            result = contentType === 'json' 
              ? await urlFetcher.fetchJson(url) 
              : await urlFetcher.fetchText(url);
          }

          if (Array.isArray(result)) {
            return result.length ? String(result[Math.floor(Math.random() * result.length)]) : '';
          }
          if (typeof result === 'string') {
            const parts = result.split(/[;\n]/).map(s => s.trim()).filter(Boolean);
            return parts.length ? parts[Math.floor(Math.random() * parts.length)] : '';
          }
          return String(result || '');
        } else {
          let result;
          if (isLocalFile) {
            // Handle local file
            // Remove 'responses/' prefix if present to avoid double path
            const cleanUrl = url.replace(/^responses[\/\\]/, '');
            const filePath = path.join(responsesPath, cleanUrl);
            try {
              const content = fs.readFileSync(filePath, 'utf8');
              result = content;
            } catch (error) {
              console.warn('Local file fetch error:', error?.message || String(error), 'path:', filePath);
              return '';
            }
          } else {
            // Handle HTTP URL
            result = contentType === 'json' 
              ? await urlFetcher.fetchJson(url)
              : await urlFetcher.fetchText(url);
          }
          return String(result || '');
        }
      } catch (error) {
        console.warn('URL fetch error:', error?.message || String(error), 'url:', encodedUrl);
        return '';
      }
    })
  ).then(parts => parts.join(''));

  return resp;
}

async function getSponsorMessage() {
  try {
    const twitchTimers = require('./twitchTimers');
    const currentGame = await twitchTimers.getCurrentStreamGame();
    if (!currentGame) return null;

    loadTimersData();
    for (const timers of Object.values(timersDb)) {
      for (const [timerName, timer] of Object.entries(timers)) {
        if (timer.enabled && Array.isArray(timer.gameFilter) && timer.message) {
          const matches = timer.gameFilter.some(g =>
            currentGame.toLowerCase().includes(g.toLowerCase()) ||
            g.toLowerCase().includes(currentGame.toLowerCase())
          );
          if (matches) {
            return timer.message;
          }
        }
      }
    }
    return null;
  } catch (error) {
    console.error('Error getting sponsor message:', error);
    return null;
  }
}

function loadTimersData() {
  try {
    if (fs.existsSync(timersDataPath)) {
      const raw = fs.readFileSync(timersDataPath, 'utf8');
      timersDb = JSON.parse(raw || '{}');
    } else {
      timersDb = {};
    }
  } catch (error) {
    console.error('Error loading timers data:', error);
    timersDb = {};
  }
}

// Brain score tracking functions
function getTodayKey() {
  return getDateStringInTimezone(new Date(), DEFAULT_TIMEZONE);
}

function ensureBrainGuild(guildId) {
  if (!brainScoresDb[guildId]) {
    brainScoresDb[guildId] = {
      scores: {},
      brainRole: null,
      currentHolder: null
    };
  }
}

function recordBrainScore(guildId, userId, score) {
  ensureBrainGuild(guildId);
  const today = getTodayKey();
  
  if (!brainScoresDb[guildId].scores[today]) {
    brainScoresDb[guildId].scores[today] = {};
  }
  
  if (!brainScoresDb[guildId].scores[today][userId]) {
    brainScoresDb[guildId].scores[today][userId] = score;
  } else {
    // Keep the highest score for this user today
    brainScoresDb[guildId].scores[today][userId] = Math.max(
      brainScoresDb[guildId].scores[today][userId],
      score
    );
  }
  
  saveBrainScores();
}

function getDailyHighestScore(guildId) {
  ensureBrainGuild(guildId);
  const today = getTodayKey();
  const todayScores = brainScoresDb[guildId].scores[today] || {};
  
  let highestScore = -1;
  let highestUser = null;
  
  for (const [userId, score] of Object.entries(todayScores)) {
    if (score > highestScore) {
      highestScore = score;
      highestUser = userId;
    }
  }
  
  return { userId: highestUser, score: highestScore };
}

function setBrainRole(guildId, roleId) {
  ensureBrainGuild(guildId);
  brainScoresDb[guildId].brainRole = roleId;
  saveBrainScores();
}

function getBrainRole(guildId) {
  ensureBrainGuild(guildId);
  return brainScoresDb[guildId].brainRole;
}

function resetDailyScores(guildId) {
  ensureBrainGuild(guildId);
  // Clear all past scores to prevent file growth, keep only settings
  brainScoresDb[guildId].scores = {};
  brainScoresDb[guildId].currentHolder = null;
  saveBrainScores();
}

async function updateBrainRoleHolder(guildId, client) {
  ensureBrainGuild(guildId);
  const brainRoleId = brainScoresDb[guildId].brainRole;
  
  if (!brainRoleId) return;
  
  const { userId: highestUser, score } = getDailyHighestScore(guildId);
  const currentHolder = brainScoresDb[guildId].currentHolder;
  
  // If no one has used brain today, don't change anything
  if (!highestUser) return;
  
  // If the highest user is already the current holder, no change needed
  if (currentHolder === highestUser) return;
  
  try {
    const guild = await client.guilds.fetch(guildId);
    
    // Remove role from previous holder
    if (currentHolder) {
      const member = await guild.members.fetch(currentHolder).catch(() => null);
      if (member && member.roles.cache.has(brainRoleId)) {
        await member.roles.remove(brainRoleId, 'No longer has highest brain score today');
      }
    }
    
    // Add role to new highest scorer
    const newMember = await guild.members.fetch(highestUser).catch(() => null);
    if (newMember) {
      await newMember.roles.add(brainRoleId, 'Has the highest brain score today');
      brainScoresDb[guildId].currentHolder = highestUser;
      saveBrainScores();
      try {
        const guildSettings = require('./guildSettings');
        const brainCfg = guildSettings.getSettings(guildId).brain || {};
        const announceChannelId = brainCfg.channelId;
        const announceMessage = brainCfg.message;

        if (announceChannelId && announceMessage) {
          const channel = await guild.channels.fetch(announceChannelId).catch(() => null);
          if (channel && typeof channel.send === 'function') {
            const text = String(announceMessage).replace(/\{USER\}/g, newMember.user.username);
            await channel.send(text).catch(() => null);
          }
        }
      } catch (err) {
        console.error('Error sending brain announcement:', err);
      }
    }
  } catch (error) {
    console.error('Error updating brain role holder:', error);
  }
}

async function processCommand(command, context, commandName = '') {
  try {
    if (!command?.response) return null;

    // Special handling for sponsor command - use timer message if game matches
    if (commandName === 'sponsor' || commandName === 'sponsors') {
      const timerMessage = await getSponsorMessage();
      if (timerMessage) {
        command = { ...command, response: timerMessage };
      }
    }

    // Special handling for brain command - track scores and update role
    if (commandName === 'brain' && context.platform === 'discord' && context.message?.guild) {
      const guildId = context.message.guild.id;
      const userId = context.message.author.id;
      
      // Extract the random number from the response
      const processedResponse = await processResponse(command.response, context);
      const numberMatch = processedResponse.match(/\b(\d{1,3})\b/);
      
      if (numberMatch) {
        const score = parseInt(numberMatch[1], 10);
        if (score >= 0 && score <= 100) {
          recordBrainScore(guildId, userId, score);
          
          // Update the brain role holder if a role is configured
          if (context.client) {
            await updateBrainRoleHolder(guildId, context.client);
          }
        }
      }
    }

    // Check platform-specific permissions
    const { platform, message } = context;
    
    if (platform === 'twitch') {
      if (command.requiredPermission) {
        const perm = command.requiredPermission.toLowerCase();
        const isBroadcaster = message.badges?.broadcaster === '1';
        const isMod = message.mod;

        switch (perm) {
          case 'administrator':
          case 'manageguild':
            if (!isBroadcaster && !isMod) return null;
            break;
          case 'moderator':
            if (!isMod) return null;
            break;
          case 'vip':
            if (!message.vip && !isMod && !isBroadcaster) return null;
            break;
          case 'subscriber':
            if (!message.subscriber && !isMod && !isBroadcaster) return null;
            break;
        }
      }
    } else {
      // Discord permission checking
      if (command.requiredPermission) {
        const permName = command.requiredPermission;
        const flag = context.PermissionsBitField?.Flags[permName];
        if (flag && !message.member?.permissions?.has(flag)) {
          return null;
        }
      }

      if (command.allowedRoles?.length > 0) {
        const hasRole = command.allowedRoles.some(rid => 
          message.member?.roles?.cache?.has(rid));
        if (!hasRole) return null;
      }
    }

    // Process the response template
    return await processResponse(command.response, context);
  } catch (error) {
    console.error('Error processing command:', error);
    return null;
  }
}

// initialize
load();

module.exports = {
  addCommand,
  removeCommand,
  getCommand,
  listCommands,
  isGlobalCommand,
  // Reload data from disk and re-apply transformations
  reload: load,
  setCooldown,
  setPermission,
  setAllowedRoles,
  getCooldownRemaining,
  recordCommandUse,
  processCommand,
  // Brain score tracking functions
  recordBrainScore,
  setBrainRole,
  getBrainRole,
  getDailyHighestScore,
  resetDailyScores,
  updateBrainRoleHolder,
  brainScoresDb
};