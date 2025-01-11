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
            default:
                message.reply('Unknown command. Try !hello, !ping, or !bye.');
        }
    }
});

client.login(process.env.token || config.token);