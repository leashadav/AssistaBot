/**
 * @file Twitch Bot Entry Point
 * @module twitch
 * @description This module initializes and manages the Twitch bot instance.
 * It handles the bot's lifecycle, message processing, and provides an HTTP API
 * for sending messages to Twitch chat.
 */

const http = require('http');
const TwitchBot = require('./modules/twitchBot');
const configLoader = require('./modules/configLoader');

const twitchConfig = configLoader.twitch || {};

async function shutdown(signal, bot, server) {
    try {
        if (server && typeof server.close === 'function') {
            server.close();
        }

        if (bot && typeof bot.stop === 'function') {
            await bot.stop();
        }

        console.log(`[Twitch] Shutdown complete (${signal})`);
        process.exit(0);
    } catch (error) {
        console.error('[Twitch] Shutdown error:', error);
        process.exit(1);
    }
}

async function main() {
    if ((!twitchConfig.username && !twitchConfig.twitch_username) ||
        (!twitchConfig.oauth && !twitchConfig.twitch_oauth)) {
        console.error('Missing Twitch configuration (username/oauth). Check config/twitch.json.');
        process.exit(1);
    }

    const bot = new TwitchBot(twitchConfig);
    let server;

    process.on('unhandledRejection', (reason, promise) => {
        console.error('[Twitch] Unhandled Rejection:', reason?.message || reason);
    });

    try {
        await bot.start();

        server = http.createServer((req, res) => {
            if (req.method === 'GET' && req.url === '/status') {
                const readyState = bot.client?.readyState?.() || 'UNKNOWN';
                const configuredChannels = bot.config.twitch_channel || bot.config.channels || [];
                const joinedChannels = bot.client?.getChannels?.() || [];
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    connected: readyState === 'OPEN',
                    readyState,
                    username: bot.config.twitch_username || bot.config.username || null,
                    configuredChannels,
                    joinedChannels
                }));
                return;
            }

            if (req.method !== 'POST' || req.url !== '/send-message') {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    success: false,
                    error: 'Not Found',
                    message: 'Use GET /status or POST /send-message'
                }));
                return;
            }

            let body = '';
            req.on('data', chunk => {
                body += chunk.toString();
            });

            req.on('end', async () => {
                try {
                    const payload = body ? JSON.parse(body) : {};
                    const { channel, message } = payload;

                    if (!channel || !message) {
                        throw new Error('Missing required fields: channel and message');
                    }

                    if (!bot.client) {
                        throw new Error('Twitch client not connected');
                    }

                    const targetChannel = bot.config.twitch_channel?.[0] || bot.config.channels?.[0] || channel;
                    await bot.say(targetChannel, message);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        success: true,
                        channel: targetChannel,
                        message: 'Message sent successfully'
                    }));
                } catch (error) {
                    console.error('[Twitch] Error sending message:', error);
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        success: false,
                        error: error.message
                    }));
                }
            });
        });

        server.on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                console.error(`\nERROR: Port ${process.env.TWITCH_BOT_PORT || 3003} is already in use.`);
                console.log('This port is required for the Twitch bot message server.');
                console.log('Please close the application using this port or change the port in the configuration.');
            } else {
                console.error('[Twitch] HTTP server error:', err);
            }
            process.exit(1);
        });

        const PORT = process.env.TWITCH_BOT_PORT || 3003;
        server.listen(PORT, () => {
        });

        const handleSignal = (signal) => {
            shutdown(signal, bot, server);
        };

        process.once('SIGINT', handleSignal);
        process.once('SIGTERM', handleSignal);
    } catch (err) {
        console.error('Failed to start Twitch bot:', err);
        try {
            if (bot && typeof bot.stop === 'function') {
                await bot.stop();
            }
        } catch (error) {
            console.error('Error during bot cleanup:', error);
        }
        process.exit(1);
    }
}

main().catch((error) => {
    console.error('Fatal error in Twitch bot:', error);
    process.exit(1);
});