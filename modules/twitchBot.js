const tmi = require('tmi.js');
const customCommands = require('./customCommands');

class TwitchBot {
    constructor(config) {
        this.config = config || {};

        // Initialize TMI client
        // Request secure, reconnecting connection and, if provided, include the Twitch App clientId
        // Note: marking an account as a "bot" in the Twitch chat user list requires registering the bot
        // through the Twitch Developer Console / Verified Bots & Services program. See README or docs.
        this.client = new tmi.Client({
            options: { debug: !!this.config.debug, clientId: this.config.twitch_client_id || this.config.clientId || undefined },
            connection: { secure: true, reconnect: true },
            identity: {
                username: this.config.twitch_username || this.config.username,
                password: this.config.twitch_oauth || this.config.oauth // oauth:your_token
            },
            channels: Array.isArray(this.config.twitch_channel) ? this.config.twitch_channel : (Array.isArray(this.config.channels) ? this.config.channels : [])
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
            console.error('Failed to connect to Twitch:', err?.message || 'Unknown error');
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
        // Connection status handled by start.js
    }

    // Main message handler
    async onMessage(channel, userstate, message, self) {
        if (self || typeof message !== 'string') return;

        // Check for greetings to the bot
        const lowerMessage = message.toLowerCase();
        if (lowerMessage.includes('hi assistabot') || lowerMessage.includes('hi theassistabot') ||
            lowerMessage.includes('@assistabot') || lowerMessage.includes('@theassistabot')) {
            try {
                await this.client.say(channel, `Hi ${userstate.username}!`);
            } catch (_) { /* ignore send error */ }
            return;
        }

        if (message.charAt(0) !== '!') return;

        const parts = message.slice(1).trim().split(/\s+/);
        const cmd = (parts.shift() || '').toLowerCase();
        const args = parts;
        
        // Get command target (first argument or null)
        const targetUser = args.length > 0 ? args[0].replace(/^@/, '') : null;

        // Find the command
        const command = customCommands.getCommand(channel, cmd);
        if (!command) return;

        // Check cooldown
        const remaining = customCommands.getCooldownRemaining(channel, cmd, userstate['user-id']);
        if (remaining > 0) {
            if (this.config.notifyCooldown) {
                try {
                    await this.client.say(channel, `@${userstate.username}, please wait ${remaining}s before using this command again.`);
                } catch (_) { /* ignore send error */ }
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
            if (response !== undefined && response !== null) {
                const lines = String(response).split(/\r?\n|\\n/g).map(s => s.trim()).filter(Boolean);
                const toSend = lines.length ? lines : [String(response)];
                for (const part of toSend) {
                    try {
                        await this.client.say(channel, part);
                    } catch (_) { /* ignore send error */ }
                    await new Promise(r => setTimeout(r, 350));
                }
                customCommands.recordCommandUse(channel, cmd, userstate['user-id']);
            }
        } catch (err) {
            console.error('Error processing command:', err?.message || 'Unknown error');
            if (this.config.debug) {
                try {
                    await this.client.say(channel, `@${userstate.username}, error processing command: ${err?.message || 'Unknown error'}`);
                } catch (_) { /* ignore send error */ }
            }
        }
    }

    // Event handlers for special triggers
    async onSubscription() {
        // Subscription handled silently
    }

    async onSubGift() {
        // Gift sub handled silently
    }

    async onCheer() {
        // Cheer handled silently
    }

    async onRaid(channel, username, viewers, tags) {
        try {
            await this.client.say(channel, `Thank you @${username} for the raid! Please go check them out over at https://twitch.tv/${username} , the last activity they were doing was ${tags?.game || 'something awesome'} and if you would please toss them a follow, thank you!`);
        } catch (err) {
            console.error('AssistaBot: Error sending raid shoutout');
        }
    }

    // Helper methods
    async say(channel, message) {
        try {
            await this.client.say(channel, message);
        } catch (err) {
            console.error('AssistaBot: Error sending message');
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