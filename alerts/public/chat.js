const chatContainer = document.getElementById('chat');
const query = new URLSearchParams(window.location.search);
const messageLimit = Math.max(1, Math.min(30, Number(query.get('limit')) || 8));
const duration = Math.max(0, Math.min(600, Number(query.get('duration')) || 45)) * 1000;
const fontSize = Math.max(12, Math.min(48, Number(query.get('fontSize')) || 22));
document.documentElement.style.fontSize = `${fontSize}px`;

const platformIcons = {
    twitch: '<svg class="platform-icon platform-twitch" viewBox="0 0 24 24" aria-label="Twitch"><path d="M4 2 2 6v14h5v3h3l3-3h4l5-5V2H4zm16 12-3 3h-5l-3 3v-3H5V4h15v10zM10 7h2v6h-2zm5 0h2v6h-2z"/></svg>',
    youtube: '<svg class="platform-icon platform-youtube" viewBox="0 0 24 24" aria-label="YouTube"><path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2 31 31 0 0 0 0 12a31 31 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 12a31 31 0 0 0-.5-5.8zM9.6 15.6V8.4l6.3 3.6-6.3 3.6z"/></svg>',
    kick: '<svg class="platform-icon platform-kick" viewBox="0 0 24 24" aria-label="Kick"><path d="M3 2h7v7l5-7h8l-7 9 7 11h-8l-5-8v8H3z"/></svg>'
};

function appendText(parent, text) {
    if (text) parent.appendChild(document.createTextNode(text));
}

function appendEmote(parent, emote, platform) {
    const image = document.createElement('img');
    image.className = 'chat-emote';
    image.alt = emote.name || 'emote';
    image.loading = 'lazy';
    image.src = platform === 'twitch'
        ? `https://static-cdn.jtvnw.net/emoticons/v2/${encodeURIComponent(emote.id)}/default/dark/2.0`
        : `https://files.kick.com/emotes/${encodeURIComponent(emote.id)}/fullsize`;
    parent.appendChild(image);
}

function appendKickEmotes(parent, text) {
    const tokenPattern = /\[emote:(\d+):([^\]]+)\]/g;
    let cursor = 0;
    let match;
    while ((match = tokenPattern.exec(text)) !== null) {
        appendText(parent, text.slice(cursor, match.index));
        appendEmote(parent, { id: match[1], name: match[2] }, 'kick');
        cursor = match.index + match[0].length;
    }
    appendText(parent, text.slice(cursor));
}

function appendTwitchEmotes(parent, text, emotes) {
    const ranges = (emotes || [])
        .filter((emote) => Number.isInteger(emote.start) && Number.isInteger(emote.end))
        .sort((a, b) => a.start - b.start);
    let cursor = 0;
    for (const emote of ranges) {
        if (emote.start < cursor || emote.end >= text.length) continue;
        appendText(parent, text.slice(cursor, emote.start));
        appendEmote(parent, { id: emote.id }, 'twitch');
        cursor = emote.end + 1;
    }
    appendText(parent, text.slice(cursor));
}

function renderBadges(parent, badges) {
    const list = document.createElement('span');
    list.className = 'badge-list';
    for (const badge of badges || []) {
        if (badge.image && /^https:\/\/static-cdn\.jtvnw\.net\//.test(badge.image)) {
            const image = document.createElement('img');
            image.className = 'chat-badge';
            image.src = badge.image;
            image.alt = badge.label || 'Badge';
            image.title = badge.label || 'Badge';
            image.loading = 'lazy';
            list.appendChild(image);
        } else if (badge.label) {
            const label = document.createElement('span');
            label.className = 'chat-badge-label';
            label.textContent = badge.label;
            list.appendChild(label);
        }
    }
    if (list.childElementCount) parent.appendChild(list);
}

function renderMessage(message) {
    if (!['twitch', 'youtube', 'kick'].includes(message.platform) || !message.text) return;

    const row = document.createElement('article');
    row.className = 'chat-message';

    const header = document.createElement('span');
    header.className = 'chat-header';
    header.innerHTML = platformIcons[message.platform];

    renderBadges(header, message.badges);

    const username = document.createElement('span');
    username.className = 'username';
    username.textContent = message.username || 'Unknown';
    if (/^#[0-9a-f]{6}$/i.test(message.color || '')) {
        username.style.color = message.color;
    }
    header.appendChild(username);
    row.appendChild(header);

    const body = document.createElement('span');
    body.className = 'chat-text';
    if (message.platform === 'twitch') {
        appendTwitchEmotes(body, message.text, message.emotes);
    } else if (message.platform === 'kick') {
        appendKickEmotes(body, message.text);
    } else {
        appendText(body, message.text);
    }
    row.appendChild(body);

    chatContainer.appendChild(row);
    while (chatContainer.childElementCount > messageLimit) {
        chatContainer.firstElementChild.remove();
    }

    if (duration > 0) {
        window.setTimeout(() => {
            row.classList.add('fading');
            window.setTimeout(() => row.remove(), 500);
        }, duration);
    }
}

let reconnectDelay = 1000;
function connect() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${window.location.host}/ws`);
    socket.addEventListener('open', () => {
        reconnectDelay = 1000;
    });
    socket.addEventListener('message', (event) => {
        try {
            const payload = JSON.parse(event.data);
            if (payload.type === 'chat') renderMessage(payload);
        } catch (error) {
            console.error('[Chat Overlay] Invalid server message:', error);
        }
    });
    socket.addEventListener('close', () => {
        window.setTimeout(connect, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, 30000);
    });
    socket.addEventListener('error', () => socket.close());
}

connect();