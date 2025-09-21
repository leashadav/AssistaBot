const { token, clientId, guildId } = require('./config.json');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v10');
const commands = [];

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
  try {
    console.log('Started deleting application (/) commands.');

    // Delete commands from a specific server (guild)
//    await rest.put(
//      Routes.applicationGuildCommands(clientId, guildId),
//      { body: [] }, // Pass an empty array to delete all commands
//    );

    // Delete global commands
  await rest.put(
    Routes.applicationCommands(clientId),
    { body: commands },
  );

    console.log('Successfully deleted application (/) commands.');
  } catch (error) {
    console.error(error);
  }
})();