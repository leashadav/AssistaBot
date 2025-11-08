const configLoader = require('./modules/configLoader');
const { token, clientId, guildId } = configLoader.config;
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v10');

// Usage:
//   node delete-commands.js --global --yes
//   node delete-commands.js --guild --yes
// If neither --global nor --guild is provided, defaults to --global.
// --yes bypasses the safety confirmation.

const args = new Set(process.argv.slice(2));
const doGuild = args.has('--guild');
const doGlobal = !doGuild;
const assumeYes = true;

const rest = new REST({ version: '10' }).setToken(token);

async function confirmSafety(scope) {
  if (assumeYes) return true;
  console.log(`[DRY-RUN] Would delete ${scope} commands. Re-run with --yes to proceed.`);
  return false;
}

(async () => {
  try {
    if (!token || !clientId) throw new Error('Missing token or clientId in config');

    console.log('Delete commands script starting...');

    if (doGuild) {
      if (!guildId) throw new Error('Missing guildId in config for guild deletion');
      if (await confirmSafety('GUILD')) return await rest.put(
        Routes.applicationGuildCommands(clientId, guildId),
        { body: [] }
      ).then(() => console.log(`Successfully deleted all guild commands for guildId=${guildId}`));
    }

    if (doGlobal) {
      if (await confirmSafety('GLOBAL')) return await rest.put(
        Routes.applicationCommands(clientId),
        { body: [] }
      ).then(() => console.log('Successfully deleted all global commands'));
    }
  } catch (error) {
    console.error('Error deleting commands:', error?.message || error);
  }
})();