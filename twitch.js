const TwitchBot = require('./modules/twitchBot');
const configLoader = require('./modules/configLoader');
const twitchConfig = configLoader.twitch || {};

// Create and start the Twitch bot
async function main() {
    if ((!twitchConfig.username && !twitchConfig.twitch_username) || 
        (!twitchConfig.oauth && !twitchConfig.twitch_oauth)) {
        console.error('Missing Twitch configuration (username/oauth). Check config/twitch.json.');
        process.exit(1);
    }

    const bot = new TwitchBot(twitchConfig);

    async function shutdown(signal) {
        try {
            console.log(`Twitch bot shutting down${signal ? ' (' + signal + ')' : ''}...`);
            await bot.stop();
        } catch (_) {}
        process.exit(0);
    }

    // Handle graceful shutdown on common signals
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    try {
        await bot.start();
    } catch (err) {
        console.error('Failed to start Twitch bot');
        try { await bot.stop(); } catch (_) {}
        process.exit(1);
    }
}

main();