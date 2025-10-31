const TwitchBot = require('./modules/twitchBot');
const config = require('./config/twitch.json');

// Create and start the Twitch bot
async function main() {
    const bot = new TwitchBot(config);
    
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
        console.log('Shutting down...');
        await bot.stop();
        process.exit(0);
    });

    try {
        await bot.start();
    } catch (err) {
        console.error('Failed to start bot:', err);
        process.exit(1);
    }
}

main();