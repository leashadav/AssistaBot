const { Client, Collection, GatewayIntentBits, Partials } = require('discord.js');
const fs = require('fs');
const path = require('path');
const configLoader = require('./modules/configLoader');
const branding = configLoader.load('branding');
const cache = require('./utils/cache');
const requestBatcher = require('./utils/requestBatcher');
const { token } = configLoader.config;
const DEBUG = /^(1|true)$/i.test(String(process.env.ASSISTABOT_DEBUG || ''));
const { sendLog } = require('./modules/logger');
const cron = require('node-cron');
const { prepareCommand } = require('./modules/interactiveCommandPanels');
const booster = require('./modules/booster');

if (!token) {
  console.error('❌ Missing Discord bot token in config (token).');
  process.exit(1);
}

// Initialize client with utilities
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
    GatewayIntentBits.GuildIntegrations,
    GatewayIntentBits.GuildVoiceStates  // Add this line for voice state updates
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.User],
});

// Initialize collections and utilities
client.commands = new Collection();
client.cache = cache;
client.requestBatcher = requestBatcher;

// Load commands
try {
  const commandFiles = fs.existsSync('./commands')
    ? fs.readdirSync('./commands').filter(file => file.endsWith('.js'))
    : [];
  for (const file of commandFiles) {
    try {
      const command = require(`./commands/${file}`);
      if (command && command.data && command.data.name) {
        prepareCommand(command);
        // Register the command with its autocomplete handler if it exists
        client.commands.set(command.data.name, command);
        
        if (DEBUG) {
          console.log(`Loaded command: ${command.data.name}${command.autocomplete ? ' (with autocomplete)' : ''}`);
        }
      } else {
        console.warn(`Skipping ${file}: missing data.name or invalid command structure`);
      }
    } catch (error) {
      console.error(`Error loading command ${file}:`, error);
    }
  }
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
    // Skip birthdayListHandler.js as it's not a standard event handler
    if (file === 'birthdayListHandler.js') continue;
    
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
    sendLog(client, gid, 'assistabotLogging', base, null, null, 'Bot Status').catch(() => {});
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

const shutdown = async function shutdown(signal) {
  try {
    } catch (error) {
    console.error('Error during shutdown:', error);
  }
  if (shutdown.called) return;
  shutdown.called = true;
  try {
    await booster.stopRenewalMonitor();
  } catch (error) {
    console.error('Error stopping booster renewal monitor:', error?.message || error);
  }
  try {
    const base = `${branding.shutdownEmoji || '👋'} ${client.user} is going offline${signal ? ` (${signal})` : ''}`;
    const tasks = [];
    for (const [gid] of client.guilds.cache) {
      // Log shutdown only to assistabotLogging
      tasks.push(sendLog(client, gid, 'assistabotLogging', base, null, null, 'Bot Status'));
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
  
  // Initialize Twitch stream notifications (single instance, stored on client)
  if (!client.twitchStreamBot) {
    const TwitchNotifications = require('./modules/twitchNotifications');
    const twitchStreamBot = new TwitchNotifications(client);
    client.twitchStreamBot = twitchStreamBot;
    twitchStreamBot.startMonitoring(5 * 60 * 1000);
  }

  // Initialize YouTube stream notifications (single instance, stored on client)
  if (!client.youtubeStreamBot) {
    const YouTubeNotifications = require('./modules/youtubeNotifications');
    const youtubeStreamBot = new YouTubeNotifications(client);
    client.youtubeStreamBot = youtubeStreamBot;
    youtubeStreamBot.startMonitoring(5 * 60 * 1000, 15 * 60 * 1000);
  }

  // Initialize TikTok stream notifications (single instance, stored on client)
  if (!client.tiktokStreamBot) {
    const TikTokNotifications = require('./modules/tiktokNotifications');
    const tiktokStreamBot = new TikTokNotifications(client);
    client.tiktokStreamBot = tiktokStreamBot;
    tiktokStreamBot.startMonitoring(5 * 60 * 1000);
  }

  // Initialize presence streaming notifications (single instance, stored on client)
  if (!client.presenceStreaming) {
    const PresenceStreaming = require('./modules/presenceStreaming');
    const presenceStreaming = new PresenceStreaming(client);
    client.presenceStreaming = presenceStreaming;
  }

  // Initialize stream schedule poster (single instance, stored on client)
  if (!client.streamSchedulePoster) {
    const StreamSchedulePoster = require('./modules/streamSchedulePoster');
    const streamSchedulePoster = new StreamSchedulePoster(client);
    client.streamSchedulePoster = streamSchedulePoster;
    streamSchedulePoster.start();
  }

  // Keep the reset at 2:00 AM Central across daylight-saving changes.
  cron.schedule('0 2 * * *', async () => {
    const customCommands = require('./modules/customCommands');
    
    for (const [guildId] of client.guilds.cache) {
      try {
        const brainRoleId = customCommands.getBrainRole(guildId);
        if (brainRoleId) {
          const guild = await client.guilds.fetch(guildId);
          
          // Get the current holder from the brain scores data
          const brainScoresDb = customCommands.brainScoresDb || {};
          const currentHolderId = brainScoresDb[guildId]?.currentHolder;
          
          if (currentHolderId) {
            const currentHolder = await guild.members.fetch(currentHolderId).catch(() => null);
            
            if (currentHolder && currentHolder.roles.cache.has(brainRoleId)) {
              await currentHolder.roles.remove(brainRoleId, 'Daily brain role reset');
            }
          }
        }
        
        customCommands.resetDailyScores(guildId);
      } catch (error) {
        console.error(`[BrainRole] Error resetting brain role for guild ${guildId}:`, error);
      }
    }
  }, {
    timezone: 'America/Chicago'
  });
});


// Initialize the client
client.login(token).catch((e) => {
  console.error('Failed to login:', e?.message || e);
  process.exit(1);
});