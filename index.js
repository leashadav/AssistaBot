const { Client, GatewayIntentBits, Partials } = require('discord.js');
const config = require("./config.json")
require('dotenv').config()
const client = new Client({
  intents: [
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildBans,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

client.once('ready', () => {
  console.log(`${client.user.username} is ready!`);
client.user.setPresence({status: "online"});
client.user.setActivity('Using a fire extinguisher on Shadavs brain', { type: 'WATCHING' });
});

client.on('messageCreate', message => {
    if (message.author.bot) return; 

    
    if (message.content.startsWith('!')) {
        const args = message.content.slice(1).trim().split(/ +/); 
        const command = args.shift().toLowerCase(); 

        
        switch (command) {
            case 'hello':
                message.reply('Hello there!');
                break;
            case 'ping':
                message.reply('Pong!');
                break;
            case 'bye':
                message.reply('Goodbye!');
                break;
        }
    }
});

client.on('interactionCreate', async interaction => {
	if (!interaction.isCommand()) return;

	const { commandName } = interaction;

	if (commandName === 'server') {
		await interaction.reply(`Server name: ${interaction.guild.name}\nDescription: ${interaction.guild.description}\nCreated on: ${interaction.guild.createdAt}\nTotal members: ${interaction.guild.memberCount}`);
	} else if (commandName === 'user') {
		await interaction.reply(`Display Name: ${interaction.user.displayName}\nUsername: ${interaction.user.username}\nUser ID: ${interaction.user.id}\nAccount Created: ${interaction.user.createdAt}`);
	}
});

client.login(process.env.token || config.token);