const axios = require('axios');
const cheerio = require('cheerio');
const { EmbedBuilder } = require('discord.js');
const configLoader = require('./configLoader');
const { updateLiveRoles } = require('../utils/liveRoleManager');

/**
 * RumbleBot (rewritten)
 *
 * Key improvements in live detection:
 * - Primary: Detect 3xx redirect from /user/{username}/live to /v/... (maxRedirects: 0)
 * - Secondary: Detect meta-refresh or canonical/og:url pointing to /v/... on /live page
 * - Tertiary: Detect JSON-LD BroadcastEvent/isLiveBroadcast on /live or video page
 * - Fallback: Detect embedded players (iframe /embed/, rumble-player tags)
 * - Finalize: If live URL found, fetch the actual video page for title/thumbnail/category/avatar
 *
 * Public API preserved for commands and initialization
 */
class RumbleBot {
  constructor(client) {
    this.client = client;
    this.config = configLoader.config || {};

    this.guildStreamers = new Map(); // Map<guildId, { streamers: Array<...> }>
    this.streamerStatus = new Map(); // Map<username, { isLive, title, viewers, thumbnail, liveStreamUrl, ... }>

    this.DEBUG = /^(1|true)$/i.test(String(process.env.ASSISTABOT_DEBUG || ''));

    // Special handling for problematic streamers
    this.problematicStreamers = new Set([
      'sonoflibertyradio',
      'unoraptormon'
    ]);

    // Rotating user agents to avoid detection
    this.userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15'
    ];
    this.currentUserAgentIndex = 0;

    // TTL-based forced offline map (username -> expiresAt)
    this.forcedOffline = new Map();
    this.FORCE_TTL_MS = 5 * 60 * 1000; // 5 minutes

    this.lastStatusLog = new Map(); // reduce console spam

    // Load persist data
    this.loadStreamerData();

  }

  // ---------------- Persistence ----------------
  loadStreamerData() {
    try {
      const fs = require('fs');
      const path = require('path');
      const dataPath = path.join(__dirname, '..', 'data', 'rumble_streamers.json');

      if (fs.existsSync(dataPath)) {
        const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
        this.guildStreamers = new Map(Object.entries(data));

        for (const [, guildData] of this.guildStreamers.entries()) {
          for (const streamer of guildData.streamers) {
            if (typeof streamer.cooldown === 'undefined') {
              streamer.cooldown = 0;
            }
            if (typeof streamer.lastNotifiedAt === 'undefined') {
              streamer.lastNotifiedAt = 0;
            }
            const key = streamer.username.toLowerCase();
            if (!this.streamerStatus.has(key)) {
              this.streamerStatus.set(key, { isLive: false, title: '', viewers: 0, thumbnail: '' });
            }
          }
        }

      }
    } catch (err) {
      console.error('[Rumble] Error loading streamer data:', err.message);
    }
  }

  saveStreamerData() {
    try {
      const fs = require('fs');
      const path = require('path');
      const dataPath = path.join(__dirname, '..', 'data', 'rumble_streamers.json');
      const data = Object.fromEntries(this.guildStreamers);
      fs.writeFileSync(dataPath, JSON.stringify(data, null, 2));
    } catch (err) {
      console.error('[Rumble] Error saving streamer data:', err.message);
    }
  }

  // ---------------- Guild Settings ----------------
  isGuildEnabled(guildId) {
    const guildData = this.guildStreamers.get(guildId);
    return guildData ? (guildData.enabled !== false) : true; // Default to enabled
  }

  setGuildEnabled(guildId, enabled) {
    try {
      if (!this.guildStreamers.has(guildId)) {
        this.guildStreamers.set(guildId, { streamers: [], enabled });
      } else {
        const guildData = this.guildStreamers.get(guildId);
        guildData.enabled = enabled;
      }
      this.saveStreamerData();
      return true;
    } catch (err) {
      console.error('[Rumble] Error setting guild enabled state:', err.message);
      return false;
    }
  }

  // ---------------- CRUD API ----------------
  addStreamer(username, guildId, channelId, customMessage = '', discordUsername = '', liveRoles = [], cleanup = false, cooldown = 0) {
    try {
      const normalized = username.toLowerCase().trim();
      if (!this.guildStreamers.has(guildId)) this.guildStreamers.set(guildId, { streamers: [] });

      const guildData = this.guildStreamers.get(guildId);
      if (guildData.streamers.some(s => s.username === normalized)) {
        return false;
      }

      guildData.streamers.push({
        username: normalized,
        channelId,
        customMessage,
        discordUsername,
        liveRoles: Array.isArray(liveRoles) ? liveRoles : [],
        cleanup: false,
        cooldown: Number(cooldown) || 0,
        messageId: null,
        lastNotifiedAt: 0
      });

      this.streamerStatus.set(normalized, { isLive: false, title: '', viewers: 0, thumbnail: '' });
      this.saveStreamerData();
      return true;
    } catch (err) {
      console.error('[Rumble] Error adding streamer:', err.message);
      return false;
    }
  }

  editStreamer(username, guildId, updates = {}) {
    try {
      const normalized = username.toLowerCase().trim();
      if (!this.guildStreamers.has(guildId)) return false;
      const guildData = this.guildStreamers.get(guildId);
      const streamer = guildData.streamers.find(s => s.username === normalized);
      if (!streamer) return false;

      if (updates.customMessage !== undefined) streamer.customMessage = updates.customMessage;
      if (updates.discordUsername !== undefined) streamer.discordUsername = updates.discordUsername;
      if (updates.liveRoles !== undefined) streamer.liveRoles = Array.isArray(updates.liveRoles) ? updates.liveRoles : [];
      if (updates.channelId !== undefined) streamer.channelId = updates.channelId;
      if (updates.cleanup !== undefined) streamer.cleanup = updates.cleanup;
      if (updates.cooldown !== undefined) streamer.cooldown = Number(updates.cooldown) || 0;

      this.saveStreamerData();
      return true;
    } catch (err) {
      console.error('[Rumble] Error editing streamer:', err.message);
      return false;
    }
  }

  getStreamer(username, guildId) {
    const normalized = username.toLowerCase().trim();
    return this.guildStreamers.get(guildId)?.streamers.find(streamer => streamer.username === normalized) || null;
  }

  removeStreamer(username, guildId) {
    try {
      const normalized = username.toLowerCase().trim();
      if (!this.guildStreamers.has(guildId)) return false;

      const guildData = this.guildStreamers.get(guildId);
      const before = guildData.streamers.length;
      guildData.streamers = guildData.streamers.filter(s => s.username !== normalized);
      if (guildData.streamers.length === 0) this.guildStreamers.delete(guildId);

      // If no guild tracks this streamer anymore, drop status cache
      let stillTracked = false;
      for (const [, other] of this.guildStreamers.entries()) {
        if (other.streamers.some(s => s.username === normalized)) { stillTracked = true; break; }
      }
      if (!stillTracked) this.streamerStatus.delete(normalized);

      this.saveStreamerData();
      return before !== guildData.streamers.length;
    } catch (err) {
      console.error('[Rumble] Error removing streamer:', err.message);
      return false;
    }
  }

  listStreamers(guildId) {
    const out = [];
    if (!this.guildStreamers.has(guildId)) return out;
    const guildData = this.guildStreamers.get(guildId);
    for (const streamer of guildData.streamers) {
      const status = this.streamerStatus.get(streamer.username) || { isLive: false };
      out.push({
        username: streamer.username,
        isLive: !!status.isLive,
        title: status.title || 'N/A',
        viewers: status.viewers || 0
      });
    }
    return out;
  }

  // ---------------- HTTP helpers ----------------
  getDefaultHeaders() {
    // Rotate user agent for each request
    const userAgent = this.userAgents[this.currentUserAgentIndex];
    this.currentUserAgentIndex = (this.currentUserAgentIndex + 1) % this.userAgents.length;
    
    
    return {
      'User-Agent': userAgent,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      'Sec-Ch-Ua': '"Not A(Brand";v="99", "Google Chrome";v="121", "Chromium";v="121"',
      'Sec-Ch-Ua-Mobile': '?0',
      'Sec-Ch-Ua-Platform': '"Windows"',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1'
    };
  }

  buildAbsolute(base, url) {
    if (!url) return null;
    try {
      if (/^https?:\/\//i.test(url)) return url;
      // Absolute from rumble.com root
      if (url.startsWith('/')) return `https://rumble.com${url}`;
      // Otherwise try URL constructor
      return new URL(url, base).href;
    } catch { return null; }
  }

  async tryGetNoRedirect(url) {
    try {
      const res = await axios.get(url, {
        headers: this.getDefaultHeaders(),
        timeout: 15000,
        maxRedirects: 0,
        validateStatus: s => s >= 200 && s < 400 // consider 3xx valid so we can inspect Location
      });
      return res;
    } catch (err) {
      // If axios followed redirect or considered invalid, err.response may still be present
      if (err && err.response) return err.response;
      throw err;
    }
  }

  async tryGetNoRedirectWithRetry(url, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const res = await this.tryGetNoRedirect(url);
        
        // If we get 403, wait and retry
        if (res.status === 403 && attempt < maxRetries) {
          await new Promise(r => setTimeout(r, attempt * 2000)); // Exponential backoff
          continue;
        }
        
        return res;
      } catch (err) {
        if (attempt === maxRetries) throw err;
        await new Promise(r => setTimeout(r, attempt * 2000));
      }
    }
  }

  async tryGet(url) {
    const res = await axios.get(url, {
      headers: this.getDefaultHeaders(),
      timeout: 15000
    });
    return res;
  }

  // ---------------- Detection core ----------------
  parseMetaRefresh($) {
    try {
      const tag = $('meta[http-equiv="refresh"], meta[http-equiv="Refresh"]').attr('content') || '';
      // format: "0;url=/vxxxxx-title.html"
      const m = tag.match(/url\s*=\s*([^;]+)$/i);
      if (m && m[1]) return m[1].trim().replace(/^"|"$/g, '');
    } catch {}
    return null;
  }

  parseCanonicalOrOgUrl($) {
    try {
      const can = $('link[rel="canonical"]').attr('href');
      const og = $('meta[property="og:url"]').attr('content');
      return can || og || null;
    } catch {}
    return null;
  }

  anyEmbedPlayer($, html) {
    try {
      if ($('iframe[src*="/embed/"]').length > 0) return true;
      if ($('rumble-player, rumble-embed, .video-player, #videoplayer, .stream-player--live, #rmpPlayer, .rmp-player').length > 0) return true;
      if ($('[data-video-id], [data-videoid], [data-value*="video"], [data-value*="v"]').length > 0) return true;
      if ($('meta[property="og:video"], meta[name="twitter:player"]').length > 0) return true;
      if (typeof html === 'string' && /\/embed\//i.test(html)) return true;
      if (typeof html === 'string' && /(data-video-id|rumble-player|twitter:player|og:video)/i.test(html)) return true;
    } catch {}
    return false;
  }

  anyJsonLdLive($) {
    try {
      const scripts = $('script[type="application/ld+json"]').toArray();
      for (const el of scripts) {
        const txt = $(el).text();
        try {
          const data = JSON.parse(txt);
          const arr = Array.isArray(data) ? data : [data];
          for (const obj of arr) {
            if (obj && typeof obj === 'object') {
              if (obj.isLiveBroadcast === true) return true;
              if (obj['@type'] === 'BroadcastEvent') {
                if (obj.isLiveBroadcast === true) return true;
                if (obj.eventStatus === 'http://schema.org/EventInProgress') return true;
              }
            }
          }
        } catch {}
      }
    } catch {}
    return false;
  }

  async extractVideoDetails(liveUrl) {
    const details = { title: '', thumbnail: '', category: '', rumbleAvatar: null };
    try {
      const resp = await this.tryGet(liveUrl);
      const $ = cheerio.load(resp.data);

      // Title
      details.title = $('meta[property="og:title"]').attr('content') || $('h1, h2, h3').first().text().trim() || '';
      if (!details.title) details.title = 'Live Stream';

      // Thumbnail
      details.thumbnail = $('meta[property="og:image"]').attr('content') || $('.thumbnail__thumb img, .videostream__thumb img').first().attr('src') || '';
      if (details.thumbnail && !/^https?:\/\//i.test(details.thumbnail)) details.thumbnail = this.buildAbsolute(liveUrl, details.thumbnail);

      // Category (best effort)
      try {
        const scripts = $('script[type="application/ld+json"]').toArray();
        for (const el of scripts) {
          const txt = $(el).text();
          try {
            const data = JSON.parse(txt);
            const obj = Array.isArray(data) ? data.find(x => x.category || (x.genre && typeof x.genre === 'string')) : data;
            if (obj) {
              details.category = obj.category || obj.genre || '';
              if (details.category) break;
            }
          } catch {}
        }
      } catch {}

      // Channel avatar
      try {
        const avatar = $('img.channel-header--img, .author__img img').first().attr('src') || '';
        if (avatar) details.rumbleAvatar = /^https?:\/\//i.test(avatar) ? avatar : this.buildAbsolute(liveUrl, avatar);
      } catch {}
    } catch (err) {
      // Error extracting video details
    }
    return details;
  }

  async detectLive(username) {
    const normalized = username.toLowerCase().trim();
    const livePage = `https://rumble.com/user/${normalized}/live`;
    const isProblematic = this.problematicStreamers.has(normalized);


    // 1) Try redirect-based detection (strongest, lightweight)
    try {
      const res = await this.tryGetNoRedirectWithRetry(livePage);
      const status = res.status;
      const loc = res.headers && (res.headers.location || res.headers.Location);
      
      // Check for key indicators in raw HTML
      if (res.data) {
        const hasJsonLd = res.data.includes('application/ld+json');
        const hasBroadcastEvent = res.data.includes('BroadcastEvent');
        const hasIsLive = res.data.includes('isLiveBroadcast');
        const hasPlayer = res.data.includes('rumble-player') || res.data.includes('iframe');
      }
      
      const finalUrl = (() => {
        try { return (res.request && res.request.res && res.request.res.responseUrl) || livePage; } catch { return livePage; }
      })();

      if (status >= 300 && status < 400 && loc) {
        const abs = this.buildAbsolute(livePage, loc);
        if (abs && /\/v\//i.test(abs)) {
          const details = await this.extractVideoDetails(abs);
          return { isLive: true, liveStreamUrl: abs, ...details };
        }
      }

      // 2) If 200 OK, check meta-refresh or canonical/og:url
      if (status === 200 && res.data) {
        const $ = cheerio.load(res.data);
        const metaUrl = this.parseMetaRefresh($);
        const canonicalUrl = this.parseCanonicalOrOgUrl($);
        const candidate = metaUrl || canonicalUrl;
        const abs = this.buildAbsolute(livePage, candidate);
        if (abs && /\/v\//i.test(abs)) {
          const details = await this.extractVideoDetails(abs);
          return { isLive: true, liveStreamUrl: abs, ...details };
        }

        // 3) JSON-LD live or embedded player presence -> infer live, try to find a /v/ link in-page
        const hasLdLive = this.anyJsonLdLive($);
        const hasPlayer = this.anyEmbedPlayer($, res.data);
        
        // For problematic streamers, require both JSON-LD live AND player presence
        const hasStrongIndicators = isProblematic ? (hasLdLive && hasPlayer) : (hasLdLive || hasPlayer);
        
        if (hasStrongIndicators) {
          // Attempt to pull a likely /v/... link
          let liveUrl = null;
          const anchors = $('a[href*="/v/"]');
          if (anchors.length > 0) {
            const href = anchors.first().attr('href');
            const absHref = this.buildAbsolute(livePage, href);
            if (absHref && /\/v\//i.test(absHref)) liveUrl = absHref;
          }
          if (!liveUrl) {
            // fallback to canonical/og:url even if not strictly /v/
            const og = $('meta[property="og:url"]').attr('content');
            const absOg = this.buildAbsolute(livePage, og);
            if (absOg && /\/v\//i.test(absOg)) liveUrl = absOg;
          }
          if (!liveUrl) {
            // try og:video or twitter:player
            const ogVideo = $('meta[property="og:video"]').attr('content') || $('meta[name="twitter:player"]').attr('content');
            const absVid = this.buildAbsolute(livePage, ogVideo);
            if (absVid && /\/v\//i.test(absVid)) liveUrl = absVid;
          }
          if (!liveUrl) {
            // regex scan for /v links in raw HTML
            const m = String(res.data).match(/href=["'](\/v[^"'>\s]+)["']/i);
            if (m && m[1]) {
              const abs = this.buildAbsolute(livePage, m[1]);
              if (abs && /\/v\//i.test(abs)) liveUrl = abs;
            }
          }

          if (liveUrl) {
            const details = await this.extractVideoDetails(liveUrl);
            return { isLive: true, liveStreamUrl: liveUrl, ...details };
          } else {
            // For problematic streamers, don't use /live as fallback - require actual /v/ link
            if (!isProblematic) {
              // As last resort, treat /live as the stream URL when strong live indicators exist
              const details = await this.extractVideoDetails(livePage);
              return { isLive: true, liveStreamUrl: livePage, ...details };
            }
          }
        }
      }
    } catch (err) {
      // Error in primary detection
    }

    // 4) Fallback: check main channel page for signals
    try {
      const channelUrl = `https://rumble.com/${normalized}`;
      const res = await this.tryGetNoRedirect(channelUrl);
      const status = res.status;
      const loc = res.headers && (res.headers.location || res.headers.Location);
      if (status >= 300 && status < 400 && loc) {
        const abs = this.buildAbsolute(channelUrl, loc);
        if (abs && /\/v\//i.test(abs)) {
          const details = await this.extractVideoDetails(abs);
          return { isLive: true, liveStreamUrl: abs, ...details };
        }
      }
      if (status === 200 && res.data) {
        const $ = cheerio.load(res.data);
        const can = this.parseCanonicalOrOgUrl($);
        const abs = this.buildAbsolute(channelUrl, can);
        if (abs && /\/v\//i.test(abs)) {
          const details = await this.extractVideoDetails(abs);
          return { isLive: true, liveStreamUrl: abs, ...details };
        }
        const hasLdLive = this.anyJsonLdLive($);
        const hasPlayer = this.anyEmbedPlayer($, res.data);
        if (hasLdLive || hasPlayer) {
          let liveUrl = null;
          const a = $('a[href*="/v/"]').first().attr('href');
          const absA = this.buildAbsolute(channelUrl, a);
          if (absA && /\/v\//i.test(absA)) liveUrl = absA;
          if (liveUrl) {
            const details = await this.extractVideoDetails(liveUrl);
            return { isLive: true, liveStreamUrl: liveUrl, ...details };
          }
        }
      }
    } catch (err) {
      // Error in fallback detection
    }

    // Not live
    return { isLive: false, title: '', viewers: 0, thumbnail: '', liveStreamUrl: `https://rumble.com/${normalized}` };
  }

  async checkStreamerStatus(username) {
    // Clear expired forced flags
    const key = username.toLowerCase();
    const forcedUntil = this.forcedOffline.get(key);
    if (forcedUntil && forcedUntil < Date.now()) this.forcedOffline.delete(key);

    const status = await this.detectLive(key);

    // Respect forced offline only if not live and within TTL
    const isForcedActive = this.forcedOffline.has(key);
    const finalIsLive = isForcedActive ? false : status.isLive;

    const now = Date.now();
    const lastLogTime = this.lastStatusLog.get(key) || 0;
    const prev = this.streamerStatus.get(key) || { isLive: false };
    const changed = !!prev.isLive !== !!finalIsLive;
    const cooldown = 60 * 60 * 1000; // 1 hour
    if (finalIsLive && (changed || (now - lastLogTime > cooldown))) {
      this.lastStatusLog.set(key, now);
    }

    return {
      isLive: finalIsLive,
      title: status.title || '',
      viewers: 0,
      thumbnail: status.thumbnail || '',
      category: status.category || '',
      liveStreamUrl: status.liveStreamUrl || `https://rumble.com/${key}`,
      rumbleAvatar: status.rumbleAvatar || null,
      lastCheck: new Date().toISOString(),
      username: key
    };
  }

  async confirmLiveStatus(username, delayMs = 20000) {
    try {
      await new Promise(r => setTimeout(r, delayMs));
      return await this.checkStreamerStatus(username);
    } catch {
      return { isLive: false, title: '', viewers: 0, thumbnail: '', liveStreamUrl: `https://rumble.com/${username.toLowerCase()}`, username: username.toLowerCase() };
    }
  }

  // ---------------- Monitoring ----------------
  async checkAllStreamers() {
    if (this.guildStreamers.size === 0) return;

    const all = new Set();
    for (const [, guildData] of this.guildStreamers.entries()) {
      // Skip disabled guilds
      if (guildData.enabled === false) continue;
      for (const s of guildData.streamers) all.add(s.username);
    }

    // Add random delay between streamer checks to avoid detection
    let delay = 0;
    for (const username of all) {
      if (delay > 0) {
        const randomDelay = Math.random() * 2000 + 1000; // 1-3 seconds random
        await new Promise(r => setTimeout(r, randomDelay));
      }
      
      try {
        const oldStatus = this.streamerStatus.get(username) || { isLive: false };
        const newStatus = await this.checkStreamerStatus(username);
        delay += 1;

        if (newStatus.isLive && !oldStatus.isLive) {
          const confirmed = await this.confirmLiveStatus(username, 20000);
          if (confirmed.isLive) {
            await this.notifyStreamerLive(username, confirmed);
          }
          this.streamerStatus.set(username, confirmed);
          continue;
        }

        if (newStatus.isLive) {
          for (const [guildId, guildData] of this.guildStreamers.entries()) {
            if (guildData.enabled === false) continue;
            const streamer = guildData.streamers.find(item => item.username === username);
            if (streamer) {
              await updateLiveRoles(this.client, guildId, streamer.discordUsername, streamer.liveRoles, 'add', `Rumble ${username} went live`, 'Rumble');
            }
          }
        }

        if (!newStatus.isLive && oldStatus.isLive) {
          await this.notifyStreamerOffline(username, newStatus);
        }

        this.streamerStatus.set(username, newStatus);
      } catch (err) {
        console.error(`[Rumble] Error checking ${username}:`, err.message);
      }
    }

  }

  startMonitoring(intervalMs = 5 * 60 * 1000) {
    if (this.monitoringInterval) {
      console.warn('[Rumble] Monitoring already started');
      return;
    }


    this.checkAllStreamers().catch(err => console.error('[Rumble] Initial check error:', err.message));
    this.monitoringInterval = setInterval(() => {
      this.checkAllStreamers().catch(err => console.error('[Rumble] Monitoring error:', err.message));
    }, intervalMs);

  }

  stopMonitoring() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
  }

// ... (rest of the code remains the same)
  // ---------------- Status/Commands API ----------------
  getStreamerStatus(username) {
    return this.streamerStatus.get(username.toLowerCase()) || { isLive: false, title: '', viewers: 0 };
  }

  async manualCheck(username) {
    const key = username.toLowerCase();
    // Clear sticky states for immediate truth
    this.forcedOffline.delete(key);

    const status = await this.checkStreamerStatus(key);
    const old = this.streamerStatus.get(key) || { isLive: false };
    if (status.isLive && !old.isLive) {
      await this.notifyStreamerLive(key, status);
    }
    this.streamerStatus.set(key, status);
    return status;
  }

  forceOffline(username) {
    const key = username.toLowerCase().trim();
    this.streamerStatus.set(key, { isLive: false, title: '', viewers: 0, thumbnail: '' });
    this.forcedOffline.set(key, Date.now() + this.FORCE_TTL_MS);
  }

  // ---------------- Notifications ----------------
  async notifyStreamerLive(username, status) {
    let success = 0;

    for (const [guildId, guildData] of this.guildStreamers.entries()) {
      // Skip if guild is disabled
      if (guildData.enabled === false) {
        continue;
      }

      const streamer = guildData.streamers.find(s => s.username === username);
      if (!streamer) continue;

      try {
        const channel = await this.client.channels.fetch(streamer.channelId);
        if (!channel || !channel.isTextBased()) continue;

        const streamURL = status.liveStreamUrl || `https://rumble.com/${username}`;
        const embed = new EmbedBuilder()
          .setTitle(status.title || 'Live Stream')
          .setURL(streamURL)
          .setColor('#85C742');

        if (status.rumbleAvatar) {
          embed.setAuthor({ name: `${username} is now broadcasting on Rumble!`, iconURL: status.rumbleAvatar, url: streamURL });
        }
        if (status.category) embed.setDescription(`Playing ${status.category}`);
        if (status.thumbnail) embed.setImage(status.thumbnail);

        let content = '';
        if (streamer.customMessage) {
          content = streamer.customMessage
            .replace(/\{streamer\}/g, username)
            .replace(/\{url\}/g, streamURL)
            .replace(/\{platform\}/g, 'Rumble')
            .replace(/\{title\}/g, status.title || '')
            .replace(/\{game\}/g, status.category || '');
        }

        const msg = await channel.send({ content: content || undefined, embeds: [embed] });
        success++;

        if (streamer.cleanup) {
          streamer.messageId = msg.id;
          this.saveStreamerData();
        }

        // Role assignment if configured
        await updateLiveRoles(this.client, guildId, streamer.discordUsername, streamer.liveRoles, 'add', `Rumble ${username} went live`, 'Rumble');
      } catch (err) {
        console.error(`[Rumble] Error sending notification to channel ${streamer.channelId}:`, err.message);
      }
    }

  }

  async notifyStreamerOffline(username, status) {
    for (const [guildId, guildData] of this.guildStreamers.entries()) {
      // Skip if guild is disabled
      if (guildData.enabled === false) continue;

      const streamer = guildData.streamers.find(s => s.username === username);
      if (!streamer) continue;

      if (streamer.cleanup && streamer.messageId) {
        try {
          const channel = await this.client.channels.fetch(streamer.channelId);
          if (channel?.isTextBased()) {
            const message = await channel.messages.fetch(streamer.messageId).catch(() => null);
            if (message) await message.delete();
          }
          streamer.messageId = null;
          this.saveStreamerData();
        } catch (err) {
          console.error(`[Rumble] Error deleting message:`, err.message);
        }
      }

      await updateLiveRoles(this.client, guildId, streamer.discordUsername, streamer.liveRoles, 'remove', `Rumble ${username} went offline`, 'Rumble');

    }
  }
}

module.exports = RumbleBot;