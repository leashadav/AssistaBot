const { PermissionsBitField } = require('discord.js');
const customCommands = require('../modules/customCommands');
const { ownerIDS } = require('../config.json');
const urlFetcher = require('../modules/urlFetcher');

// Handle any pending URL fetches that might time out - registered once at module level
process.on('unhandledRejection', error => {
  if (error.name === 'AbortError') {
    console.warn('URL fetch timed out');
  } else {
    console.error('Unhandled promise rejection:', error);
  }
});

// Convert $(...) style variables to {..} style used by the processor.
function transformDollarVars(text) {
  if (!text || !text.includes('$(')) return text;

  // Handle urlfetchpick and urlfetch patterns first
  text = text.replace(/\$\(urlfetchpick\s+(json|text)\s+([^\s)]+)(?:\s+([^)]+))?\)/g, (m, type, url, path) => {
    // encode url and path to avoid ':' inside URLs breaking the placeholder format
    try {
      const encUrl = encodeURIComponent(url);
      const encPath = path ? encodeURIComponent(path) : null;
      return `{urlfetchpick:${type}:${encUrl}${encPath ? ':' + encPath : ''}}`;
    } catch (e) {
      return `{urlfetchpick:${type}:${url}${path ? ':' + path : ''}}`;
    }
  });

  text = text.replace(/\$\(urlfetch\s+(json|text)\s+([^\s)]+)(?:\s+([^)]+))?\)/g, (m, type, url, path) => {
    // encode url and path to avoid ':' inside URLs breaking the placeholder format
    try {
      const encUrl = encodeURIComponent(url);
      const encPath = path ? encodeURIComponent(path) : null;
      return `{urlfetch:${type}:${encUrl}${encPath ? ':' + encPath : ''}}`;
    } catch (e) {
      return `{urlfetch:${type}:${url}${path ? ':' + path : ''}}`;
    }
  });
  
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '$' && text[i + 1] === '(') {
      // parse balanced parentheses
      let depth = 0;
      let j = i + 1; // points at '('
      let start = j + 1;
      j++; // move inside
      depth = 1;
      while (j < text.length && depth > 0) {
        if (text[j] === '(') depth++;
        else if (text[j] === ')') depth--;
        j++;
      }
      if (depth !== 0) {
        // unbalanced, append raw and move on
        out += ch;
        continue;
      }
      const inner = text.slice(start, j - 1).trim();
      // parse token and rest
      const m = inner.match(/^([^\s()]+)(?:\s+([\s\S]+))?$/);
      if (!m) {
        out += text.slice(i, j);
        i = j - 1;
        continue;
      }
      const token = m[1].toLowerCase();
      const rest = m[2] ? m[2].trim() : null;
      let replacement = null;
      switch (token) {
        case 'touser':
        case 'user':
        case 'username':
        case 'tag':
        case 'id':
          // map to corresponding {touser} or {user}
          if (token === 'touser') replacement = '{touser}';
          else if (token === 'user') replacement = '{user}';
          else if (token === 'username') replacement = '{username}';
          else if (token === 'tag') replacement = '{tag}';
          else if (token === 'id') replacement = '{id}';
          break;
        case 'random':
        case 'rand':
          // rand without args -> random 0-100
          replacement = '{random}';
          // if args present like "1 6" we'll handle below
          if (rest) {
            const nums = rest.split(/[\s,]+/).map(s => s.trim()).filter(Boolean);
            if (nums.length >= 2 && /^-?\d+$/.test(nums[0]) && /^-?\d+$/.test(nums[1])) {
              replacement = `{rand:${nums[0]}-${nums[1]}}`;
            }
          }
          break;
        case 'randint':
        case 'randomint':
          if (rest) {
            const nums = rest.split(/[\s,]+/).map(s => s.trim()).filter(Boolean);
            if (nums.length >= 2 && /^-?\d+$/.test(nums[0]) && /^-?\d+$/.test(nums[1])) {
              replacement = `{rand:${nums[0]}-${nums[1]}}`;
            }
          }
          break;
        case 'channel':
          replacement = '{channel}';
          break;
        case 'server':
        case 'guild':
          replacement = '{server}';
          break;
        case 'user_id':
        case 'userid':
          replacement = '{id}';
          break;
        case 'user_mention':
        case 'mention':
          replacement = '{user}';
          break;
        case 'math.random':
        case 'math.random()':
          replacement = '{Math.random}';
          break;
        case 'math.floor':
        case 'floor':
          if (rest) replacement = `{Math.floor:${rest}}`;
          break;
        case 'eval':
          if (rest) replacement = `{eval:${rest}}`;
          break;
        default:
          // unknown token, keep as-is
          replacement = null;
      }
      if (replacement === null) {
        out += text.slice(i, j);
      } else {
        out += replacement;
      }
      i = j - 1;
    } else {
      out += ch;
    }
  }
  return out;
}

module.exports = {
  name: 'messageCreate',
  async execute(message, client) {
    if (message.author.bot) return;
    const content = message.content.trim();
    if (!content.startsWith('!')) return;

    const parts = content.slice(1).split(/\s+/);
    const cmd = parts.shift().toLowerCase();
    const args = parts;

    // Test URL fetching (owner only)
    if (cmd === 'testfetch') {
      try {
        const isOwner = Array.isArray(ownerIDS) && ownerIDS.includes(message.author.id);
        if (!isOwner) return message.reply('Only bot owners may use this command.');
        
        const url = args.join(' ').trim();
        if (!url) return message.reply('Usage: !testfetch <url>');
        
        console.log('Testing URL fetch for:', url);
        const result = await urlFetcher.fetchText(url);
        
        if (result === null) {
          return message.reply('Failed to fetch URL - check console for errors');
        }
        
        // Send the first 1900 chars (Discord limit) with proper formatting
        const preview = result.slice(0, 1900);
        return message.reply('```\n' + preview + (result.length > 1900 ? '\n... (truncated)' : '') + '\n```');
      } catch (e) {
        console.error('testfetch error:', e);
        return message.reply('Error: ' + e.message);
      }
    }

    // Owner-only: reload custom/global commands from disk (re-applies transforms)
    if (cmd === 'reloadcoms' || cmd === 'reloadcom') {
      try {
        const isOwner = Array.isArray(ownerIDS) && ownerIDS.includes(message.author.id);
        if (!isOwner) return message.reply('Only bot owners may run this command.');
        // reload command data
        if (customCommands && typeof customCommands.reload === 'function') {
          customCommands.reload();
          return message.reply('Custom/global commands reloaded from disk.');
        }
        return message.reply('Reload function not available.');
      } catch (e) {
        console.error('reloadcoms error:', e);
        return message.reply('Error while reloading commands.');
      }
    }

    // Admin commands to manage custom commands
    if (cmd === 'addcom' || cmd === 'addcommand') {
      // usage: !addcom name response...
      if (!message.guild) return;
      if (!message.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
        return message.reply('You do not have permission to add commands.');
      }
      const name = args.shift();
      if (!name) return message.reply('Usage: !addcom <name> <response>');
      const response = args.join(' ').trim();
      if (!response) return message.reply('Please provide a response for the command.');
      // Transform Nightbot-style $(...) syntax into internal {..} format when saving
      const savedResponse = transformDollarVars(response);
      const ok = customCommands.addCommand(message.guild.id, name, savedResponse, message.author.id);
      return message.reply(ok ? `Command \\!${name} added.` : `Command \\!${name} already exists.`);
    }

    if (cmd === 'delcom' || cmd === 'delcommand' || cmd === 'removecom') {
      if (!message.guild) return;
      if (!message.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
        return message.reply('You do not have permission to remove commands.');
      }
      const name = args.shift();
      if (!name) return message.reply('Usage: !delcom <name>');
      const ok = customCommands.removeCommand(message.guild.id, name);
      return message.reply(ok ? `Command \\!${name} removed.` : `Command \\!${name} not found.`);
    }

    if (cmd === 'coms' || cmd === 'commands') {
      if (!message.guild) return;
      const custom = customCommands.listCommands(message.guild.id);
      // built-in commands supported by the message handler
      const builtIns = ['addcom', 'delcom', 'setcom', 'cominfo', 'coms', 'commands'];
      // include alternate aliases
      const aliases = ['addcommand', 'delcommand', 'removecom'];
      const allBuilt = Array.from(new Set([...builtIns, ...aliases]));

      const parts = [];
      parts.push(`Built-in commands: ${allBuilt.map(c => `!${c}`).join(', ')}`);
      if (custom && custom.length) {
        parts.push(`Custom commands: ${custom.map(c => `!${c}`).join(', ')}`);
      } else {
        parts.push('Custom commands: (none)');
      }

      // If the list is long, send as a normal message to avoid hitting reply length limits
      return message.channel.send(parts.join('\n'));
    }

    // Admin: set command metadata
    if (cmd === 'setcom') {
      // Usage: !setcom <name> cooldown <seconds>
      //        !setcom <name> perm <PermissionName|null>
      //        !setcom <name> roles <roleId,roleId,...|none>
      if (!message.guild) return;
      if (!message.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
        return message.reply('You do not have permission to modify commands.');
      }
      const name = args.shift();
      if (!name) return message.reply('Usage: !setcom <name> <cooldown|perm|roles> <value>');
      const sub = args.shift();
      if (!sub) return message.reply('Specify which property to set: cooldown, perm, roles');
      const value = args.join(' ').trim();
      if (sub === 'cooldown') {
        const secs = Number(value);
        if (Number.isNaN(secs) || secs < 0) return message.reply('Provide a valid number of seconds (0 to disable).');
        const ok = customCommands.setCooldown(message.guild.id, name, secs);
        return message.reply(ok ? `Cooldown for !${name} set to ${secs}s` : `Command !${name} not found.`);
      }
      if (sub === 'perm') {
        // allow clearing with 'none' or 'null'
        const perm = (value.toLowerCase() === 'none' || value.toLowerCase() === 'null') ? null : value;
        const ok = customCommands.setPermission(message.guild.id, name, perm);
        return message.reply(ok ? `Permission for !${name} set to ${perm}` : `Command !${name} not found.`);
      }
      if (sub === 'roles') {
        if (!value) return message.reply('Provide comma-separated role IDs or mentions, or "none" to clear.');
        if (value.toLowerCase() === 'none') {
          const ok = customCommands.setAllowedRoles(message.guild.id, name, []);
          return message.reply(ok ? `Roles cleared for !${name}` : `Command !${name} not found.`);
        }
        const roleIds = value.split(/[,\s]+/).map(r => r.replace(/[<@&>]/g, '').trim()).filter(Boolean);
        const ok = customCommands.setAllowedRoles(message.guild.id, name, roleIds);
        return message.reply(ok ? `Allowed roles for !${name} set.` : `Command !${name} not found.`);
      }
      return message.reply('Unknown property. Use cooldown, perm, or roles.');
    }

    if (cmd === 'cominfo') {
      if (!message.guild) return;
      const name = args.shift();
      if (!name) return message.reply('Usage: !cominfo <name>');
      const entry = customCommands.getCommand(message.guild.id, name);
      if (!entry) return message.reply(`Command !${name} not found.`);
      const info = [];
      info.push(`Response: ${entry.response}`);
      info.push(`Created by: ${entry.creatorId || 'Unknown'}`);
      info.push(`Cooldown: ${entry.cooldown || 0}s`);
      info.push(`Required permission: ${entry.requiredPermission || 'None'}`);
      info.push(`Allowed roles: ${entry.allowedRoles && entry.allowedRoles.length ? entry.allowedRoles.join(', ') : 'None'}`);
      return message.reply(info.join('\n'));
    }

    // Check if command exists in custom commands
    if (!message.guild) return; // custom commands are guild-scoped
    const entry = customCommands.getCommand(message.guild.id, cmd);
    if (entry && entry.response) {
      // Permissions check
      if (entry.requiredPermission) {
        const permName = entry.requiredPermission;
        const flag = PermissionsBitField.Flags[permName];
        if (!flag) {
          // invalid permission configured; allow execution but warn in console
          console.warn(`customCommands: unknown permission config for !${cmd}: ${permName}`);
        } else if (!message.member.permissions.has(flag)) {
          return message.reply(`You need the \`${permName}\` permission to use this command.`);
        }
      }

      // Role check
      if (entry.allowedRoles && entry.allowedRoles.length) {
        const hasRole = entry.allowedRoles.some(rid => message.member.roles.cache.has(rid));
        if (!hasRole) return message.reply('You do not have a role required to use this command.');
      }

      // Cooldown check
      const remaining = customCommands.getCooldownRemaining(message.guild.id, cmd, message.author.id);
      if (remaining && remaining > 0) return message.reply(`Please wait ${remaining}s before using this command again.`);

      // Resolve a target user (first mention or first arg as id/mention/username)
      let targetUser = null;
      if (message.mentions && message.mentions.users && message.mentions.users.size) {
        targetUser = message.mentions.users.first();
      } else if (args && args.length && message.guild) {
        const raw = args[0].replace(/[<@!>]/g, '').trim();
        if (/^\d+$/.test(raw)) {
          try {
            const member = await message.guild.members.fetch(raw);
            if (member) targetUser = member.user;
          } catch (e) {
            // ignore
          }
        }
        if (!targetUser) {
          const found = message.guild.members.cache.find(m => m.user.username.toLowerCase() === args[0].toLowerCase() || m.user.tag.toLowerCase() === args[0].toLowerCase());
          if (found) targetUser = found.user;
        }
      }

  // Do NOT default {touser} to the invoker here — commands can opt-in to a default
  // (e.g. using {touser:everyone}). Leave targetUser null when no explicit target was provided.

      // basic placeholder replacements and simple variables
      const rawResponse = transformDollarVars(entry.response);
      let resp = rawResponse
        // {user} should not mention — return the invoker's username
        .replace(/{user}/g, message.author.username)
        .replace(/{username}/g, message.author.username)
        .replace(/{tag}/g, message.author.tag)
        .replace(/{id}/g, message.author.id)
        .replace(/{channel}/g, `<#${message.channel.id}>`)
        .replace(/{server}/g, message.guild.name)
        .replace(/{args}/g, args.join(' '));

      // Allow commands to mention the invoker with <@{id}> and keep {user} backwards-compatible
      const tu = targetUser;
      // Replace any literal <@{id}> placeholder with the invoker mention
      resp = resp.replace(/<@\{id\}>/g, `<@${message.author.id}>`)
        // {user} -> invoker's username (no mention)
        .replace(/{user}/g, message.author.username)
        .replace(/{username}/g, message.author.username)
        .replace(/{tag}/g, message.author.tag)
        .replace(/{id}/g, message.author.id)
        .replace(/{channel}/g, `<#${message.channel.id}>`)
        .replace(/{server}/g, message.guild.name)
        .replace(/{args}/g, args.join(' '));

      // {touser:DEFAULT} -> return target username if present, otherwise use DEFAULT text
      resp = resp.replace(/\{touser:([^}]+)\}/g, (m, def) => tu ? tu.username : def)
        // {touser} (no default) -> return target username if present, otherwise invoker username
        .replace(/\{touser\}/g, tu ? tu.username : message.author.username)
        .replace(/\{tousername\}/g, tu ? tu.username : message.author.username)
        .replace(/\{tousertag\}/g, tu ? tu.tag : message.author.tag)
        .replace(/\{touserid\}/g, tu ? tu.id : message.author.id);

      // {rand:min-max} or {rand:min,max} => random int in inclusive range
      resp = resp.replace(/\{rand:(-?\d+)[-,: ]+(-?\d+)\}/g, (m, a, b) => {
        const min = Number(a);
        const max = Number(b);
        if (Number.isNaN(min) || Number.isNaN(max)) return '';
        const lo = Math.min(min, max);
        const hi = Math.max(min, max);
        return String(Math.floor(Math.random() * (hi - lo + 1)) + lo);
      });

      // {random} or {rand} => 0-100 random
      resp = resp.replace(/\{random\}|\{rand\}/g, () => Math.floor(Math.random() * 101));

      // {Math.random} or {Math.random()} => 0-1 random float
      resp = resp.replace(/\{\s*(?:Math|math)\.random\s*\(\s*\)\s*\}|\{\s*Math\.random\s*\}/g, () => Math.random());

      // {math.floor:EXPR} or {Math.floor:EXPR} -> evaluate simple numeric expression (allows Math.random()) then floor
      resp = await resp.replace(/\{\s*(?:Math|math)\.floor:([^}]+)\s*\}/g, (m, expr) => {
        try {
          // replace Math.random() occurrences with numeric values
          const replaced = expr.replace(/Math\.random\s*\(\s*\)/gi, () => String(Math.random()));
          // allow only digits, operators, dots, parentheses, spaces and percent
          if (!/^[0-9+\-*/().%\s,]+$/.test(replaced)) return '';
          // evaluate the numeric expression
          // eslint-disable-next-line no-new-func
          const val = Function('return (' + replaced + ')')();
          return String(Math.floor(Number(val) || 0));
        } catch (e) {
          return '';
        }
      });

      // {urlfetch:type:url:path} -> fetch URL content
      resp = await Promise.all(
        resp.split(/(\{urlfetch:[^}]+\})/).map(async part => {
          // First try to match the full pattern with type
          let m = part.match(/^\{urlfetch:(json|text):(.+)\}$/);
          if (!m) {
            // If that doesn't match, try matching just {urlfetch:URL}
            m = part.match(/^\{urlfetch:(.+)\}$/);
            if (m) {
              // Restructure match array to make url the second group
              m = [m[0], null, m[1], null];
            }
          }
          if (!m) return part;

          const [_, type, url, path] = m;
          try {
            const decodedUrl = url ? decodeURIComponent(url) : '';

            if (type && type === 'json') {
              const result = await urlFetcher.fetchJson(decodedUrl, path);
              return result !== null ? String(result) : '';
            } else {
              const result = await urlFetcher.fetchText(decodedUrl);
              return result || '';
            }
          } catch (e) {
            console.warn('URL fetch error:', e && e.message ? e.message : String(e), 'url:', decodedUrl);
            return '';
          }
        })
      ).then(parts => parts.join(''));

      // {urlfetchpick:type:url:path} -> fetch URL content and return a random entry
      resp = await Promise.all(
        resp.split(/(\{urlfetchpick:[^}]+\})/).map(async part => {
          // First try to match the full pattern with type
          let m = part.match(/^\{urlfetchpick:(json|text):(.+)\}$/);
          if (!m) {
            // If that doesn't match, try matching just {urlfetchpick:URL}
            m = part.match(/^\{urlfetchpick:(.+)\}$/);
            if (m) {
              // Restructure match array to make url the second group
              m = [m[0], null, m[1], null];
            }
          }
          if (!m) return part;

          const [_, type, url, path] = m;
          try {

            if (type && type === 'json') {
              const result = await urlFetcher.fetchJson(url, path);
              if (result === null) return '';
              if (Array.isArray(result)) {
                if (!result.length) return '';
                return String(result[Math.floor(Math.random() * result.length)]);
              }
              if (typeof result === 'string') {
                const parts = result.split(/;|\r?\n/).map(s => s.trim()).filter(Boolean);
                if (!parts.length) return '';
                return parts[Math.floor(Math.random() * parts.length)];
              }
              return String(result);
            } else {
              const result = await urlFetcher.fetchText(url);
              if (!result) return '';
              const parts = result.split(/;|\r?\n/).map(s => s.trim()).filter(Boolean);
              if (!parts.length) return '';
              return parts[Math.floor(Math.random() * parts.length)];
            }
          } catch (e) {
            console.warn('URL fetch pick error:', e && e.message ? e.message : String(e), 'url:', encUrl);
            return '';
          }
        })
      ).then(parts => parts.join(''));

      // {eval:EXPR} - owner-only, evaluate with Math in scope
      resp = resp.replace(/\{\s*eval:([^}]+)\s*\}/g, (m, expr) => {
        try {
          const isOwner = Array.isArray(ownerIDS) && ownerIDS.includes(message.author.id);
          if (!isOwner) return '';
          const exprTrim = String(expr).trim();
          // If the expression contains multiple statements, return the value of the last expression.
          if (exprTrim.includes(';')) {
            const parts = exprTrim.split(';').map(s => s.trim()).filter(Boolean);
            if (parts.length === 0) return '';
            const last = parts.pop();
            const body = parts.join(';');
            const wrapped = (body ? (body + ';') : '') + 'return (' + last + ');';
            // eslint-disable-next-line no-new-func
            const fn = Function('Math', wrapped);
            const result = fn(Math);
            return String(result === undefined ? '' : result);
          } else {
            // single-expression: evaluate and return
            // eslint-disable-next-line no-new-func
            const fn = Function('Math', 'return (' + exprTrim + ')');
            const result = fn(Math);
            return String(result === undefined ? '' : result);
          }
        } catch (e) {
          return '';
        }
      });

      // record use for cooldown
      customCommands.recordCommandUse(message.guild.id, cmd, message.author.id);

      return message.channel.send(resp);
    }
  },
};