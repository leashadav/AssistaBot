const configLoader = require('./modules/configLoader');
const { token, clientId, guildId } = configLoader.config;
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v10');
const fs = require('fs');

// Usage:
//   node deploy-commands.js --global
//   node deploy-commands.js --guild
// If neither flag is provided, defaults to --global.

(async function main() {
  const commands = [];

  try {
    const args = new Set(process.argv.slice(2));
    const doGuild = args.has('--guild');
    const doGlobal = args.has('--global') || !doGuild;

    if (!token || !clientId) throw new Error('Missing token or clientId in config');

    const commandFiles = fs.readdirSync('./commands').filter(file => file.endsWith('.js'));
    for (const file of commandFiles) {
      try {
        console.log(`Loading ${file}...`);
        const command = require(`./commands/${file}`);
        if (command && command.data && typeof command.data.toJSON === 'function') {
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

    const rest = new REST({ version: '10' }).setToken(token);

    if (doGuild) {
      if (!guildId) throw new Error('Missing guildId in config for guild deployment');
      console.log('Started refreshing application (/) commands for guild', guildId, '...');
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
      console.log(`Registered ${commands.length} commands for guild ${guildId}.`);
    }

    if (doGlobal) {
      console.log('Started refreshing application (/) commands globally...');
      await rest.put(Routes.applicationCommands(clientId), { body: commands });
      console.log(`Registered ${commands.length} commands globally.`);
    }

    console.log('Successfully reloaded application (/) commands.');
  } catch (error) {
    console.error('deploy-commands error:', error?.message || error);
    process.exitCode = 1;
  } finally {
    // Ensure the process exits so the terminal is ready for more commands
    const code = typeof process.exitCode === 'number' ? process.exitCode : 0;
    console.log('Done. Exiting with code', code);
    process.exit(code);
  }
})();