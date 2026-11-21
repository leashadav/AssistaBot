const tmi = require('tmi.js');
const axios = require('axios');
const WebSocket = require('ws');
const configLoader = require('./configLoader');
const branding = configLoader.load('branding');
const alertServerConfig = require('./alertServerConfig');
const customCommands = require('./customCommands');
const PayPalMonitor = require('./paypal');
const twitchShoutouts = require('./twitchShoutouts');
const twitchGreetings = require('./twitchGreetings');
const blocklistManager = require('./blocklistManager');
const commandDirectory = require('./commandDirectory');
const { sendSourceOnlyMessage } = require('./twitchChat');
const youtubeSong = require('./youtubeSong');

class TwitchBot {
    constructor(config) {
        this.config = config || {};
        this.twitchConfig = configLoader.twitch;
        this.broadcasterAccessToken = (this.config.twitch_broadcaster_oauth || '').replace(/^oauth:/i, '');
        this.broadcasterTokenRefreshPromise = null;
        this.eventSubSocket = null;
        this.eventSubSessionId = null;
        this.eventSubStarting = false;
        this.isLive = false;
        this.streamId = null;
        this.streamStatusKnown = false;
        this.streamStatusTimer = null;
        this.streamStatusRetryTimer = null;
        this.streamStatusRefreshPromise = null;
        this.lastStreamStatusCheckAt = 0;
        this.pendingViewerJoins = new Map();
        this.pendingViewerGreetings = new Set();
        this.lastSpeechSourceWarningAt = 0;
        this.moderatorNoticeStreamIds = new Map();
        this.pendingGiftSubs = new Map();
        this.activeMysteryGiftSubGivers = new Set();

        // Initialize TMI client
        // Request secure, reconnecting connection and, if provided, include the Twitch App clientId
        // Twitch's "Chat Bots" user-list category requires Channel Chat Message EventSub
        // over a supported non-WebSocket transport, an App Access Token, and channel:bot authorization.
        // IRC/TMI and Verified Bot status alone do not qualify.
        this.client = new tmi.Client({
            options: { debug: !!this.config.debug, clientId: this.config.twitch_client_id || this.config.clientId || undefined },
            connection: { secure: true, reconnect: true },
            identity: {
                username: this.config.twitch_username || this.config.username,
                password: this.config.twitch_oauth || this.config.oauth // oauth:your_token
            },
            channels: Array.isArray(this.config.twitch_channel) ? this.config.twitch_channel : (Array.isArray(this.config.channels) ? this.config.channels : [])
        });

        // Initialize Twitch API client with App Access Token
        if (this.config.twitch_client_id && this.config.twitch_client_secret) {
            // Cache for the access token
            let accessToken = null;
            let tokenExpiry = 0;
            
            // Function to get or refresh the access token
            const getAppAccessToken = async (forceRefresh = false) => {
                try {
                    // Return cached token if it's still valid (with 5-minute buffer)
                    if (!forceRefresh && accessToken && Date.now() < tokenExpiry - 300000) {
                        return accessToken;
                    }
                    
                    const response = await axios.post('https://id.twitch.tv/oauth2/token', null, {
                        params: {
                            client_id: this.config.twitch_client_id,
                            client_secret: this.config.twitch_client_secret,
                            grant_type: 'client_credentials'
                        },
                        headers: {
                            'Content-Type': 'application/x-www-form-urlencoded'
                        }
                    });
                    
                    if (!response.data.access_token) {
                        throw new Error('No access token in response');
                    }
                    
                    // Cache the token with its expiry time (default to 1 hour if not provided)
                    accessToken = response.data.access_token;
                    tokenExpiry = Date.now() + ((response.data.expires_in || 3600) * 1000);
                    
                    return accessToken;
                } catch (error) {
                    console.error('[Twitch] Error getting app access token:', error.message);
                    if (error.response) {
                        console.error('[Twitch] Error response data:', error.response.data);
                        console.error('[Twitch] Error status:', error.response.status);
                    }
                    return null;
                }
            };

            const requestHelix = async (url, options) => {
                for (let attempt = 0; attempt < 2; attempt++) {
                    const token = await getAppAccessToken(attempt === 1);
                    if (!token) {
                        throw new Error('Failed to obtain access token');
                    }

                    try {
                        return await axios.get(url, {
                            ...options,
                            headers: {
                                ...options.headers,
                                Authorization: `Bearer ${token}`
                            }
                        });
                    } catch (error) {
                        if (error.response?.status === 401 && attempt === 0) {
                            continue;
                        }
                        throw error;
                    }
                }
            };
            
            // API client methods
            this.api = {
                getAppAccessToken,
                users: {
                    getUserByName: async (username) => {
                        try {
                            const response = await requestHelix('https://api.twitch.tv/helix/users', {
                                headers: {
                                    'Client-ID': this.config.twitch_client_id
                                },
                                params: { 
                                    login: username.toLowerCase()
                                }
                            });
                            
                            if (!response.data?.data?.length) {
                                return null;
                            }
                            
                            return response.data.data[0];
                        } catch (error) {
                            console.error(`[Twitch] Error fetching user ${username}:`, error.message);
                            if (error.response) {
                                console.error('[Twitch] Error status:', error.response.status);
                                console.error('[Twitch] Error data:', error.response.data);
                            }
                            return null;
                        }
                    }
                },
                streams: {
                    getStreamByUserId: async (userId) => {
                        try {
                            const response = await requestHelix('https://api.twitch.tv/helix/streams', {
                                headers: {
                                    'Client-ID': this.config.twitch_client_id
                                },
                                params: { 
                                    user_id: userId,
                                    type: 'live'
                                }
                            });
                            
                            if (!response.data?.data?.length) {
                                return null;
                            }
                            
                            return response.data.data[0];
                        } catch (error) {
                            console.error(`[Twitch] Error fetching stream for user ${userId}:`, error.message);
                            if (error.response) {
                                console.error('[Twitch] Error status:', error.response.status);
                                console.error('[Twitch] Error data:', error.response.data);
                            }
                            return null;
                        }
                    }
                }
            };
            // API client initialized silently
        } else {
            console.warn('Missing Twitch client ID or client secret. Some features may not work.');
        }

        // Initialize PayPal monitor
        try {
            this.paypalMonitor = new PayPalMonitor(this);
        } catch (error) {
            console.error('Failed to initialize PayPal monitor:', error);
        }

        // Bind handlers
        this.client.on('connected', this.onConnected.bind(this));
        this.client.on('message', this.onMessage.bind(this));
        this.client.on('join', (channel, username, self) => {
            twitchShoutouts.handleJoin(channel, username, self).catch((error) => {
                console.error('Error in join shoutout handler:', error?.message || 'Unknown error');
            });
        });
        this.client.on('subscription', this.onSubscription.bind(this));
        this.client.on('resub', this.onResubscription.bind(this));
        this.client.on('subgift', this.onSubGift.bind(this));
        this.client.on('anonsubgift', this.onAnonymousSubGift.bind(this));
        this.client.on('submysterygift', this.onSubMysteryGift.bind(this));
        this.client.on('anonsubmysterygift', this.onAnonymousSubMysteryGift.bind(this));
        this.client.on('cheer', this.onCheer.bind(this));
        this.client.on('raided', this.onRaid.bind(this));
        
        // Handle stream status changes
        this.client.on('streamup', () => {
            this.refreshStreamStatus(true).catch((error) => {
                console.error('[Twitch] Failed to refresh channel statuses after stream start:', error?.message || error);
            });
        });
        this.client.on('streamdown', () => {
            this.refreshStreamStatus(true).catch((error) => {
                console.error('[Twitch] Failed to refresh channel statuses after stream end:', error?.message || error);
            });
        });
    }

    async start() {
        try {
            await this.client.connect();
        } catch (err) {
            console.error('Failed to connect to Twitch:', err?.message || 'Unknown error');
            throw err;
        }
    }

    async stop() {
        try {
            if (this.streamStatusTimer) {
                clearInterval(this.streamStatusTimer);
                this.streamStatusTimer = null;
            }
            if (this.streamStatusRetryTimer) {
                clearTimeout(this.streamStatusRetryTimer);
                this.streamStatusRetryTimer = null;
            }
            if (this.eventSubSocket) {
                this.eventSubSocket.close();
                this.eventSubSocket = null;
            }

            if (this.paypalMonitor) {
                this.paypalMonitor.stop();
            }
            await this.client.disconnect();
        } catch (err) {
            console.error('Error disconnecting from Twitch:', err);
        }
    }

    async onConnected() {
        // Set the client for shoutouts module to use
        const twitchShoutouts = require('./twitchShoutouts');
        twitchShoutouts.setClient(this);
        
        // Initialize Twitch timers and set the client
        const twitchTimers = require('./twitchTimers');
        twitchTimers.setTwitchClient(this);
        twitchTimers.manualStart(); // Start timer system

        this.startStreamStatusMonitor();
        this.startFollowMonitoring().catch((error) => {
            console.error('[Twitch] Failed to start follow monitoring:', error.message);
        });
        if (!this.api) {
            this.onStreamStatusChange(false);
            return;
        }

        try {
            await this.refreshStreamStatus(true);
        } catch (err) {
            console.error('Error in onConnected:', err);
            if (!this.streamStatusKnown) this.onStreamStatusChange(false);
        }
    }

    startStreamStatusMonitor() {
        if (this.streamStatusTimer || !this.api) return;
        this.streamStatusTimer = setInterval(() => {
            this.refreshStreamStatus(true).catch((error) => {
                console.error('[Twitch] Failed to refresh stream status:', error?.message || error);
            });
        }, 30000);
        this.streamStatusTimer.unref?.();
    }

    async refreshStreamStatus(force = false) {
        if (this.streamStatusRefreshPromise) return this.streamStatusRefreshPromise;
        if (!force && Date.now() - this.lastStreamStatusCheckAt < 5000) {
            if (this.pendingViewerJoins.size && !this.streamStatusRetryTimer) {
                const retryDelay = Math.max(0, 5000 - (Date.now() - this.lastStreamStatusCheckAt));
                this.streamStatusRetryTimer = setTimeout(() => {
                    this.streamStatusRetryTimer = null;
                    this.refreshStreamStatus(true).catch((error) => {
                        console.error('[Twitch] Failed to retry stream status for waiting viewers:', error?.message || error);
                    });
                }, retryDelay);
                this.streamStatusRetryTimer.unref?.();
            }
            return;
        }

        const channels = Array.isArray(this.config.twitch_channel)
            ? Array.from(new Set(this.config.twitch_channel
                .map((channel) => String(channel || '').trim().replace(/^#/, '').toLowerCase())
                .filter(Boolean)))
            : [];
        if (channels.length === 0 || !this.api) return;
        this.lastStreamStatusCheckAt = Date.now();
        this.streamStatusRefreshPromise = (async () => {
            const channelStatuses = await Promise.all(channels.map(async (channelName) => {
                const user = await this.api.users.getUserByName(channelName);
                const stream = user ? await this.api.streams.getStreamByUserId(user.id) : null;
                return { channelName, stream };
            }));

            for (const { channelName, stream } of channelStatuses) {
                if (!stream) continue;

                const streamId = String(stream.id);
                if (this.moderatorNoticeStreamIds.get(channelName) === streamId) continue;
                this.moderatorNoticeStreamIds.set(channelName, streamId);
                this.warnIfBotIsNotModerator(channelName).catch((error) => {
                    console.error(`[Twitch] Failed to check bot moderator status in #${channelName}:`, error?.message || error);
                });
            }

            const primaryStatus = channelStatuses[0];
            const stream = primaryStatus.stream;
            this.onStreamStatusChange(!!stream, {
                streamId: stream?.id,
                suppressStopOnInitialCheck: !stream && !this.streamStatusKnown
            });
        })();
        try {
            await this.streamStatusRefreshPromise;
        } finally {
            this.streamStatusRefreshPromise = null;
        }
    }

    async refreshBroadcasterAccessToken() {
        if (this.broadcasterTokenRefreshPromise) {
            return this.broadcasterTokenRefreshPromise;
        }

        const refreshToken = (this.config.twitch_broadcaster_refresh_token || '').replace(/^oauth:/i, '');
        if (!refreshToken || !this.config.twitch_client_id || !this.config.twitch_client_secret) {
            throw new Error('Broadcaster OAuth credentials are required to refresh the Twitch access token.');
        }

        this.broadcasterTokenRefreshPromise = (async () => {
            const response = await axios.post(
                this.config.twitch_token_endpoint || 'https://id.twitch.tv/oauth2/token',
                null,
                {
                    params: {
                        client_id: this.config.twitch_client_id,
                        client_secret: this.config.twitch_client_secret,
                        grant_type: 'refresh_token',
                        refresh_token: refreshToken
                    },
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded'
                    }
                }
            );

            if (!response.data?.access_token) {
                throw new Error('Twitch did not return a broadcaster access token.');
            }

            this.broadcasterAccessToken = response.data.access_token;
            this.config.twitch_broadcaster_oauth = response.data.access_token;
            if (response.data.refresh_token) {
                process.env.TWITCH_BROADCASTER_REFRESH_TOKEN = response.data.refresh_token;
                this.config.twitch_broadcaster_refresh_token = response.data.refresh_token;
                try {
                    if (!configLoader.persistEnvironmentVariable('TWITCH_BROADCASTER_REFRESH_TOKEN', response.data.refresh_token)) {
                        console.warn('[Twitch] Broadcaster refresh token rotated. Update TWITCH_BROADCASTER_REFRESH_TOKEN in your environment before restarting.');
                    }
                } catch (error) {
                    console.error('[Twitch] Failed to persist the rotated broadcaster refresh token:', error.message);
                    console.warn('[Twitch] Update TWITCH_BROADCASTER_REFRESH_TOKEN in your environment before restarting.');
                }
            }

            return this.broadcasterAccessToken;
        })();

        try {
            return await this.broadcasterTokenRefreshPromise;
        } finally {
            this.broadcasterTokenRefreshPromise = null;
        }
    }

    async startFollowMonitoring(socketUrl = this.config.twitch_eventsub_websocket_url || 'wss://eventsub.wss.twitch.tv/ws', isReconnect = false) {
        if (this.eventSubStarting) {
            return;
        }
        if (!isReconnect && this.eventSubSocket &&
            (this.eventSubSocket.readyState === WebSocket.CONNECTING ||
                this.eventSubSocket.readyState === WebSocket.OPEN)) {
            return;
        }

        const broadcasterId = this.config.twitch_channel_id;
        const clientId = this.config.twitch_client_id;
        let broadcasterToken = (this.config.twitch_broadcaster_oauth || '').replace(/^oauth:/i, '');

        if (!broadcasterId || !clientId || (!broadcasterToken && !this.config.twitch_broadcaster_refresh_token)) {
            console.warn('[Twitch] Follow monitoring disabled: missing broadcaster ID, token, or client ID.');
            return;
        }

        this.eventSubStarting = true;
        const refreshToken = (this.config.twitch_broadcaster_refresh_token || '').replace(/^oauth:/i, '');
        if (refreshToken) {
            try {
                broadcasterToken = await this.refreshBroadcasterAccessToken();
            } catch (error) {
                console.error('[Twitch] Failed to refresh broadcaster token:', error.response?.data?.message || error.message);
                if (!broadcasterToken) {
                    this.eventSubStarting = false;
                    return;
                }
            }
        }

        const previousSocket = this.eventSubSocket;
        let socket;
        try {
            socket = new WebSocket(socketUrl);
        } catch (error) {
            this.eventSubStarting = false;
            throw error;
        }
        if (!isReconnect) {
            this.eventSubSocket = socket;
        }
        this.eventSubStarting = false;

        socket.on('message', async (rawMessage) => {
            try {
                const message = JSON.parse(rawMessage.toString());
                const messageType = message.metadata?.message_type;

                if (messageType === 'session_welcome') {
                    this.eventSubSessionId = message.payload.session.id;
                    if (isReconnect) {
                        this.eventSubSocket = socket;
                        previousSocket?.close();
                        return;
                    }
                    const response = await axios.post('https://api.twitch.tv/helix/eventsub/subscriptions', {
                        type: 'channel.follow',
                        version: '2',
                        condition: {
                            broadcaster_user_id: broadcasterId,
                            moderator_user_id: broadcasterId
                        },
                        transport: {
                            method: 'websocket',
                            session_id: this.eventSubSessionId
                        }
                    }, {
                        headers: {
                            'Client-ID': clientId,
                            Authorization: `Bearer ${broadcasterToken}`
                        }
                    });

                    if (response.data?.data?.[0]?.status !== 'enabled') {
                        throw new Error('Twitch did not enable the channel.follow subscription');
                    }
                    return;
                }

                if (messageType === 'notification' && message.payload?.subscription?.type === 'channel.follow') {
                    const follow = message.payload.event;
                    await this.onFollow(`#${follow.broadcaster_user_login}`, follow.user_name, follow);
                    return;
                }

                if (messageType === 'session_reconnect' && message.payload?.session?.reconnect_url) {
                    this.startFollowMonitoring(message.payload.session.reconnect_url, true).catch((error) => {
                        console.error('[Twitch] Failed to reconnect follow monitoring:', error.message);
                    });
                }
            } catch (error) {
                const status = error.response?.status;
                const message = error.response?.data?.message || error.message;
                console.error(`[Twitch] Follow monitoring failed${status ? ` (HTTP ${status})` : ''}: ${message}`);
                socket.close();
                if (this.eventSubSocket === socket) {
                    this.eventSubSocket = null;
                }
            }
        });

        socket.on('error', (error) => {
            console.error('[Twitch] EventSub error:', error.message);
        });
    }
    
    onStreamStatusChange(isLive, options = {}) {
        const { suppressStopOnInitialCheck = false } = options;
        const wasKnown = this.streamStatusKnown;
        const wasLive = this.isLive;
        const nextStreamId = options.streamId ? String(options.streamId) : null;
        const streamChanged = !!(this.isLive && nextStreamId && this.streamId !== nextStreamId);
        const statusChanged = !wasKnown || wasLive !== !!isLive || streamChanged;
        this.isLive = !!isLive;
        this.streamStatusKnown = true;
        if (this.isLive && nextStreamId) {
            this.streamId = nextStreamId;
            twitchGreetings.setStream(this.streamId);
            this.flushPendingViewerJoins();
        } else if (!this.isLive) {
            this.streamId = null;
            this.pendingViewerJoins.clear();
        } else if (!wasLive) {
            this.streamId = null;
        }

        const channel = this.config.twitch_channel?.[0] || this.config.channels?.[0];
        const channelName = channel ? channel.replace('#', '') : 'unknown';
        
        if (isLive) {
            // Stream is live
        }
        
        // Notify timer system about stream status change
        const twitchTimers = require('./twitchTimers');
        if (isLive && statusChanged) {
            twitchTimers.onStreamStart(true);
        } else if (!isLive && statusChanged && !suppressStopOnInitialCheck) {
            twitchTimers.onStreamEnd();
        }
        
        if (this.paypalMonitor && statusChanged) {
            this.paypalMonitor.setStreamingStatus(isLive);
        }
    }

    async warnIfBotIsNotModerator(channel) {
        const channelName = String(channel || '').replace(/^#/, '').toLowerCase();
        const botName = String(this.config.twitch_username || this.config.username || '').toLowerCase();
        if (!this.isConfiguredTwitchChannel(channel)) {
            console.warn('[Twitch] Skipping moderator warning because its channel is not in twitch_channel.');
            return;
        }
        if (!channelName || !botName) {
            throw new Error('Twitch channel and bot username must be configured.');
        }
        if (botName === channelName) return;
        if (typeof this.client.mods !== 'function') {
            throw new Error('The Twitch chat client cannot query the channel moderator list.');
        }

        const moderators = await this.client.mods(`#${channelName}`);
        if (!Array.isArray(moderators)) {
            throw new Error('Twitch returned an invalid moderator list.');
        }
        if (moderators.some((moderator) => String(moderator).toLowerCase() === botName)) return;

        const botUsername = this.twitchConfig.twitch_username || branding.botName || 'the bot';
        await this.say(
            `#${channelName}`,
            `I need mod permissions to work in this stream. Please type /mod ${botUsername.toLowerCase()}.`
        );
    }

    isConfiguredTwitchChannel(channel) {
        const normalizedChannel = String(channel || '').trim().replace(/^#/, '').toLowerCase();
        return Boolean(normalizedChannel)
            && Array.isArray(this.config.twitch_channel)
            && this.config.twitch_channel.some((configuredChannel) =>
                String(configuredChannel || '').trim().replace(/^#/, '').toLowerCase() === normalizedChannel);
    }

    isGreetingExcluded(username, userstate = null) {
        if (!username) return true;

        const normalizedUsername = String(username).toLowerCase().replace(/^@/, '');
        const configuredChannels = Array.isArray(this.config.twitch_channel)
            ? this.config.twitch_channel
            : (Array.isArray(this.config.channels) ? this.config.channels : []);
        const broadcasterNames = [
            ...configuredChannels,
            this.config.twitch_channel_name,
            this.config.broadcaster_name
        ].filter(Boolean).map(name => String(name).toLowerCase().replace(/^@/, '').replace(/^#/, ''));

        const ownBotNames = [
            this.config.twitch_username,
            this.config.username
        ].filter(Boolean).map(name => String(name).toLowerCase().replace(/^@/, '').replace(/^#/, ''));

        if (broadcasterNames.includes(normalizedUsername) || ownBotNames.includes(normalizedUsername)) {
            return true;
        }

        if (userstate?.badges?.bot === '1' || userstate?.badges?.bot) return true;
        if (String(userstate?.['user-type'] || '').toLowerCase() === 'bot') return true;

        const knownBots = new Set([
            'nightbot',
            'streamelements',
            'streamlabs',
            'moobot',
            'fossabot',
            'botisimo',
            'wizebot',
            'coebot',
            'deepbot',
            'xanbot',
            'soundalerts',
            'pokemoncommunitygame'
        ]);

        return knownBots.has(normalizedUsername)
            || /(?:^|[_-])(?:bot|bots)(?:$|[_-])/i.test(normalizedUsername)
            || /bot$/i.test(normalizedUsername);
    }

    async handleViewerJoin(channel, username, self, displayName = null, userstate = null) {
        if (self || !username || blocklistManager.isTwitchUserBlocked(username)) return;
        const configuredChannel = this.config.twitch_channel?.[0] || this.config.channels?.[0];
        if (!configuredChannel || channel.replace(/^#/, '').toLowerCase() !== configuredChannel.replace(/^#/, '').toLowerCase()) return;

        const normalizedUsername = String(username).toLowerCase().replace(/^@/, '');
        if (this.isGreetingExcluded(normalizedUsername, userstate)) return;
        const viewerDisplayName = typeof displayName === 'string' && displayName.trim()
            ? displayName.trim()
            : null;
        if (this.streamStatusKnown && !this.isLive) {
            if (!this.api) return;
            this.pendingViewerJoins.set(normalizedUsername, { channel, username: normalizedUsername, displayName: viewerDisplayName });
            this.refreshStreamStatus().catch((error) => {
                console.error('[Twitch] Failed to refresh stream status for a waiting viewer:', error?.message || error);
            });
            return;
        }
        if (!this.streamStatusKnown || !this.streamId) {
            this.pendingViewerJoins.set(normalizedUsername, { channel, username: normalizedUsername, displayName: viewerDisplayName });
            return;
        }
        await this.greetViewer(channel, normalizedUsername, viewerDisplayName);
    }

    flushPendingViewerJoins() {
        if (!this.isLive || !this.streamId) return;
        const pending = Array.from(this.pendingViewerJoins.values());
        this.pendingViewerJoins.clear();
        for (const { channel, username, displayName } of pending) {
            this.greetViewer(channel, username, displayName).catch((error) => {
                console.error('Error greeting queued Twitch viewer:', error?.message || error);
            });
        }
    }

    async greetViewer(channel, username, displayName = null) {
        const normalizedUsername = String(username).toLowerCase();
        if (this.isGreetingExcluded(normalizedUsername)) return;
        const streamId = this.streamId;
        if (!this.isLive || !streamId || twitchGreetings.hasGreeted(normalizedUsername)) return;
        const greetingKey = `${streamId}:${normalizedUsername}`;
        if (this.pendingViewerGreetings.has(greetingKey)) return;

        this.pendingViewerGreetings.add(greetingKey);
        try {
            let greetingName = displayName;
            if (!greetingName && this.api?.users?.getUserByName) {
                const user = await this.api.users.getUserByName(normalizedUsername);
                greetingName = user?.display_name;
            }
            greetingName = typeof greetingName === 'string' && greetingName.trim()
                ? greetingName.trim()
                : normalizedUsername;

            const sendPromise = this.say(channel, `Hello ${greetingName}`);
            await sendPromise;
            await this.speakOnStream(`Hello ${greetingName}`);
            twitchGreetings.markGreeted(normalizedUsername);
        } catch (error) {
            console.error(`[Twitch] Failed to greet viewer ${normalizedUsername}:`, error?.message || error);
        } finally {
            this.pendingViewerGreetings.delete(greetingKey);
        }
    }

    async handleAdCommand(channel, userstate) {
        const username = userstate['display-name'] || userstate.username || 'user';
        const reply = async (message) => {
            try {
                await this.say(channel, message);
            } catch (error) {
                console.error('[Twitch] Failed to reply to !ad command:', error.message);
            }
        };
        const isBroadcaster = userstate.badges?.broadcaster === '1';
        const isMod = userstate.mod === true || userstate.mod === '1';

        if (!isBroadcaster && !isMod) {
            await reply(`@${username}, only the broadcaster and moderators can run ads.`);
            return;
        }

        const configuredChannels = Array.isArray(this.config.twitch_channel)
            ? this.config.twitch_channel
            : (Array.isArray(this.config.channels) ? this.config.channels : []);
        const channelName = channel.replace(/^#/, '').toLowerCase();
        if (!configuredChannels.some((configuredChannel) =>
            String(configuredChannel).replace(/^#/, '').toLowerCase() === channelName)) {
            return;
        }

        if (!this.api || !this.config.twitch_channel_id || !this.config.twitch_client_id) {
            await reply(`@${username}, Twitch API credentials are not configured for ads.`);
            return;
        }

        await this.refreshStreamStatus(true);
        if (!this.streamStatusKnown || !this.isLive) {
            await reply(`@${username}, ads can only be run while the stream is live.`);
            return;
        }

        const startCommercial = (token) => axios.post(
            'https://api.twitch.tv/helix/channels/commercial',
            { length: 180 },
            {
                params: { broadcaster_id: this.config.twitch_channel_id },
                headers: {
                    'Client-Id': this.config.twitch_client_id,
                    Authorization: `Bearer ${token}`
                }
            }
        );

        try {
            const refreshToken = this.config.twitch_broadcaster_refresh_token;
            let accessToken = this.broadcasterAccessToken;
            if (!accessToken && refreshToken) {
                accessToken = await this.refreshBroadcasterAccessToken();
            }
            if (!accessToken) {
                await reply(`@${username}, broadcaster OAuth credentials are not configured for ads.`);
                return;
            }

            let response;
            try {
                response = await startCommercial(accessToken);
            } catch (error) {
                if (error.response?.status !== 401 || !refreshToken) {
                    throw error;
                }
                accessToken = await this.refreshBroadcasterAccessToken();
                response = await startCommercial(accessToken);
            }

            if (!response.data?.data?.[0]) {
                throw new Error('Twitch did not confirm that the ad started.');
            }
            await reply(`@${username}, started a 3-minute ad.`);
        } catch (error) {
            console.error('[Twitch] Failed to start ad:', error.response?.data?.message || error.message);
            await reply(`@${username}, the ad could not be started. Check the Twitch bot logs for details.`);
        }
    }

    async handleSongCommand(channel) {
        let message;
        try {
            const song = youtubeSong.getCurrentSong();
            message = song
                ? `Now playing: ${song.title}${song.artist ? ` — ${song.artist}` : ''}`
                : 'No song is currently playing on YouTube.';
        } catch (error) {
            console.error('[Twitch] Failed to read current YouTube song:', error.message);
            message = 'Song information is unavailable right now.';
        }

        try {
            await this.say(channel, message);
        } catch (error) {
            console.error('[Twitch] Failed to reply to !song:', error.message);
        }
    }

    // Main message handler
    async onMessage(channel, userstate, message, self) {
        if (self || typeof message !== 'string') return;

        // Check if channel is blocked
        const channelName = channel.replace('#', '');
        if (blocklistManager.isTwitchChannelBlocked(channelName)) {
            return; // Silently ignore messages from blocked channels
        }

        // Check if user is blocked
        if (blocklistManager.isTwitchUserBlocked(userstate.username)) {
            return; // Silently ignore messages from blocked users
        }

        if (userstate.username) {
            this.handleViewerJoin(channel, userstate.username, false, userstate['display-name'], userstate).catch((error) => {
                console.error('Error greeting Twitch chatter:', error?.message || 'Unknown error');
            });
        }

        // Handle automatic shoutouts
        try {
            await twitchShoutouts.handleMessage(channel, userstate, message);
        } catch (error) {
            console.error('Error in shoutout handler:', error?.message || 'Unknown error');
        }

        // Check for greetings to the bot
        const lowerMessage = message.toLowerCase();
        const botNames = [...new Set([this.twitchConfig.twitch_username, branding.botName]
            .filter(Boolean)
            .map(name => String(name).toLowerCase()))];
        if (botNames.some(name => lowerMessage.includes(`hi ${name}`)
            || lowerMessage.includes(`hi the${name}`)
            || lowerMessage.includes(`@${name}`)
            || lowerMessage.includes(`@the${name}`))) {
            try {
                await this.say(channel, `Hi ${userstate['display-name'] || userstate.username}!`);
            } catch (_) { /* ignore send error */ }
            return;
        }

        if (message.charAt(0) !== '!') return;

        const parts = message.slice(1).trim().split(/\s+/);
        const cmd = (parts.shift() || '').toLowerCase();
        const args = parts;

        if (cmd === 'botcommands') {
            const url = commandDirectory.getPublicUrl();
            await this.say(channel, `All bot commands: ${url}`);
            return;
        }

        if (cmd === 'pimpmeout') {
            const username = String(userstate.username || '').toLowerCase();
            if (!username) return;

            const added = twitchShoutouts.addUser(username);
            await this.say(channel, added
                ? `@${username}, you've been added to the automatic shoutout list!`
                : `@${username}, you're already on the automatic shoutout list.`);
            return;
        }

        if (cmd === 'testvoice') {
            const channelName = channel.replace(/^#/, '').toLowerCase();
            const isBroadcaster = userstate.badges?.broadcaster === '1'
                || String(userstate.username || '').toLowerCase() === channelName;
            if (!isBroadcaster) {
                await this.say(channel, `@${userstate.username}, only the broadcaster can test stream voice announcements.`);
                return;
            }
            if (!this.isLive) {
                await this.say(channel, 'The stream must be live to test voice announcements.');
                return;
            }
            if (this.config.streamVoice?.enabled === false) {
                await this.say(channel, 'Stream voice announcements are disabled in the Twitch config.');
                return;
            }

            const result = await this.speakOnStream('This is a test of the stream voice announcements.', true);
            if (result.error) {
                await this.say(channel, `Stream voice test failed: ${result.error}`);
            } else {
                await this.say(channel, result.clientsNotified
                    ? `Sent a stream voice test to ${result.clientsNotified} alert overlay client(s).`
                    : 'No alert overlay is connected. Refresh the OBS alert Browser Source and try again.');
            }
            return;
        }

        if (cmd === 'song') {
            await this.handleSongCommand(channel);
            return;
        }

        if (cmd === 'ad' || cmd === 'ads') {
            await this.handleAdCommand(channel, userstate);
            return;
        }
        
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
                    await this.say(channel, `@${userstate.username}, please wait ${remaining}s before using this command.`);
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
            const response = await customCommands.processCommand(command, context, cmd);
            if (response !== undefined && response !== null) {
                const lines = String(response).split(/\r?\n|\\n/g).map(s => s.trim()).filter(Boolean);
                const toSend = lines.length ? lines : [String(response)];
                for (const part of toSend) {
                    try {
                        await this.say(channel, part);
                    } catch (_) { /* ignore send error */ }
                    await new Promise(r => setTimeout(r, 350));
                }
                customCommands.recordCommandUse(channel, cmd, userstate['user-id']);
            }
        } catch (err) {
            console.error('Error processing command:', err?.message || 'Unknown error');
            if (this.config.debug) {
                try {
                    await this.say(channel, `@${userstate.username}, error processing command: ${err?.message || 'Unknown error'}`);
                } catch (_) { /* ignore send error */ }
            }
        }
    }

    // Event handlers for special triggers
    async onFollow(channel, username, userstate) {
        try {
            const displayName = userstate?.user_name || username;
            const login = userstate?.user_login || String(username).toLowerCase();
            const template = this.twitchConfig.autoResponse?.follow || 'Thank you {user} (@{username}) for the follow, much appreciated!';
            const messageToSend = template
                .replace(/\$\{user\}/g, displayName)
                .replace(/\$\{username\}/g, login)
                .replace(/{user}/g, displayName)
                .replace(/{username}/g, login);
            await this.say(channel, messageToSend);
            await this.speakOnStream(messageToSend);
        } catch (err) {
            console.error('[Twitch Bot] Error sending follow alert:', err);
        }
    }

    async onSubscription(channel, username, method, message, userstate) {
        return this.sendSubscriptionThankYou(channel, username, userstate, 'subscription');
    }

    async onResubscription(channel, username, _streakMonths, _message, userstate) {
        return this.sendSubscriptionThankYou(channel, username, userstate, 'resubscription');
    }

    async sendSubscriptionThankYou(channel, username, userstate, eventType) {
        try {
            const template = this.twitchConfig.autoResponse?.subscription || 'Thanks for subscribing, {user}!';
            const displayName = userstate?.['display-name'] || username;
            const messageToSend = template
                .replace(/\$\{user\}/g, displayName)
                .replace(/\$\{username\}/g, displayName)
                .replace(/{user}/g, displayName)
                .replace(/{username}/g, displayName);
            await this.say(channel, messageToSend);
            await this.speakOnStream(messageToSend);
            console.log(`[Twitch Bot] ${eventType} message sent for ${displayName}`);
        } catch (err) {
            console.error(`[Twitch Bot] Error sending ${eventType} alert:`, err);
        }
    }

    async onSubGift(channel, username, streakMonths, recipient, methods, userstate) {
        try {
            const displayName = userstate?.['display-name'] || username;
            const key = `${String(channel).toLowerCase()}:${String(displayName).toLowerCase()}`;

            if (this.activeMysteryGiftSubGivers.has(key)) {
                return;
            }

            this.queueGiftSubThank(channel, displayName, 1);
        } catch (err) {
            console.error('[Twitch Bot] Error sending sub gift alert:', err);
        }
    }

    async onAnonymousSubGift(channel, streakMonths, recipient, methods, userstate) {
        this.queueGiftSubThank(channel, 'An anonymous viewer', 1);
    }

    async onSubMysteryGift(channel, username, giftSubCount, methods, userstate) {
        try {
            const displayName = userstate?.['display-name'] || username;
            const key = `${String(channel).toLowerCase()}:${String(displayName).toLowerCase()}`;
            this.activeMysteryGiftSubGivers.add(key);
            setTimeout(() => this.activeMysteryGiftSubGivers.delete(key), 5_000);
            this.queueGiftSubThank(channel, displayName, Number(giftSubCount) || 1);
        } catch (err) {
            console.error('[Twitch Bot] Error sending mystery sub gift alert:', err);
        }
    }

    async onAnonymousSubMysteryGift(channel, giftSubCount, methods, userstate) {
        this.queueGiftSubThank(channel, 'An anonymous viewer', Number(giftSubCount) || 1);
    }

    queueGiftSubThank(channel, displayName, giftSubCount) {
        const key = `${String(channel).toLowerCase()}:${String(displayName).toLowerCase()}`;
        const existing = this.pendingGiftSubs.get(key);
        const count = (existing?.count || 0) + (Number(giftSubCount) || 1);

        if (existing?.timer) {
            clearTimeout(existing.timer);
        }

        const timer = setTimeout(async () => {
            this.pendingGiftSubs.delete(key);

            const countDescription = count === 1 ? 'a sub' : `${count} subs`;
            const template = this.twitchConfig.autoResponse?.subgift || 'Thank you {username} for gifting {countDescription}!';
            const messageToSend = template
                .replace(/\$\{user\}/g, displayName)
                .replace(/\$\{username\}/g, displayName)
                .replace(/\$\{count\}/g, String(count))
                .replace(/\$\{countDescription\}/g, countDescription)
                .replace(/{user}/g, displayName)
                .replace(/{username}/g, displayName)
                .replace(/{count}/g, String(count))
                .replace(/{countDescription}/g, countDescription);

            await this.say(channel, messageToSend);
            await this.speakOnStream(messageToSend);
        }, 1500);

        this.pendingGiftSubs.set(key, { count, timer });
    }

    async onCheer(channel, userstate, message) {
        try {
            const cheerUsername = userstate?.['display-name'] || userstate?.username || 'A viewer';
            const cheerBits = userstate?.bits || 0;
            const template = this.twitchConfig.autoResponse?.cheer || 'Thanks {user} for the {bits} bits!';
            const messageToSend = template
                .replace(/\$\{user\}/g, cheerUsername)
                .replace(/\$\{username\}/g, cheerUsername)
                .replace(/\$\{bits\}/g, cheerBits)
                .replace(/{user}/g, cheerUsername)
                .replace(/{username}/g, cheerUsername)
                .replace(/{bits}/g, cheerBits);
            await this.say(channel, messageToSend);
            await this.speakOnStream(messageToSend);
        } catch (err) {
            console.error('[Twitch Bot] Error sending cheer alert:', err);
        }
    }

    async onRaid(channel, username, viewers, tags) {
        try {
            const login = tags?.['msg-param-login'] || String(username).toLowerCase();
            const userInfo = await twitchShoutouts.getUserInfo(login);
            const displayName = tags?.['msg-param-displayName'] || userInfo?.display_name || username;
            const activity = userInfo?.game_name || userInfo?.title || tags?.game || 'their recent content';
            const template = this.twitchConfig.autoResponse?.raid || 'Thank you {user} (@{username}) for the raid! Please go check them out over at https://twitch.tv/{username}, the last activity they were doing was {game} and if you would please toss them a follow, thank you!';
            const messageToSend = template
                .replace(/\$\{user\}/g, displayName)
                .replace(/\$\{username\}/g, login)
                .replace(/\$\{viewers\}/g, viewers)
                .replace(/\$\{game\}/g, activity)
                .replace(/{user}/g, displayName)
                .replace(/{username}/g, login)
                .replace(/{viewers}/g, viewers)
                .replace(/{game}/g, activity);
            await this.say(channel, messageToSend);
            await this.speakOnStream(messageToSend);
        } catch (err) {
            console.error('[Twitch Bot] Error sending raid shoutout:', err);
        }
    }

    // Helper methods
    async speakOnStream(text, reportError = false) {
        if (!this.isLive || this.config.streamVoice?.enabled === false) {
            return reportError ? { clientsNotified: 0, error: null } : 0;
        }
        try {
            const response = await axios.post(`${alertServerConfig.baseUrl}/api/speech`, { text }, { timeout: 20_000 });
            const clientsNotified = Number(response.data?.clientsNotified) || 0;
            if (clientsNotified === 0 && Date.now() - this.lastSpeechSourceWarningAt > 60_000) {
                this.lastSpeechSourceWarningAt = Date.now();
                console.warn('[Twitch] No stream alert browser source is connected for voice announcements.');
            }
            return reportError ? { clientsNotified, error: null } : clientsNotified;
        } catch (error) {
            const message = error.response?.data?.error || error.message;
            console.error('[Twitch] Failed to send stream voice announcement:', message);
            return reportError ? { clientsNotified: 0, error: message } : 0;
        }
    }

    async say(_channel, message) {
        try {
            return await sendSourceOnlyMessage(message);
        } catch (err) {
            console.error('[Twitch] Error sending source-only chat message:', err.message);
            throw err;
        }
    }

    async whisper(username, message) {
        try {
            await this.client.whisper(username, message);
        } catch (err) {
            console.error('Error sending Twitch whisper:', err);
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