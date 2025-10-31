const fetch = require('node-fetch');

// In-memory cache: { url => { data, timestamp } }
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const FETCH_TIMEOUT = 5000; // 5 seconds
const MAX_RESPONSE_SIZE = 1024 * 1024; // 1MB

// Add detailed debug logging
const debug = false; // Set to false to disable debug logs

function getCachedOrFetch(url) {
    if (debug) console.log('urlFetcher: getCachedOrFetch called with URL:', url);
    
    const now = Date.now();
    const cached = cache.get(url);
    if (cached && now - cached.timestamp < CACHE_TTL) {
        if (debug) console.log('urlFetcher: Returning cached data');
        return Promise.resolve(cached.data);
    }

    // Clear expired entries
    for (const [key, value] of cache.entries()) {
        if (now - value.timestamp >= CACHE_TTL) {
            cache.delete(key);
        }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

    if (debug) console.log('urlFetcher: Starting fresh fetch');
    
    return fetch(url, { 
        signal: controller.signal,
        headers: {
            'User-Agent': 'DiscordBot (AssistaBot Custom Commands)',
            'Accept': 'text/plain, application/json, */*'
        }
    })
        .then(res => {
            if (debug) {
                console.log('urlFetcher: Response received -', {
                    status: res.status,
                    statusText: res.statusText,
                    contentType: res.headers.get('content-type'),
                    contentLength: res.headers.get('content-length')
                });
            }
            if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
            const contentLength = res.headers.get('content-length');
            if (contentLength && Number(contentLength) > MAX_RESPONSE_SIZE) {
                throw new Error('Response too large');
            }
            return res.text();
        })
        .then(text => {
            clearTimeout(timeout);
            // Store in cache
            cache.set(url, {
                data: text,
                timestamp: now
            });
            return text;
        })
        .catch(err => {
            clearTimeout(timeout);
            throw err;
        });
}

function getJsonValue(obj, path) {
    if (!path) return obj;
    const parts = path.split('.');
    let current = obj;
    for (const part of parts) {
        if (current === null || current === undefined) return undefined;
        current = current[part];
    }
    return current;
}

async function fetchJson(url, path) {
    try {
        const text = await getCachedOrFetch(url);
        const data = JSON.parse(text);
        return path ? getJsonValue(data, path) : data;
    } catch (e) {
        console.warn('urlFetch error:', e.message, 'url:', url);
        return null;
    }
}

async function fetchText(url) {
    try {
        if (debug) console.log('urlFetcher: Attempting to fetch text from URL:', url);
        const result = await getCachedOrFetch(url);
        if (debug) console.log('urlFetcher: Fetch successful, content length:', result ? result.length : 0);
        return result;
    } catch (e) {
        console.warn('urlFetch error:', e.message, 'url:', url);
        return null;
    }
}

module.exports = {
    fetchJson,
    fetchText,
    getCachedOrFetch
};