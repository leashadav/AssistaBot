const tmi = require('tmi.js');
const customCommands = require('./customCommands');

class TwitchBot {
    constructor(config) {
        this.config = config;
        this.channels = new Set();
        
        // Initialize TMI client
        // Request secure, reconnecting connection and, if provided, include the Twitch App clientId
        // Note: marking an account as a "bot" in the Twitch chat user list requires registering the bot
        // through the Twitch Developer Console / Verified Bots & Services program. See README or docs.
        this.client = new tmi.Client({
            options: { debug: config.debug || false, clientId: config.clientId || undefined },
            connection: { secure: true, reconnect: true },
            identity: {
                username: config.username,
                password: config.oauth // oauth:your_token
            },
            channels: config.channels || []
        });

        // Bind handlers
        this.client.on('connected', this.onConnected.bind(this));
        this.client.on('message', this.onMessage.bind(this));
        this.client.on('subscription', this.onSubscription.bind(this));
        this.client.on('subgift', this.onSubGift.bind(this));
        this.client.on('cheer', this.onCheer.bind(this));
        this.client.on('raided', this.onRaid.bind(this));
    }

    async start() {
        try {
            await this.client.connect();
            console.log('Connected to Twitch');
        } catch (err) {
            console.error('Failed to connect to Twitch:', err);
            throw err;
        }
    }

    async stop() {
        try {
            await this.client.disconnect();
            console.log('Disconnected from Twitch');
        } catch (err) {
            console.error('Error disconnecting from Twitch:', err);
        }
    }

    async onConnected() {
        console.log('Connected to Twitch channels:', this.client.getChannels().join(', '));
    }

    // Main message handler
    async onMessage(channel, userstate, message, self) {
        if (self || !message.startsWith('!')) return;

        const parts = message.slice(1).split(/\s+/);
        const cmd = parts.shift().toLowerCase();
        const args = parts;
        
        // Get command target (first argument or null)
        const targetUser = args.length > 0 ? args[0].replace('@', '') : null;

        // Find the command
        const command = customCommands.getCommand(channel, cmd);
        if (!command) return;

        // Check cooldown
        const remaining = customCommands.getCooldownRemaining(channel, cmd, userstate['user-id']);
        if (remaining > 0) {
            if (this.config.notifyCooldown) {
                await this.client.say(channel, `@${userstate.username}, please wait ${remaining}s before using this command again.`);
            }
            return;
        }

        // Process command with full Twitch context
        const context = {
            platform: 'twitch',
            message: {
                username: userstate.username,
                userId: userstate['user-id'],
                color: userstate.color,
                badges: userstate.badges || {},
                subscriber: userstate.subscriber,
                mod: userstate.mod,
                vip: !!userstate.badges?.vip,
                turbo: !!userstate.badges?.turbo,
                subscriberMonths: userstate['badge-info']?.subscriber,
                id: userstate.id,
                'display-name': userstate['display-name'],
                'first-msg': userstate['first-msg'],
                'returning-chatter': userstate['returning-chatter'],
                emotes: userstate.emotes || {},
                flags: userstate.flags || {},
                'msg-id': userstate['msg-id'],
                'room-id': userstate['room-id'],
                'custom-reward-id': userstate['custom-reward-id']
            },
            channel: channel.replace('#', ''),
            targetUser,
            args,
            // Extra Twitch-specific context
            isBroadcaster: userstate.badges?.broadcaster === '1',
            isFounder: userstate.badges?.founder === '1',
            isVIP: !!userstate.badges?.vip,
            isSubGifter: !!userstate.badges?.subGifter,
            cheerBits: 0
        };

        try {
            const response = await customCommands.processCommand(command, context);
            if (response) {
                await this.client.say(channel, response);
                // Record command use for cooldown
                customCommands.recordCommandUse(channel, cmd, userstate['user-id']);
            }
        } catch (err) {
            console.error('Error processing command:', err);
            if (this.config.debug) {
                await this.client.say(channel, `@${userstate.username}, error processing command: ${err.message}`);
            }
        }
    }

    // Event handlers for special triggers
    async onSubscription(channel, username, method, message, userstate) {
        // Add custom sub handling here
        console.log(`${username} subscribed to ${channel}`);
    }

    async onSubGift(channel, username, streakMonths, recipient, methods, userstate) {
        // Add custom sub gift handling here
        console.log(`${username} gifted a sub to ${recipient} in ${channel}`);
    }

    async onCheer(channel, userstate, message) {
        // Add custom bits handling here
        console.log(`${userstate.username} cheered ${userstate.bits} bits in ${channel}`);
    }

    async onRaid(channel, username, viewers) {
        // Add custom raid handling here
        console.log(`${username} raided ${channel} with ${viewers} viewers`);
    }

    // Helper methods
    async say(channel, message) {
        try {
            await this.client.say(channel, message);
        } catch (err) {
            console.error('Error sending message:', err);
        }
    }

    async whisper(username, message) {
        try {
            await this.client.whisper(username, message);
        } catch (err) {
            console.error('Error sending whisper:', err);
        }
    }

    async timeout(channel, username, duration, reason) {
        try {
            await this.client.timeout(channel, username, duration, reason);
        } catch (err) {
            console.error('Error timing out user:', err);
        }
    }
}

module.exports = TwitchBot;