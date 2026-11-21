const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SONG_STATE_PATH = path.join(__dirname, '..', 'data', 'current_youtube_song.json');
const MAX_SONG_AGE_MS = 60 * 1000;
const MAX_CLOCK_SKEW_MS = 2 * 60 * 1000;
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

function getSignaturePayload(song) {
    return [
        String(song.timestamp),
        song.videoId,
        song.title,
        song.artist || '',
        song.isPlaying ? '1' : '0'
    ].join('\n');
}

function verifyUpdate(song, signature, secret, now = Date.now()) {
    if (!song || typeof song !== 'object' || Array.isArray(song) ||
        typeof secret !== 'string' || secret.length < 32 ||
        typeof song.videoId !== 'string' ||
        typeof song.title !== 'string' ||
        typeof song.artist !== 'string' ||
        typeof song.isPlaying !== 'boolean') {
        return false;
    }

    const timestamp = Number(song.timestamp);
    if (!Number.isSafeInteger(timestamp) || Math.abs(now - timestamp) > MAX_CLOCK_SKEW_MS) {
        return false;
    }
    if ((song.videoId && !VIDEO_ID_PATTERN.test(song.videoId)) ||
        song.videoId.length > 11 ||
        song.title.length > 300 ||
        song.artist.length > 200 ||
        (song.isPlaying && (!song.videoId || !song.title.trim()))) {
        return false;
    }
    if (typeof signature !== 'string' || !/^[a-f0-9]{64}$/i.test(signature)) {
        return false;
    }

    const expected = crypto.createHmac('sha256', secret)
        .update(getSignaturePayload(song))
        .digest();
    const received = Buffer.from(signature, 'hex');
    return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}

function readState() {
    if (!fs.existsSync(SONG_STATE_PATH)) return null;
    return JSON.parse(fs.readFileSync(SONG_STATE_PATH, 'utf8'));
}

function cleanText(value) {
    return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
}

function saveUpdate(song) {
    const timestamp = Number(song.timestamp);
    const existing = readState();
    if (existing && Number(existing.updatedAt) >= timestamp) {
        const error = new Error('Stale song update');
        error.code = 'STALE_SONG_UPDATE';
        throw error;
    }

    const state = {
        videoId: song.videoId,
        title: cleanText(song.title).slice(0, 200),
        artist: cleanText(song.artist).slice(0, 150),
        isPlaying: song.isPlaying,
        updatedAt: timestamp
    };
    const temporaryPath = `${SONG_STATE_PATH}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(state), 'utf8');
    fs.renameSync(temporaryPath, SONG_STATE_PATH);
    return state;
}

function getCurrentSong(now = Date.now()) {
    const state = readState();
    if (!state || !state.isPlaying || !state.title ||
        !Number.isFinite(Number(state.updatedAt))) {
        return null;
    }

    const age = now - Number(state.updatedAt);
    if (age > MAX_SONG_AGE_MS || age < -MAX_CLOCK_SKEW_MS) {
        return null;
    }

    return {
        title: cleanText(String(state.title)).slice(0, 200),
        artist: cleanText(String(state.artist || '')).slice(0, 150)
    };
}

module.exports = { getCurrentSong, saveUpdate, verifyUpdate };
