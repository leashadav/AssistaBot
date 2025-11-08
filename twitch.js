const TwitchBot = require('./modules/twitchBot');
const config = require('./config/twitch.json');

// Create and start the Twitch bot
async function main() {
    if (!config || (!config.username && !config.twitch_username) || (!config.oauth && !config.twitch_oauth)) {
        console.error('Missing Twitch configuration (username/oauth). Check config/twitch.json.');
        process.exit(1);
    }

    const bot = new TwitchBot(config);

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
        console.error('Failed to start bot:', err);
        try { await bot.stop(); } catch (_) {}
        process.exit(1);
    }
}

main();