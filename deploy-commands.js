const { SlashCommandBuilder } = require('discord.js');
const { token, clientId, guildId } = require('./config.json');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v10');

const commands = [];

// Dynamically load all commands from the "commands/" folder
const fs = require('fs');
const path = require('path');

const commandFiles = fs.readdirSync('./commands').filter(file => file.endsWith('.js'));
for (const file of commandFiles) {
  const command = require(`./commands/${file}`);
  if (command && command.data && typeof command.data.toJSON === 'function') {
    commands.push(command.data.toJSON());
  } else {
    console.warn(`Skipping ${file}: missing or invalid "data" export.`);
  }
}

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
  try {
    console.log('Started refreshing application (/) commands.');

    // Deploy commands to a specific server (guild)
    // await rest.put(
    //   Routes.applicationGuildCommands(clientId, guildId),
    //   { body: commands },
    // );

    // Deploy commands globally (uncomment if needed)
    await rest.put(
      Routes.applicationCommands(clientId),
      { body: commands },
    );

    console.log('Successfully reloaded application (/) commands.');
  } catch (error) {
    console.error(error);
  }
})();