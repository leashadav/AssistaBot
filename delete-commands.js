const configLoader = require('./modules/configLoader');
const { token, clientId, guildId, guildIds: configGuildIds } = configLoader.config;
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v10');

// Usage:
//   node delete-commands.js --global --yes
//   node delete-commands.js --guild --yes
//   node delete-commands.js --guild <id> --yes
// If neither --global nor --guild is provided, deletes both the configured
// guild commands and global commands.
// --yes bypasses the safety confirmation.

const args = new Set(process.argv.slice(2));
const hasGuildFlag = args.has('--guild');
const hasGlobalFlag = args.has('--global');
const doGuild = hasGuildFlag || (!hasGuildFlag && !hasGlobalFlag);
const doGlobal = hasGlobalFlag || (!hasGuildFlag && !hasGlobalFlag);
const guildArgIndex = process.argv.indexOf('--guild');
const explicitGuildId = guildArgIndex !== -1 && process.argv[guildArgIndex + 1] && !process.argv[guildArgIndex + 1].startsWith('--')
  ? process.argv[guildArgIndex + 1]
  : null;
const requestedGuildIds = explicitGuildId
  ? [explicitGuildId]
  : Array.isArray(configGuildIds) && configGuildIds.length > 0
    ? configGuildIds
    : guildId ? [guildId] : [];
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
      if (requestedGuildIds.length === 0) throw new Error('Missing guildIds (or legacy guildId) in config, or pass an ID after --guild');
      if (await confirmSafety('GUILD')) {
        for (const targetGuildId of [...new Set(requestedGuildIds)]) {
          await rest.put(
            Routes.applicationGuildCommands(clientId, targetGuildId),
            { body: [] }
          );
          console.log(`Successfully deleted all guild commands for guildId=${targetGuildId}`);
        }
      }
    }

    if (doGlobal) {
      if (await confirmSafety('GLOBAL')) {
        await rest.put(Routes.applicationCommands(clientId), { body: [] });
        console.log('Successfully deleted all global commands');
      }
    }
  } catch (error) {
    console.error('Error deleting commands:', error?.message || error);
  }
})();