const axios = require('axios');
const configLoader = require('./configLoader');

let appAccessToken = null;
let tokenExpiry = 0;
let tokenRequest = null;

async function getAppAccessToken(config) {
    if (appAccessToken && Date.now() < tokenExpiry - 300000) {
        return appAccessToken;
    }

    if (!tokenRequest) {
        tokenRequest = axios.post('https://id.twitch.tv/oauth2/token', null, {
            params: {
                client_id: config.twitch_client_id,
                client_secret: config.twitch_client_secret,
                grant_type: 'client_credentials'
            }
        }).then((response) => {
            if (!response.data.access_token) {
                throw new Error('Twitch did not return an app access token.');
            }

            appAccessToken = response.data.access_token;
            tokenExpiry = Date.now() + ((response.data.expires_in || 3600) * 1000);
            return appAccessToken;
        }).finally(() => {
            tokenRequest = null;
        });
    }

    return tokenRequest;
}

async function sendSourceOnlyMessage(message) {
    const config = configLoader.twitch;
    const clientId = config.twitch_client_id;
    const clientSecret = config.twitch_client_secret;
    const broadcasterId = config.twitch_channel_id;
    const senderId = config.twitch_bot_id;

    if (!clientId || !clientSecret) {
        throw new Error('Twitch client ID and client secret are required for source-only chat messages.');
    }
    if (!broadcasterId || !senderId) {
        throw new Error('Twitch broadcaster ID and bot ID are required for source-only chat messages.');
    }
    if (typeof message !== 'string' || !message.trim()) {
        throw new Error('Twitch chat message must be a non-empty string.');
    }

    const token = await getAppAccessToken(config);
    try {
        const response = await axios.post('https://api.twitch.tv/helix/chat/messages', {
            broadcaster_id: String(broadcasterId),
            sender_id: String(senderId),
            message,
            for_source_only: true
        }, {
            headers: {
                'Client-Id': clientId,
                Authorization: `Bearer ${token}`
            }
        });

        const result = response.data?.data?.[0];
        if (!result?.is_sent) {
            const reason = result?.drop_reason?.message || result?.drop_reason?.code || 'Twitch dropped the message.';
            throw new Error(reason);
        }

        return result;
    } catch (error) {
        const details = error.response?.data?.message || error.response?.data?.error || error.message;
        const authorizationHint = error.response?.status === 401
            ? ' Confirm the app has user:write:chat and user:bot authorization for the bot, and channel:bot authorization for the broadcaster (unless the bot is a moderator).'
            : '';
        throw new Error(`Twitch source-only chat send failed: ${details}.${authorizationHint}`);
    }
}

module.exports = { sendSourceOnlyMessage };
