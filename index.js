const { Client, Collection, GatewayIntentBits, Partials } = require('discord.js');
const fs = require('fs');
const configLoader = require('./modules/configLoader');
const { token } = configLoader.config;
const DEBUG = /^(1|true)$/i.test(String(process.env.ASSISTABOT_DEBUG || ''));
const { sendLog } = require('./modules/logger');

if (!token) {
  console.error('❌ Missing Discord bot token in config (token).');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildExpressions,
    GatewayIntentBits.GuildIntegrations
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.User],
});

client.commands = new Collection();

// Load commands
try {
  const commandFiles = fs.existsSync('./commands')
    ? fs.readdirSync('./commands').filter(file => file.endsWith('.js'))
    : [];
  for (const file of commandFiles) {
    const command = require(`./commands/${file}`);
    if (command && command.data && command.data.name) {
      client.commands.set(command.data.name, command);
    } else {
      console.warn(`Skipping ${file}: missing data.name`);
    }
  }
  const cmds = Array.from(client.commands.keys());
  console.info({ event: 'commands_loaded', count: client.commands.size, ...(DEBUG ? { commands: cmds } : {}) });
} catch (e) {
  console.error('❌ Error loading commands:', e?.message || e);
}

// Load events
try {
  const eventFiles = fs.existsSync('./events')
    ? fs.readdirSync('./events').filter(file => file.endsWith('.js'))
    : [];
  const loadedEvents = [];
  for (const file of eventFiles) {
    const event = require(`./events/${file}`);
    if (!event || !event.name || typeof event.execute !== 'function') {
      console.warn(`Skipping event ${file}: invalid export`);
      continue;
    }
    loadedEvents.push(event.name);
    if (event.once) {
      client.once(event.name, (...args) => event.execute(...args, client));
    } else {
      client.on(event.name, (...args) => event.execute(...args, client));
    }
  }
  console.info({ event: 'events_loaded', count: loadedEvents.length, ...(DEBUG ? { events: loadedEvents } : {}) });
} catch (e) {
  console.error('Error loading events:', e?.message || e);
}

// Lightweight DEBUG-only listeners for additional visibility
if (DEBUG) {
  client.on('messageUpdate', (oldMessage, newMessage) => {
    console.info({
      event: 'message_update',
      oldId: oldMessage?.id,
      newId: newMessage?.id,
      oldPartial: !!(oldMessage && oldMessage.partial),
      newPartial: !!(newMessage && newMessage.partial),
      guild: newMessage?.guildId || oldMessage?.guildId,
      channel: newMessage?.channelId || oldMessage?.channelId
    });
  });

  client.on('guildCreate', (guild) => {
    console.info({ event: 'guild_create', guild: guild?.id, name: guild?.name });
  });

  client.on('guildDelete', (guild) => {
    console.info({ event: 'guild_delete', guild: guild?.id, name: guild?.name });
  });

  client.on('inviteCreate', (invite) => {
    console.info({
      event: 'invite_create',
      guild: invite?.guild?.id,
      code: invite?.code,
      inviter: invite?.inviter?.id
    });
  });

  client.on('inviteDelete', (invite) => {
    console.info({ event: 'invite_delete', guild: invite?.guild?.id, code: invite?.code });
  });
}

client.on('shardDisconnect', (closeEvent, shardId) => {
  const code = closeEvent && closeEvent.code;
  const base = `Shard ${shardId} disconnected${code ? ` (code ${code})` : ''}`;
  for (const [gid] of client.guilds.cache) {
    sendLog(client, gid, 'assistabotLogging', base).catch(() => {});
  }
});

process.on('unhandledRejection', (reason) => {
  const name = (reason && reason.name) || (reason && reason.constructor && reason.constructor.name);
  const message = reason && (reason.message || String(reason));
  const url = reason && reason.url;
  const operation = reason && (reason.operation || reason.op);
  const moduleName = reason && (reason.module || reason.source || reason.origin);

  const payload = { name, message };
  if (url) payload.url = url;
  if (operation) payload.operation = operation;
  if (moduleName) payload.module = moduleName;

  if (name === 'AbortError' || /aborted|timeout/i.test(message || '')) {
    console.warn('UnhandledRejection (timeout/abort)', payload);
  } else {
    console.error('UnhandledRejection', { ...payload, reason });
  }
});

process.on('uncaughtException', (error) => {
  const name = (error && error.name) || (error && error.constructor && error.constructor.name);
  const url = error && error.url;
  const operation = error && (error.operation || error.op);
  const moduleName = error && (error.module || error.source || error.origin);
  const payload = { name, message: error && error.message, stack: error && error.stack };
  if (url) payload.url = url;
  if (operation) payload.operation = operation;
  if (moduleName) payload.module = moduleName;
  console.error('UncaughtException', payload);
});

const shutdown = async (signal) => {
  if (shutdown.called) return;
  shutdown.called = true;
  try {
    const base = `<:wave:1410104552010678292> ${client.user} is going offline${signal ? ` (${signal})` : ''}`;
    const tasks = [];
    for (const [gid] of client.guilds.cache) {
      // Try assistabotLogging; fallback to generalLog
      tasks.push(
        (async () => {
          try {
            await sendLog(client, gid, 'assistabotLogging', base);
          } catch (error) {
            try { await sendLog(client, gid, 'generalLog', base); } catch (error) {}
          }
        })()
      );
    }
    await Promise.allSettled(tasks);
    await new Promise((r) => setTimeout(r, 1000));
  } catch (error) {}
  // Allow a brief window for gateway to flush, then destroy
  try { await client.destroy(); } catch (error) {}
  // Give a moment after destroy
  setTimeout(() => process.exit(0), 250);
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGBREAK', () => shutdown('SIGBREAK'));
process.on('SIGHUP', () => shutdown('SIGHUP'));
process.on('beforeExit', (code) => shutdown(`beforeExit:${code}`));
process.on('message', (msg) => {
  if (msg === 'graceful_shutdown') shutdown('IPC');
});
process.on('disconnect', () => shutdown('DISCONNECT'));

client.once('clientReady', () => {
  // Start giveaway manager
  const giveawayManager = require('./modules/giveawayManager');
  giveawayManager.start(client);
  
  // Initialize Twitch shoutouts
  require('./modules/twitchShoutouts');
});

client.login(token).catch((e) => {
  console.error('Failed to login:', e?.message || e);
  process.exit(1);
});