const fs = require('fs');
const path = require('path');
const urlFetcher = require('./urlFetcher');

const customDataPath = path.join(__dirname, '..', 'data', 'customCommands.json');
const globalDataPath = path.join(__dirname, '..', 'data', 'globalCommands.json');

let customDb = {};
let globalDb = {};

// In-memory cooldown tracking: { global: { [commandName]: { [userId]: lastUsedTs } }, [guildId]: { [commandName]: { [userId]: lastUsedTs } } }
const cooldowns = { global: {} };

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
      } catch (e) {
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
      } catch (e) {
        return `{urlfetch:${type}:${url}${path ? ':' + path : ''}}`;
      }
    }
  );

  // Known simple tokens mapping (case-insensitive)
  const tokens = ['touser','user','username','tag','id','channel','server','guild','user_id','userid','user_mention','mention'];

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
    } catch (e) {
      return m;
    }
  });

  result = result.replace(/\{urlfetchpick:(json|text):([^}]+)\}/gi, (m, type, rest) => {
    try {
      const enc = encodeURIComponent(rest.trim());
      return `{urlfetchpick:${type}:${enc}}`;
    } catch (e) {
      return m;
    }
  });

  return result;
}

function load() {
  try {
    if (fs.existsSync(customDataPath)) {
      const raw = fs.readFileSync(customDataPath, 'utf8');
      customDb = JSON.parse(raw || '{}');
      // Transform variables in custom commands
      for (const guildId in customDb) {
        for (const cmdName in customDb[guildId]) {
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
      globalDb = JSON.parse(raw || '{}');
      // Transform variables in global commands
      for (const cmdName in globalDb) {
        if (globalDb[cmdName].response) {
          globalDb[cmdName].response = transformDollarVars(globalDb[cmdName].response);
        }
      }
    } else {
      globalDb = {};
      saveGlobal();
    }
  } catch (err) {
    console.error('customCommands: failed to load data files', err);
    customDb = {};
    globalDb = {};
  }
}

function saveCustom() {
  try {
    fs.writeFileSync(customDataPath, JSON.stringify(customDb, null, 2), 'utf8');
  } catch (err) {
    console.error('customCommands: failed to save custom data file', err);
  }
}

function saveGlobal() {
  try {
    fs.writeFileSync(globalDataPath, JSON.stringify(globalDb, null, 2), 'utf8');
  } catch (err) {
    console.error('customCommands: failed to save global data file', err);
  }
}

function ensureGuild(guildId) {
  if (!customDb[guildId]) customDb[guildId] = {};
}

function addCommand(guildId, name, response, creatorId, isGlobal = false) {
  name = name.toLowerCase();
  
  if (isGlobal) {
    if (globalDb[name]) return false; // already exists
    globalDb[name] = { response, creatorId, createdAt: Date.now(), cooldown: 0, requiredPermission: null, allowedRoles: [] };
    saveGlobal();
  } else {
    ensureGuild(guildId);
    if (customDb[guildId][name]) return false; // already exists
    customDb[guildId][name] = { response, creatorId, createdAt: Date.now(), cooldown: 0, requiredPermission: null, allowedRoles: [] };
    saveCustom();
  }
  return true;
}

function removeCommand(guildId, name, isGlobal = false) {
  name = name.toLowerCase();
  
  if (isGlobal) {
    if (!globalDb[name]) return false;
    delete globalDb[name];
    saveGlobal();
  } else {
    ensureGuild(guildId);
    if (!customDb[guildId][name]) return false;
    delete customDb[guildId][name];
    saveCustom();
  }
  return true;
}

function getCommand(guildId, name) {
  name = name.toLowerCase();
  
  // First check server-specific commands
  if (guildId) {
    ensureGuild(guildId);
    const serverCommand = customDb[guildId][name];
    if (serverCommand) return serverCommand;
  }
  
  // Then check global commands
  return globalDb[name] || null;
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
  return !!globalDb[name.toLowerCase()];
}

// Metadata setters
function setCooldown(guildId, name, seconds, isGlobal = false) {
  name = name.toLowerCase();
  
  if (isGlobal) {
    const entry = globalDb[name];
    if (!entry) return false;
    entry.cooldown = Number(seconds) || 0;
    saveGlobal();
  } else {
    ensureGuild(guildId);
    const entry = customDb[guildId][name];
    if (!entry) return false;
    entry.cooldown = Number(seconds) || 0;
    saveCustom();
  }
  return true;
}

function setPermission(guildId, name, permissionName, isGlobal = false) {
  name = name.toLowerCase();
  
  if (isGlobal) {
    const entry = globalDb[name];
    if (!entry) return false;
    entry.requiredPermission = permissionName || null;
    saveGlobal();
  } else {
    ensureGuild(guildId);
    const entry = customDb[guildId][name];
    if (!entry) return false;
    entry.requiredPermission = permissionName || null;
    saveCustom();
  }
  return true;
}

function setAllowedRoles(guildId, name, roleIds, isGlobal = false) {
  name = name.toLowerCase();
  
  if (isGlobal) {
    const entry = globalDb[name];
    if (!entry) return false;
    entry.allowedRoles = Array.isArray(roleIds) ? roleIds : [];
    saveGlobal();
  } else {
    ensureGuild(guildId);
    const entry = customDb[guildId][name];
    if (!entry) return false;
    entry.allowedRoles = Array.isArray(roleIds) ? roleIds : [];
    saveCustom();
  }
  return true;
}

// Cooldown helpers (in-memory)
function ensureCooldownObj(guildId, name, isGlobal = false) {
  const scope = isGlobal ? 'global' : guildId;
  if (!cooldowns[scope]) cooldowns[scope] = {};
  if (!cooldowns[scope][name]) cooldowns[scope][name] = {};
}

function getCooldownRemaining(guildId, name, userId) {
  const command = getCommand(guildId, name);
  if (!command || !command.cooldown || command.cooldown <= 0) return 0;
  
  const isGlobal = isGlobalCommand(name);
  const scope = isGlobal ? 'global' : guildId;
  
  ensureCooldownObj(guildId, name, isGlobal);
  const last = cooldowns[scope][name][userId] || 0;
  const now = Date.now();
  const diff = now - last;
  const remain = Math.ceil((command.cooldown * 1000 - diff) / 1000);
  return remain > 0 ? remain : 0;
}

function recordCommandUse(guildId, name, userId) {
  const isGlobal = isGlobalCommand(name);
  ensureCooldownObj(guildId, name, isGlobal);
  const scope = isGlobal ? 'global' : guildId;
  cooldowns[scope][name][userId] = Date.now();
}

async function processResponse(response, context) {
    const { platform, message, targetUser: tu, args = [] } = context;
    
    if (!response) return '';
    let resp = response;

    // Handle platform-specific user references
    if (platform === 'twitch') {
        // Twitch format (no @ mentions)
        resp = resp
            .replace(/{user}/g, message.username)
            .replace(/{username}/g, message.username)
            .replace(/{channel}/g, context.channel)
            .replace(/{touser:([^}]+)}/g, (m, def) => tu || def)
            .replace(/{touser}/g, tu || message.username)
            // Twitch-specific variables
            .replace(/{subscriber}/g, message.subscriber ? 'Yes' : 'No')
            .replace(/{mod}/g, message.mod ? 'Yes' : 'No')
            .replace(/{vip}/g, message.vip ? 'Yes' : 'No')
            .replace(/{badges}/g, Object.keys(message.badges || {}).join(','))
            .replace(/{color}/g, message.color || '')
            .replace(/{user-id}/g, message.userId || '')
            .replace(/{message-id}/g, message.id || '')
            .replace(/{months}/g, message.subscriberMonths || '0');
    } else {
        // Discord format (with proper mentions)
        resp = resp
            .replace(/<@\{id\}>/g, `<@${message.author.id}>`)
            .replace(/{user}/g, message.author.username)
            .replace(/{username}/g, message.author.username)
            .replace(/{channel}/g, `#${message.channel.name}`)
            .replace(/{server}/g, message.guild?.name || '')
            .replace(/{touser:([^}]+)}/g, (m, def) => tu ? tu.username : def)
            .replace(/{touser}/g, tu ? tu.username : message.author.username);
    }

    // Common replacements for both platforms
    resp = resp.replace(/{args}/g, args.join(' '));

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

            const [_, type, contentType, encodedUrl] = m;
            try {
                const url = decodeURIComponent(encodedUrl);
                
                if (type === 'urlfetchpick') {
                    const result = contentType === 'json' ? 
                        await urlFetcher.fetchJson(url) : 
                        await urlFetcher.fetchText(url);
                        
                    if (Array.isArray(result)) {
                        return result.length ? 
                            String(result[Math.floor(Math.random() * result.length)]) : '';
                    }
                    if (typeof result === 'string') {
                        const parts = result.split(/[;\n]/).map(s => s.trim()).filter(Boolean);
                        return parts.length ? 
                            parts[Math.floor(Math.random() * parts.length)] : '';
                    }
                    return String(result || '');
                } else {
                    const result = contentType === 'json' ? 
                        await urlFetcher.fetchJson(url) :
                        await urlFetcher.fetchText(url);
                    return String(result || '');
                }
            } catch (e) {
                console.warn('URL fetch error:', e.message, 'url:', encodedUrl);
                return '';
            }
        })
    ).then(parts => parts.join(''));

    return resp;
}

async function processCommand(command, context) {
    try {
        if (!command?.response) return null;

        // Check platform-specific permissions
        const { platform, message } = context;
        
        if (platform === 'twitch') {
            if (command.requiredPermission) {
                const perm = command.requiredPermission.toLowerCase();
                switch (perm) {
                    case 'administrator':
                    case 'manageguild':
                        if (!message.badges?.broadcaster && !message.mod) return null;
                        break;
                    case 'moderator':
                        if (!message.mod) return null;
                        break;
                    case 'vip':
                        if (!message.vip && !message.mod && !message.badges?.broadcaster) return null;
                        break;
                    case 'subscriber':
                        if (!message.subscriber && !message.mod && !message.badges?.broadcaster) return null;
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
    } catch (err) {
        console.error('Error processing command:', err);
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
    // Add the new function to exports
    processCommand
};
