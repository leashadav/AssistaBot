const fetch = require('node-fetch');

// In-memory cache: { url => { data, timestamp } }
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const FETCH_TIMEOUT = 8000; // 8 seconds
const MAX_RESPONSE_SIZE = 1024 * 1024; // 1MB
const MAX_RETRIES = 2; // total attempts = 1 + MAX_RETRIES

// Add detailed debug logging (enable with URLFETCHER_DEBUG=true|1)
const debug = /^(1|true)$/i.test(String(process.env.URLFETCHER_DEBUG || ''));

function pruneExpired(now) {
    for (const [key, value] of cache.entries()) {
        if (now - value.timestamp >= CACHE_TTL) cache.delete(key);
    }
}

function createAbortController(ms) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    return { controller, cancel: () => clearTimeout(timer) };
}

async function fetchWithLimits(url) {
    const { controller, cancel } = createAbortController(FETCH_TIMEOUT);
    try {
        const res = await fetch(url, {
            signal: controller.signal,
            redirect: 'follow',
            headers: {
                'User-Agent': 'DiscordBot (AssistaBot Custom Commands)',
                'Accept': 'text/plain, application/json, */*'
            }
        });
        if (debug) {
            console.log('urlFetcher: Response received -', {
                status: res.status,
                statusText: res.statusText,
                contentType: res.headers.get('content-type'),
                contentLength: res.headers.get('content-length')
            });
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText} (url: ${url})`);
        const contentLength = res.headers.get('content-length');
        if (contentLength && Number(contentLength) > MAX_RESPONSE_SIZE) {
            throw new Error(`Response too large (url: ${url})`);
        }
        // Stream and enforce max size even without content-length
        const reader = res.body && res.body.getReader ? res.body.getReader() : null;
        if (reader) {
            let received = 0; const chunks = [];
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                received += value.length || value.byteLength || 0;
                if (received > MAX_RESPONSE_SIZE) throw new Error(`Response too large (url: ${url})`);
                chunks.push(Buffer.from(value));
            }
            return Buffer.concat(chunks).toString('utf8');
        }
        return await res.text();
    } finally {
        cancel();
    }
}

async function getCachedOrFetch(url) {
    if (debug) console.log('urlFetcher: getCachedOrFetch called with URL:', url);

    const now = Date.now();
    const cached = cache.get(url);
    if (cached && now - cached.timestamp < CACHE_TTL) {
        if (debug) console.log('urlFetcher: Returning cached data');
        return cached.data;
    }

    pruneExpired(now);

    if (debug) console.log('urlFetcher: Starting fresh fetch');

    let attempt = 0;
    while (true) {
        try {
            const text = await fetchWithLimits(url);
            cache.set(url, { data: text, timestamp: Date.now() });
            return text;
        } catch (err) {
            attempt += 1;
            const isAbort = err && (err.name === 'AbortError' || /aborted/i.test(String(err.message)));
            const isRetryable = isAbort || (err && /^(5\d\d|HTTP 5\d\d)/.test(String(err.message)));
            if (debug) console.warn('urlFetcher attempt failed:', { attempt, isAbort, isRetryable, message: err.message });
            if (!isRetryable || attempt > MAX_RETRIES) {
                try { err.url = url; } catch (_) {}
                try { err.operation = 'getCachedOrFetch'; } catch (_) {}
                try { err.module = 'urlFetcher'; } catch (_) {}
                throw err;
            }
            // simple backoff
            await new Promise(r => setTimeout(r, attempt * 300));
        }
    }
}

function getJsonValue(obj, path) {
    if (!path) return obj;
    const parts = String(path).split('.');
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
        console.warn({ event: 'urlfetch_error', op: 'fetchJson', url, message: e && e.message ? e.message : String(e) });
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
        console.warn('urlFetch error:', e && e.message ? e.message : String(e), 'url:', url);
        return null;
    }
}

module.exports = {
    fetchJson,
    fetchText,
    getCachedOrFetch
};