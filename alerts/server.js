const WebSocket = require('ws');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const tmi = require('tmi.js');
const configLoader = require('../modules/configLoader');
const alertServerConfig = require('../modules/alertServerConfig');
const { sendSourceOnlyMessage } = require('../modules/twitchChat');
const youtubeSong = require('../modules/youtubeSong');

const ALERT_SERVER_PORT = alertServerConfig.port;
const INTEGRATED_CHAT_ENABLED = /^(1|true)$/i.test(String(process.env.ASSISTABOT_INTEGRATED_CHAT_ENABLED || ''));

const twitchConfig = configLoader.twitch;
const youtubeConfig = configLoader.load('youtube');
const kickConfig = configLoader.load('kick');

const app = express();
app.use('/api/kick/webhook', express.raw({ type: 'application/json', limit: '1mb' }));
app.use(express.json({ limit: '32kb' }));

// Enable CORS for all routes
const configuredOrigins = [
    twitchConfig.publicUrl
].filter(Boolean);
const allowedOrigins = new Set(configuredOrigins.map((origin) => {
    try {
        return new URL(origin).origin;
    } catch (error) {
        console.error(`[Alerts] Ignoring invalid configured public URL "${origin}":`, error.message);
        return null;
    }
}).filter(Boolean));

const youtubeSongCors = cors({
    origin(origin, callback) {
        const isExtensionOrigin = typeof origin === 'string' &&
            /^(chrome|moz)-extension:\/\/[a-z0-9-]+$/i.test(origin);
        callback(null, isExtensionOrigin ? origin : false);
    },
    methods: ['POST'],
    allowedHeaders: ['Content-Type', 'X-Song-Signature'],
    maxAge: 600
});

app.options('/api/youtube/current-song', youtubeSongCors);
app.use('/api/youtube/current-song', youtubeSongCors);

app.use(cors({
    origin(origin, callback) {
        callback(null, !origin || allowedOrigins.has(origin));
    },
    methods: ['GET', 'POST'],
    credentials: true
}));

const server = http.createServer(app);
let wss;

// Check if port is already in use
const isPortInUse = (port) => {
    return new Promise((resolve) => {
        const testServer = require('net').createServer();
        testServer.once('error', (err) => {
            testServer.close();
            resolve(err.code === 'EADDRINUSE');
        });
        testServer.once('listening', () => {
            testServer.close();
            resolve(false);
        });
        testServer.listen(port);
    });
};

function createWebSocketServer() {
    try {
        return new WebSocket.Server({ 
            server,
            path: '/ws',
            clientTracking: true,
            perMessageDeflate: {
                zlibDeflateOptions: {
                    chunkSize: 1024,
                    memLevel: 7,
                    level: 3
                },
                zlibInflateOptions: {
                    chunkSize: 10 * 1024
                },
                clientNoContextTakeover: true,
                serverNoContextTakeover: true,
                serverMaxWindowBits: 10,
                concurrencyLimit: 10,
                threshold: 1024
            }
        });
    } catch (error) {
        // Failed to create WebSocket server
        return null;
    }
}

async function startServer(port) {
    if (await isPortInUse(port)) {
        // Port is already in use
        process.exit(1);
    }

    // Setup WebSocket server
    if (!setupWebSocketServer()) {
        // Failed to set up WebSocket server
        process.exit(1);
    }

    // Start the HTTP server
    const host = '0.0.0.0'; // Listen on all network interfaces
    return new Promise((resolve) => {
        server.listen(port, host, () => {
            resolve();
        });
    });
}

app.use((req, res, next) => {
    if (!INTEGRATED_CHAT_ENABLED && ['/chat', '/chat.html'].includes(req.path)) {
        return res.sendStatus(404);
    }
    next();
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html' }));
app.use('/sounds', express.static(path.join(__dirname, '../sounds')));

// Root route handler
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/chat', (req, res) => {
    if (!INTEGRATED_CHAT_ENABLED) {
        return res.sendStatus(404);
    }
    res.sendFile(path.join(__dirname, 'public', 'chat.html'));
});

// Track connected WebSocket clients
const clients = new Set();
const speechClients = new Set();
const speechAudioFiles = new Map();

// Initialize Twitch chat client
let tmiClient = null;
const twitchBadgeImages = new Map();
let twitchChatState = INTEGRATED_CHAT_ENABLED ? 'not_configured' : 'disabled';
let twitchChannelJoined = false;
let twitchMessagesReceived = 0;
let twitchMessagesDelivered = 0;
let twitchLastMessageAt = null;

function broadcastChatMessage(message) {
    const payload = {
        type: 'chat',
        platform: message.platform,
        username: String(message.username || 'Unknown').slice(0, 100),
        text: String(message.text || '').slice(0, 2000),
        color: /^#[0-9a-f]{6}$/i.test(message.color || '') ? message.color : null,
        badges: Array.isArray(message.badges) ? message.badges.slice(0, 12) : [],
        emotes: Array.isArray(message.emotes) ? message.emotes.slice(0, 100) : [],
        timestamp: message.timestamp || new Date().toISOString()
    };

    if (!['twitch', 'youtube', 'kick'].includes(payload.platform) || !payload.text) {
        return 0;
    }

    const serialized = JSON.stringify(payload);
    let sentCount = 0;
    for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) {
            client.send(serialized);
            sentCount++;
        }
    }
    return sentCount;
}

function twitchBadgeList(tags) {
    return Object.entries(tags.badges || {}).map(([name, version]) => ({
        label: name.replace(/[-_]/g, ' '),
        image: twitchBadgeImages.get(`${name}/${version}`) || null
    }));
}

function twitchEmoteList(tags) {
    return Object.entries(tags.emotes || {}).flatMap(([id, ranges]) => (
        String(ranges).split(',').map((range) => {
            const [start, end] = range.split('-').map(Number);
            return Number.isInteger(start) && Number.isInteger(end) ? { id, start, end } : null;
        }).filter(Boolean)
    ));
}

async function initTwitchChat() {
    const username = twitchConfig.twitch_username;
    const oauth = twitchConfig.twitch_oauth;
    const channels = Array.isArray(twitchConfig.twitch_channel) ? twitchConfig.twitch_channel : [];
    if (!username || !oauth || channels.length === 0) {
        twitchChatState = 'not_configured';
        return false;
    }

    twitchChatState = 'connecting';
    try {
        tmiClient = new tmi.Client({
            options: { debug: false },
            identity: {
                username,
                password: `oauth:${oauth.replace(/^oauth:/, '')}`
            },
            channels
        });

        tmiClient.on('connected', () => {
            twitchChatState = 'connected';
        });

        tmiClient.on('disconnected', (reason) => {
            twitchChatState = 'disconnected';
            twitchChannelJoined = false;
        });

        tmiClient.on('reconnect', () => {
            twitchChatState = 'connecting';
            twitchChannelJoined = false;
        });

        tmiClient.on('join', (channel, _username, self) => {
            if (self) {
                twitchChannelJoined = true;
            }
        });

        tmiClient.on('message', (_channel, tags, message) => {
            twitchMessagesReceived++;
            twitchLastMessageAt = new Date().toISOString();
            const delivered = broadcastChatMessage({
                platform: 'twitch',
                username: tags['display-name'] || tags.username,
                text: message,
                color: tags.color,
                badges: twitchBadgeList(tags),
                emotes: twitchEmoteList(tags)
            });
            twitchMessagesDelivered += delivered;
        });

        await tmiClient.connect();
        if (twitchChatState === 'connecting') {
            twitchChatState = 'connected';
        }
        loadTwitchBadgeImages().catch((error) => {
            console.error('[Chat Overlay] Failed to load Twitch badge images:', error.message);
        });
        return true;
    } catch (error) {
        twitchChatState = 'error';
        console.error('[Chat Overlay] Twitch chat connection failed:', error.message);
        return false;
    }
}

async function loadTwitchBadgeImages() {
    const clientId = twitchConfig.twitch_client_id;
    const clientSecret = twitchConfig.twitch_client_secret;
    if (!clientId || !clientSecret) return;

    const tokenResponse = await axios.post('https://id.twitch.tv/oauth2/token', null, {
        params: {
            client_id: clientId,
            client_secret: clientSecret,
            grant_type: 'client_credentials'
        }
    });
    const headers = {
        'Client-ID': clientId,
        Authorization: `Bearer ${tokenResponse.data.access_token}`
    };
    const requests = [
        axios.get('https://api.twitch.tv/helix/chat/badges/global', { headers })
    ];
    if (twitchConfig.twitch_channel_id) {
        requests.push(axios.get('https://api.twitch.tv/helix/chat/badges', {
            headers,
            params: { broadcaster_id: twitchConfig.twitch_channel_id }
        }));
    }

    const responses = await Promise.all(requests);
    for (const response of responses) {
        for (const badge of response.data.data || []) {
            for (const version of badge.versions || []) {
                twitchBadgeImages.set(`${badge.set_id}/${version.id}`, version.image_url_1x);
            }
        }
    }
}

let youtubePollTimer = null;
let youtubePageToken = null;
const youtubeChannelHandle = youtubeConfig.youtube_channel_handle || null;
const youtubeAutoDiscovery = Boolean(youtubeChannelHandle);
let youtubeLiveChatId = youtubeAutoDiscovery ? null : youtubeConfig.youtube_live_chat_id || null;
let youtubeChannelId = null;
let youtubePollInterval = 5000;
const youtubeDiscoveryInterval = 60000;

function youtubeBadges(author) {
    const badges = [];
    if (author.isChatOwner) badges.push({ label: 'Owner' });
    if (author.isChatModerator) badges.push({ label: 'Moderator' });
    if (author.isChatSponsor) badges.push({ label: 'Member' });
    if (author.isVerified) badges.push({ label: 'Verified' });
    return badges;
}

async function resolveYoutubeLiveChatId() {
    if (!youtubeConfig.youtube_api_key) {
        return youtubeLiveChatId;
    }

    if (youtubeAutoDiscovery) {
        if (youtubeLiveChatId) return youtubeLiveChatId;

        if (!youtubeChannelId) {
            const channelParams = {
                part: 'id,contentDetails',
                key: youtubeConfig.youtube_api_key
            };
            if (/^UC[\w-]{22}$/.test(youtubeChannelHandle)) {
                channelParams.id = youtubeChannelHandle;
            } else {
                channelParams.forHandle = youtubeChannelHandle.replace(/^@/, '');
            }

            const channelResponse = await axios.get('https://www.googleapis.com/youtube/v3/channels', {
                params: channelParams
            });
            youtubeChannelId = channelResponse.data.items?.[0]?.id || null;
            if (!youtubeChannelId) {
                throw new Error(`Could not resolve YouTube channel "${youtubeChannelHandle}".`);
            }
        }

        const uploadsPlaylistId = `UU${youtubeChannelId.slice(2)}`;
        const playlistResponse = await axios.get('https://www.googleapis.com/youtube/v3/playlistItems', {
            params: {
                part: 'snippet',
                playlistId: uploadsPlaylistId,
                maxResults: 10,
                key: youtubeConfig.youtube_api_key
            }
        });
        const videoIds = (playlistResponse.data.items || [])
            .map((item) => item.snippet?.resourceId?.videoId)
            .filter(Boolean)
            .join(',');
        if (!videoIds) return null;

        const videosResponse = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
            params: {
                part: 'snippet,liveStreamingDetails',
                id: videoIds,
                key: youtubeConfig.youtube_api_key
            }
        });
        const liveVideo = (videosResponse.data.items || []).find((video) =>
            video.snippet?.liveBroadcastContent === 'live'
            && video.liveStreamingDetails?.activeLiveChatId
        );
        if (!liveVideo) return null;

        youtubePageToken = null;
        youtubeLiveChatId = liveVideo.liveStreamingDetails.activeLiveChatId;
        return youtubeLiveChatId;
    }

    if (youtubeLiveChatId || !youtubeConfig.youtube_video_id) {
        return youtubeLiveChatId;
    }

    const response = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
        params: {
            part: 'liveStreamingDetails',
            id: youtubeConfig.youtube_video_id,
            key: youtubeConfig.youtube_api_key
        }
    });
    youtubeLiveChatId = response.data.items?.[0]?.liveStreamingDetails?.activeLiveChatId || null;
    if (!youtubeLiveChatId) {
        throw new Error('No active YouTube live chat found for the configured video ID.');
    }
    return youtubeLiveChatId;
}

async function pollYoutubeChat() {
    if (!youtubeConfig.youtube_api_key
        || (!youtubeLiveChatId && !youtubeConfig.youtube_video_id && !youtubeAutoDiscovery)) return;

    try {
        const liveChatId = await resolveYoutubeLiveChatId();
        if (!liveChatId) {
            youtubePollInterval = youtubeDiscoveryInterval;
            return;
        }

        const response = await axios.get('https://www.googleapis.com/youtube/v3/liveChat/messages', {
            params: {
                part: 'snippet,authorDetails',
                liveChatId,
                pageToken: youtubePageToken || undefined,
                key: youtubeConfig.youtube_api_key
            }
        });

        youtubePageToken = response.data.nextPageToken || youtubePageToken;
        youtubePollInterval = Math.max(Number(response.data.pollingIntervalMillis) || 5000, 1000);

        for (const item of response.data.items || []) {
            const snippet = item.snippet || {};
            const author = item.authorDetails || {};
            const text = snippet.textMessageDetails?.messageText
                || snippet.superChatDetails?.userComment
                || snippet.superStickerDetails?.altText
                || snippet.memberMilestoneChatDetails?.userComment
                || snippet.newSponsorDetails?.memberComment
                || '';
            if (!text) continue;
            broadcastChatMessage({
                platform: 'youtube',
                username: author.displayName,
                text,
                badges: youtubeBadges(author),
                timestamp: snippet.publishedAt
            });
        }
    } catch (error) {
        const apiError = error.response?.data?.error;
        const reason = apiError?.errors?.[0]?.reason;
        if (youtubeAutoDiscovery && ['liveChatEnded', 'liveChatNotFound'].includes(reason)) {
            youtubeLiveChatId = null;
            youtubePageToken = null;
            youtubePollInterval = 1000;
        } else {
            console.error('[Chat Overlay] YouTube chat polling failed:', apiError?.message || error.message);
            youtubePollInterval = youtubeAutoDiscovery && !youtubeLiveChatId
                ? youtubeDiscoveryInterval
                : 30000;
        }
    } finally {
        clearTimeout(youtubePollTimer);
        youtubePollTimer = setTimeout(pollYoutubeChat, youtubePollInterval);
    }
}

let kickPublicKey = null;
let kickPublicKeyFetchedAt = 0;
const seenKickEventIds = new Set();
let kickSubscriptionState = INTEGRATED_CHAT_ENABLED ? 'not_configured' : 'disabled';
let kickWebhookRequestsReceived = 0;
let kickWebhookSignatureFailures = 0;
let kickWebhookEventsReceived = 0;
let kickMessagesDelivered = 0;
let kickLastWebhookAttemptAt = null;
let kickLastWebhookAt = null;
let kickLastWebhookError = null;

async function getKickPublicKey(forceRefresh = false) {
    if (!forceRefresh && kickPublicKey && Date.now() - kickPublicKeyFetchedAt < 60 * 60 * 1000) {
        return kickPublicKey;
    }
    const response = await axios.get('https://api.kick.com/public/v1/public-key');
    kickPublicKey = response.data?.data?.public_key;
    if (!kickPublicKey) {
        throw new Error('Kick public-key response did not include a public key.');
    }
    kickPublicKeyFetchedAt = Date.now();
    return kickPublicKey;
}

async function verifyKickWebhook(req) {
    const messageId = req.get('Kick-Event-Message-Id');
    const timestamp = req.get('Kick-Event-Message-Timestamp');
    const signature = req.get('Kick-Event-Signature');
    if (!messageId || !timestamp || !signature || !Buffer.isBuffer(req.body)) return false;

    const eventTime = Date.parse(timestamp);
    if (!Number.isFinite(eventTime) || Math.abs(Date.now() - eventTime) > 5 * 60 * 1000) return false;

    const signedMessage = Buffer.concat([
        Buffer.from(`${messageId}.${timestamp}.`),
        req.body
    ]);
    const signatureBytes = Buffer.from(signature, 'base64');
    let publicKey = await getKickPublicKey();
    if (crypto.verify('RSA-SHA256', signedMessage, publicKey, signatureBytes)) return true;

    publicKey = await getKickPublicKey(true);
    return crypto.verify('RSA-SHA256', signedMessage, publicKey, signatureBytes);
}

app.post('/api/kick/webhook', async (req, res) => {
    if (!INTEGRATED_CHAT_ENABLED) {
        return res.sendStatus(503);
    }

    kickWebhookRequestsReceived++;
    kickLastWebhookAttemptAt = new Date().toISOString();
    try {
        if (!await verifyKickWebhook(req)) {
            kickWebhookSignatureFailures++;
            kickLastWebhookError = 'Webhook signature or required headers were invalid.';
            return res.status(401).json({ success: false, error: 'Invalid webhook signature' });
        }

        const eventId = req.get('Kick-Event-Message-Id');
        if (seenKickEventIds.has(eventId)) {
            return res.sendStatus(204);
        }
        seenKickEventIds.add(eventId);
        if (seenKickEventIds.size > 5000) {
            seenKickEventIds.delete(seenKickEventIds.values().next().value);
        }

        const eventType = req.get('Kick-Event-Type');
        kickLastWebhookError = null;
        if (eventType !== 'chat.message.sent') return res.sendStatus(204);

        const event = JSON.parse(req.body.toString('utf8'));
        kickWebhookEventsReceived++;
        kickLastWebhookAt = new Date().toISOString();
        const sender = event.sender || {};
        const identity = sender.identity || {};
        const badges = (identity.badges || []).map((badge) => ({
            label: badge.count ? `${badge.text} ${badge.count}` : badge.text
        }));
        const emotes = (event.emotes || []).flatMap((emote) => (
            (emote.positions || []).map((position) => ({
                id: emote.emote_id,
                start: position.s,
                end: position.e
            }))
        ));
        kickMessagesDelivered += broadcastChatMessage({
            platform: 'kick',
            username: sender.username,
            text: event.content,
            color: identity.username_color,
            badges,
            emotes,
            timestamp: event.created_at
        });
        return res.sendStatus(204);
    } catch (error) {
        kickLastWebhookError = error.message;
        console.error('[Chat Overlay] Failed to process Kick webhook:', error.message);
        return res.status(500).json({ success: false, error: 'Webhook processing failed' });
    }
});

async function startKickChat() {
    const { kick_client_id: clientId, kick_client_secret: clientSecret, kick_broadcaster_user_id: broadcasterId } = kickConfig;
    if (!clientId || !clientSecret || !broadcasterId) {
        kickSubscriptionState = 'not_configured';
        return;
    }

    kickSubscriptionState = 'connecting';
    try {
        const tokenResponse = await axios.post('https://id.kick.com/oauth/token', new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            grant_type: 'client_credentials'
        }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
        const accessToken = tokenResponse.data.access_token;
        const headers = { Authorization: `Bearer ${accessToken}` };
        const existing = await axios.get('https://api.kick.com/public/v1/events/subscriptions', {
            headers,
            params: { broadcaster_user_id: broadcasterId }
        });
        const hasChatSubscription = (existing.data.data || []).some((item) => item.event === 'chat.message.sent');
        if (!hasChatSubscription) {
            await axios.post('https://api.kick.com/public/v1/events/subscriptions', {
                broadcaster_user_id: Number(broadcasterId),
                events: [{ name: 'chat.message.sent', version: 1 }],
                method: 'webhook'
            }, { headers });
        }
        kickSubscriptionState = 'active';
    } catch (error) {
        kickSubscriptionState = 'error';
        console.error('[Chat Overlay] Kick subscription failed:', error.response?.data || error.message);
    }
}

async function sendTwitchMessage(message) {
    if (!tmiClient || !twitchConfig.twitch_channel?.[0]) {
        // Twitch client not initialized or no channel set
        return false;
    }

    try {
        await sendSourceOnlyMessage(message);
        return true;
    } catch (error) {
        console.error('[Chat Overlay] Error sending source-only Twitch message:', error.message);
        return false;
    }
}

function isLocalRequest(req) {
    const address = req.socket.remoteAddress;
    return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

app.post('/api/youtube/current-song', (req, res) => {
    if (!youtubeConfig.youtube_song_secret) {
        return res.status(503).json({ success: false, error: 'YouTube song reporting is not configured' });
    }

    const signature = req.get('X-Song-Signature');
    if (!youtubeSong.verifyUpdate(req.body, signature, youtubeConfig.youtube_song_secret)) {
        return res.status(401).json({ success: false, error: 'Invalid song update' });
    }

    try {
        const state = youtubeSong.saveUpdate(req.body);
        return res.json({ success: true, isPlaying: state.isPlaying });
    } catch (error) {
        if (error.code === 'STALE_SONG_UPDATE') {
            return res.status(409).json({ success: false, error: 'Stale song update' });
        }
        console.error('[YouTube Song] Failed to save playback state:', error.message);
        return res.status(500).json({ success: false, error: 'Failed to save song state' });
    }
});

app.post('/api/donation', async (req, res) => {
    if (!isLocalRequest(req)) {
        return res.status(403).json({ success: false, error: 'Local requests only' });
    }

    const clientsNotified = triggerDonationAlert(req.body);
    res.json({ success: true, clientsNotified });
});

app.post('/api/speech', async (req, res) => {
    if (!isLocalRequest(req)) {
        return res.status(403).json({ success: false, error: 'Local requests only' });
    }

    if (typeof req.body?.text !== 'string' || !req.body.text.trim()) {
        return res.status(400).json({ success: false, error: 'A non-empty text value is required' });
    }

    try {
        const clientsNotified = await triggerSpeechAlert(req.body.text);
        return res.json({ success: true, clientsNotified });
    } catch (error) {
        console.error('[Alerts] Fish Audio speech synthesis failed:', error.message);
        return res.status(503).json({
            success: false,
            error: `Fish Audio speech synthesis failed: ${error.message}`
        });
    }
});

app.get('/api/speech-audio/:id', (req, res) => {
    const speech = speechAudioFiles.get(req.params.id);
    if (!speech) {
        return res.status(404).send('Speech audio expired or not found.');
    }

    res.set({
        'Cache-Control': 'no-store',
        'Content-Type': speech.contentType
    });
    return res.send(speech.audio);
});

// Test endpoint
app.get('/test', async (req, res) => {
    try {
        const testDonation = {
            name: 'Test Donor',
            amount: (Math.random() * 100).toFixed(2),
            currency: 'USD',
            message: 'This is a test donation!',
            isTest: true  // Mark as test donation
        };
        
        // Trigger the alert for WebSocket clients
        const clientsNotified = triggerDonationAlert(testDonation);
        
        // Send message to Twitch chat
        const chatMessage = `🎉 Test donation alert: ${testDonation.name} donated $${testDonation.amount} ${testDonation.currency} - ${testDonation.message}`;
        const chatSent = await sendTwitchMessage(chatMessage);
        
        res.send(`✅ Test alert sent to ${clientsNotified} WebSocket client(s)${chatSent ? ' and Twitch chat' : ''}: ${testDonation.name} - $${testDonation.amount} ${testDonation.currency}`);
        
    } catch (error) {
        // Error processing test donation
        res.status(500).json({
            success: false,
            error: 'Error processing test donation',
            details: error.message
        });
    }
});

app.get('/api/chat/status', (_req, res) => {
    res.json({
        websocketClients: clients.size,
        integratedChatEnabled: INTEGRATED_CHAT_ENABLED,
        twitch: {
            state: twitchChatState,
            channelJoined: twitchChannelJoined,
            messagesReceived: twitchMessagesReceived,
            messagesDelivered: twitchMessagesDelivered,
            lastMessageAt: twitchLastMessageAt
        },
        youtube: INTEGRATED_CHAT_ENABLED && Boolean(youtubeConfig.youtube_api_key
            && (youtubeLiveChatId || youtubeConfig.youtube_video_id || youtubeAutoDiscovery)),
        kick: {
            state: kickSubscriptionState,
            webhookPath: '/api/kick/webhook',
            webhookRequestsReceived: kickWebhookRequestsReceived,
            webhookSignatureFailures: kickWebhookSignatureFailures,
            webhookEventsReceived: kickWebhookEventsReceived,
            messagesDelivered: kickMessagesDelivered,
            lastWebhookAttemptAt: kickLastWebhookAttemptAt,
            lastWebhookAt: kickLastWebhookAt,
            lastWebhookError: kickLastWebhookError
        }
    });
});

function setupWebSocketServer() {
    wss = createWebSocketServer();
    if (!wss) {
        // Failed to initialize WebSocket server
        return false;
    }

    wss.on('connection', (ws, req) => {
        clients.add(ws);
        if (new URL(req.url || '/', 'http://localhost').searchParams.get('role') === 'alerts') {
            speechClients.add(ws);
        }
        
        ws.on('close', () => {
            clients.delete(ws);
            speechClients.delete(ws);
        });

        ws.on('error', (error) => {
            });
    });
    
    return true;
}

function triggerDonationAlert(donation) {
    if (!donation || typeof donation !== 'object') {
        return 0;
    }

    const alertData = {
        type: 'donation',
        name: donation.name || 'Anonymous',
        amount: donation.amount || '0.00',
        currency: donation.currency || 'USD',
        message: donation.message || 'Thank you for your support!',
        isTest: !!donation.isTest,
        timestamp: new Date().toISOString()
    };

    // Track disconnected clients to remove
    const disconnectedClients = [];
    let sentCount = 0;

    // Send to all connected clients
    clients.forEach((client) => {
        try {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(alertData));
                sentCount++;
            } else if (client.readyState === WebSocket.CLOSED || client.readyState === WebSocket.CLOSING) {
                disconnectedClients.push(client);
            }
        } catch (error) {
                    disconnectedClients.push(client);
        }
    });

    // Clean up disconnected clients
    if (disconnectedClients.length > 0) {
        disconnectedClients.forEach(client => clients.delete(client));
    }

    return sentCount;
}

async function synthesizeFishAudio(text, settings) {
    const apiKey = process.env.FISH_API_KEY;
    const referenceId = process.env.FISH_AUDIO_VOICE_ID || settings.referenceId;
    const volume = Number(settings.volume ?? 0);
    if (!apiKey) {
        throw new Error('FISH_API_KEY is not configured.');
    }
    if (typeof referenceId !== 'string' || !referenceId.trim()) {
        throw new Error('Fish Audio voice ID is missing; set FISH_AUDIO_VOICE_ID.');
    }
    if (!Number.isFinite(volume)) {
        throw new Error('Fish Audio speech volume must be a finite number of decibels.');
    }

    const response = await axios.post('https://api.fish.audio/v1/tts', {
        text,
        reference_id: referenceId.trim(),
        format: 'mp3',
        latency: 'balanced',
        prosody: { volume }
    }, {
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            model: settings.model || 's2.1-pro'
        },
        responseType: 'arraybuffer',
        timeout: 30_000,
        maxContentLength: 10 * 1024 * 1024
    });

    const audio = Buffer.from(response.data);
    if (audio.length === 0) {
        throw new Error('Fish Audio returned an empty audio response.');
    }
    return audio;
}

async function triggerSpeechAlert(text) {
    const speechSettings = twitchConfig.streamVoice || {};
    if (speechSettings.enabled === false || typeof text !== 'string' || speechClients.size === 0) return 0;

    const cleanText = text.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500);
    if (!cleanText) return 0;

    const audio = await synthesizeFishAudio(cleanText, speechSettings);
    while (speechAudioFiles.size >= 25) {
        speechAudioFiles.delete(speechAudioFiles.keys().next().value);
    }
    const fileId = crypto.randomUUID();
    const speech = { audio, contentType: 'audio/mpeg' };
    speechAudioFiles.set(fileId, speech);
    const cleanupTimer = setTimeout(() => {
        if (speechAudioFiles.get(fileId) === speech) speechAudioFiles.delete(fileId);
    }, 5 * 60 * 1000);
    cleanupTimer.unref?.();

    const payload = JSON.stringify({
        type: 'speech',
        audioUrl: `/api/speech-audio/${fileId}`
    });

    let sentCount = 0;
    for (const client of speechClients) {
        if (client.readyState !== WebSocket.OPEN) continue;
        try {
            client.send(payload);
            sentCount++;
        } catch (error) {
            console.error('[Alerts] Failed to send stream speech event:', error.message);
        }
    }
    return sentCount;
}

// Function to start the alert server
async function startAlertServer(port = ALERT_SERVER_PORT) {
    try {
        if (INTEGRATED_CHAT_ENABLED) {
            await initTwitchChat();
        }
        
        await startServer(port);
        if (INTEGRATED_CHAT_ENABLED) {
            if (youtubeConfig.youtube_api_key
                && (youtubeLiveChatId || youtubeConfig.youtube_video_id || youtubeAutoDiscovery)) {
                pollYoutubeChat();
            }
            startKickChat();
        }
        return { success: true, port };
    } catch (err) {
        return { success: false, error: err };
    }
}

async function stopAlertServer() {
    clearTimeout(youtubePollTimer);
    if (tmiClient) {
        await tmiClient.disconnect();
        tmiClient = null;
    }
    if (wss) {
        await new Promise((resolve) => wss.close(resolve));
        wss = null;
    }
    if (server.listening) {
        await new Promise((resolve, reject) => {
            server.close((error) => error ? reject(error) : resolve());
        });
    }
}

// Start the server if this file is run directly
if (require.main === module) {
    startAlertServer().then(({ success }) => {
        if (!success) process.exit(1);
    });
}

module.exports = { 
    broadcastChatMessage,
    triggerDonationAlert, 
    PORT: ALERT_SERVER_PORT,
    startServer,
    initTwitchChat,
    sendTwitchMessage,
    stopAlertServer,
    startAlertServer
};