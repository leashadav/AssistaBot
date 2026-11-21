const configLoader = require('./modules/configLoader');
const { token, clientId, guildId: configGuildId, guildIds: configGuildIds } = configLoader.config;
const { REST, RESTEvents } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v10');
const fs = require('fs');
const { prepareCommand } = require('./modules/interactiveCommandPanels');

// Usage:
//   node deploy-commands.js                    - Global deployment
//   node deploy-commands.js --global          - Explicit global deployment
//   node deploy-commands.js --guild           - Deploy to configured guild IDs
//   node deploy-commands.js --guild <id>     - Deploy to specific guild

(async function main() {
  const commands = [];

  try {
    const args = process.argv.slice(2);
    const doGlobal = args.includes('--global') || !args.includes('--guild');
    const guildArgIndex = args.indexOf('--guild');
    
    let guildIds = [];
    if (guildArgIndex !== -1) {
      // If guild ID is provided after --guild flag
      if (guildArgIndex + 1 < args.length && !args[guildArgIndex + 1].startsWith('--')) {
        guildIds = [args[guildArgIndex + 1]];
      } else {
        // No guild ID provided, use configured guild list or legacy single ID
        guildIds = Array.isArray(configGuildIds) && configGuildIds.length > 0
          ? configGuildIds
          : configGuildId ? [configGuildId] : [];
      }
    }

    if (!token || !clientId) throw new Error('Missing token or clientId in config');

    const commandFiles = fs.readdirSync('./commands').filter(file => file.endsWith('.js'));
    for (const file of commandFiles) {
      try {
        console.log(`Loading ${file}...`);
        const command = require(`./commands/${file}`);
        if (command && command.data && typeof command.data.toJSON === 'function') {
          prepareCommand(command);
          commands.push(command.data.toJSON());
          console.log(`✓ Loaded ${file}`);
        } else {
          console.warn(`Skipping ${file}: missing or invalid "data" export.`);
        }
      } catch (error) {
        console.error(`Error loading ${file}:`, error.message);
        throw error;
      }
    }

    const rest = new REST({
      version: '10',
      timeout: 15000,
      retries: 1,
      rejectOnRateLimit: ['/applications']
    }).setToken(token);
    rest.on(RESTEvents.RateLimited, ({ route, retryAfter, global }) => {
      console.warn(`[Deploy] Rate limited on ${route}; retry window is ${retryAfter}ms${global ? ' (global)' : ''}.`);
    });

    if (args.includes('--guild')) {
      if (guildIds.length === 0) throw new Error('Missing guildIds (or legacy guildId) in config, or pass an ID after --guild');
      for (const guildId of [...new Set(guildIds)]) {
        console.log('Started refreshing application (/) commands for guild', guildId, '...');
        const startedAt = Date.now();
        await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
        console.log(`Registered ${commands.length} commands for guild ${guildId} in ${Date.now() - startedAt}ms.`);
      }
    }

    if (doGlobal) {
      console.log('Started refreshing application (/) commands globally...');
      const startedAt = Date.now();
      await rest.put(Routes.applicationCommands(clientId), { body: commands });
      console.log(`Registered ${commands.length} commands globally in ${Date.now() - startedAt}ms.`);
    }

    console.log('Successfully reloaded application (/) commands.');
  } catch (error) {
    console.error('deploy-commands error:', {
      message: error?.message || String(error),
      status: error?.status,
      code: error?.code,
      route: error?.route,
      retryAfter: error?.retryAfter
    });
    process.exitCode = 1;
  } finally {
    const code = typeof process.exitCode === 'number' ? process.exitCode : 0;
    console.log('Done. Exiting with code', code);
    setTimeout(() => process.exit(code), 100);
  }
})();