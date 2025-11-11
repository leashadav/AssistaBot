const streamRegistry = require('./streamRegistry');
const { buildStreamEmbed } = require('./streamEmbeds');
const configLoader = require('./configLoader');
const twitchTimers = require('./twitchTimers');

class StreamNotifier {
  constructor() {
    this.interval = null;
    // state: key -> { status: 'live'|'offline', lastPostAt: ms }
    this.state = new Map();
    this.twitchToken = null;
    this.twitchTokenExpiry = 0;
    this.twitchUserIdCache = new Map(); // login -> display name/avatar
    this.twitchStreamCache = new Map(); // login -> { isLive, data, exp }
    this.twitchUserCache = new Map(); // login -> { userData, exp }
    this.youtubeHandleCache = new Map(); // handle/@name -> channelId (cached for 24h)
    this.youtubeChannelCache = new Map(); // channelId -> { avatar, title, exp }
    this.youtubeLiveCache = new Map(); // channelId -> { isLive, data, exp }
    this.youtubeVodCache = new Map(); // channelId -> { latestVideo, exp }
    this.defaultCooldownMinutes = configLoader.config.defaultCooldownMinutes || 30;
    this.lastVodByGuildChannel = new Map(); // key: `${gid}:${channelId}` -> lastVideoId posted
    this.quotaExceededUntil = 0; // timestamp when quota exceeded, pause until this time
    this.stateFile = require('path').join(__dirname, '..', 'data', 'stream-state.json');
    this.loadState();
  }

  async start(client, periodMs = configLoader.config.periodMs || 180000) { // Increased from 90s to 3 minutes
    if (this.interval) clearInterval(this.interval);
    const tick = async () => {
      try {
        await this.checkTwitch(client);
        await this.checkYouTube(client);
        await this.checkRumble(client);
        await this.checkTikTok(client);
        await this.checkKick(client);
        await this.checkInstagram(client);
        await this.checkDiscord(client);
        await this.checkFacebook(client);
        await this.checkX(client);
        await this.checkPresenceBasedYouTube(client);
        await this.checkPresenceBasedRumble(client);
        await this.checkPresenceBasedTikTok(client);
        await this.checkPresenceBasedKick(client);
        await this.checkPresenceBasedInstagram(client);
        await this.checkPresenceBasedDiscord(client);
        await this.checkPresenceBasedFacebook(client);
        await this.checkPresenceBasedX(client);
        await this.checkPresenceBasedTwitch(client);
      } catch (error) {
        // Ignore errors in tick function
      }
    };
    await tick();
    this.interval = setInterval(tick, periodMs);
  }

  stop() {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
  }

  loadState() {
    try {
      const fs = require('fs');
      if (fs.existsSync(this.stateFile)) {
        const data = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
        this.state = new Map(Object.entries(data));
      }
    } catch (error) {
      // Ignore load errors
    }
  }

  saveState() {
    try {
      const fs = require('fs');
      const data = Object.fromEntries(this.state);
      fs.writeFileSync(this.stateFile, JSON.stringify(data, null, 2));
    } catch (error) {
      // Ignore save errors
    }
  }

  clearCache() {
    this.youtubeHandleCache.clear();
    this.youtubeChannelCache.clear();
    this.youtubeLiveCache.clear();
    this.youtubeVodCache.clear();
    this.twitchUserIdCache.clear();
    this.twitchStreamCache.clear();
    this.twitchUserCache.clear();
    this.state.clear();
    this.quotaExceededUntil = 0;
    this.saveState();
  }

  key(gid, platform, id) {
    return `${gid}:${platform}:${id}`;
  }

  withinCooldown(gid, platform, id, minutes) {
    const k = this.key(gid, platform, id);
    const entry = this.state.get(k);
    if (!entry || !entry.lastPostAt) return false;
    const ms = (minutes || 0) * 60_000;
    return Date.now() - entry.lastPostAt < ms;
  }

  recordState(gid, platform, id, status, posted, messageId = null) {
    const k = this.key(gid, platform, id);
    const prev = this.state.get(k) || {};
    this.state.set(k, { 
      status, 
      lastPostAt: posted ? Date.now() : (prev.lastPostAt || 0),
      messageId: messageId || prev.messageId
    });
    this.saveState();
  }

  render(template, vars) {
    let out = String(template || '');
    for (const [k, v] of Object.entries(vars)) {
      out = out.replaceAll(`{${k}}`, String(v ?? ''));
    }
    return out;
  }

  async ensureTwitchAppToken() {
    const now = Date.now();
    if (this.twitchToken && now < this.twitchTokenExpiry - 60_000) return this.twitchToken;
    const twitchConfig = configLoader.twitch || {};
    const clientId = twitchConfig.twitch_client_id || process.env.TWITCH_CLIENT_ID;
    const clientSecret = twitchConfig.twitch_client_secret || process.env.TWITCH_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      console.error('Missing Twitch API credentials. Please check your config for client_id and client_secret.');
      return null;
    }
    try {
      const params = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'client_credentials'
      });
      const res = await fetch('https://id.twitch.tv/oauth2/token', { 
        method: 'POST', 
        body: params,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });
      if (!res.ok) {
        const errorText = await res.text();
        console.error('Failed to get Twitch token:', res.status, errorText);
        return null;
      }
      const data = await res.json();
      this.twitchToken = data.access_token;
      this.twitchTokenExpiry = now + (data.expires_in || 0) * 1000;
      return this.twitchToken;
    } catch (error) {
      console.error('Error getting Twitch token:', error);
      return null;
    }
  }

  async checkTwitch(client) {
    const token = await this.ensureTwitchAppToken();
    const twitchConfig = configLoader.twitch || {};
    const clientId = twitchConfig.twitch_client_id;
    if (!token || !clientId) return;

    for (const [gid, guild] of client.guilds.cache) {
      const entries = streamRegistry.list(gid).filter(e => e.platform === 'twitch');
      if (!entries.length) continue;
      for (const entry of entries) {
        const login = (() => {
          try {
            const v = String(entry.id || '').trim();
            if (/^https?:\/\//i.test(v)) {
              const u = new URL(v);
              if (u.hostname.replace(/^www\./, '').includes('twitch.tv')) {
                const seg = u.pathname.split('/').filter(Boolean)[0];
                if (seg) return seg.toLowerCase();
              }
            }
            return v.toLowerCase();
          } catch (error) {
            return String(entry.id).toLowerCase();
          }
        })();
        // Check stream cache first (3 minute cache)
        const now = Date.now();
        const streamCached = this.twitchStreamCache.get(login);
        let streamData = null;
        
        if (streamCached && streamCached.exp > now) {
          streamData = streamCached;
        } else {
          const url = `https://api.twitch.tv/helix/streams?user_login=${encodeURIComponent(login)}`;
          try {
            const res = await fetch(url, { headers: { 'Client-Id': clientId, 'Authorization': `Bearer ${token}` } });
            if (!res.ok) continue;
            const data = await res.json();
            const streamInfo = Array.isArray(data?.data) && data.data.length > 0 ? data.data[0] : null;
            // Check if stream is actually live (type should be 'live')
            const isLive = streamInfo?.type === 'live';
            streamData = {
              isLive: isLive,
              data: isLive ? streamInfo : null,
              exp: now + (3 * 60 * 1000) // 3 minutes cache
            };
            this.twitchStreamCache.set(login, streamData);
          } catch (error) {
            continue;
          }
        }
        
        const live = streamData.isLive;
        try {
          if (live) {
            const s = streamData.data;
            const streamTitle = s.title || 'Live now';
            const gameTitle = s.game_name || null;
            const username = s.user_name || login;
            // Get user info for avatar (cached)
            let avatar = null;
            const userCached = this.twitchUserCache.get(login);
            if (userCached && userCached.exp > now) {
              avatar = userCached.userData?.profile_image_url;
            } else {
              try {
                const userUrl = `https://api.twitch.tv/helix/users?login=${encodeURIComponent(login)}`;
                const userRes = await fetch(userUrl, { headers: { 'Client-Id': clientId, 'Authorization': `Bearer ${token}` } });
                if (userRes.ok) {
                  const userData = await userRes.json();
                  const user = userData?.data?.[0];
                  if (user) {
                    this.twitchUserCache.set(login, {
                      userData: user,
                      exp: now + (6 * 60 * 60 * 1000) // 6 hours cache
                    });
                    avatar = user.profile_image_url;
                  }
                }
              } catch (error) {}
            }
            if (!avatar) {
              avatar = `https://static-cdn.jtvnw.net/jtv_user_pictures/${login}-profile_image-300x300.png`;
            }
            const watch = `https://twitch.tv/${login}`;
            const imageUrl = s.thumbnail_url
              ? s.thumbnail_url.replace('{width}', '1280').replace('{height}', '720')
              : avatar;
            const tpl = entry.message || '{name} is live on Twitch: {title} {url}';
            const content = this.render(tpl, { name: username, title: streamTitle, url: watch });
            const embed = buildStreamEmbed({ platform: 'twitch', username, avatarUrl: avatar, url: watch, title: streamTitle, game: gameTitle, imageUrl });
            const keyId = login;
            const alreadyLive = this.state.get(this.key(gid, 'twitch', keyId))?.status === 'live';
            if (alreadyLive) continue;
            const message = await this.post(client, entry.channelId, content, [embed]);
            // Assign live roles if configured
            try {
              const guild = client.guilds.cache.get(gid);
              if (guild && entry.liveRoleIds?.length) {
                let member = null;
                
                // Use discordUser field if available
                if (entry.discordUser) {
                  member = await guild.members.fetch(entry.discordUser).catch(() => null);
                } else {
                  // Fall back to finding member by Twitch activity in presence
                  for (const [userId, m] of guild.members.cache) {
                    const twitchActivity = m.presence?.activities?.find(a => 
                      a.name === 'Twitch' && a.url?.includes(login)
                    );
                    if (twitchActivity) {
                      member = m;
                      break;
                    }
                  }
                }
                
                if (member) {
                  const hasWhitelist = !entry.whitelistRoleIds?.length || entry.whitelistRoleIds.some(r => member.roles.cache.has(r));
                  if (hasWhitelist) {
                    for (const rid of entry.liveRoleIds) {
                      if (rid && !member.roles.cache.has(rid)) {
                        await member.roles.add(rid).catch(() => {});
                      }
                    }
                  }
                }
              }
            } catch (error) {
              // Ignore role assignment errors
            }
            this.recordState(gid, 'twitch', keyId, 'live', true, message?.id);
            // Start timers only for your channel
            const twitchConfig = configLoader.twitch || {};
            const myChannel = twitchConfig.twitch_username || twitchConfig.username;
            if (myChannel && login.toLowerCase() === myChannel.toLowerCase()) {
              twitchTimers.onStreamStart();
            }
          } else {
            // Only remove roles if stream was previously live
            const wasLive = this.state.get(this.key(gid, 'twitch', login))?.status === 'live';
            const lastLiveCheck = this.state.get(this.key(gid, 'twitch', login))?.lastPostAt || 0;
            const timeSinceLastLive = Date.now() - lastLiveCheck;
            const offlineCooldown = 5 * 60 * 1000; // 5 minutes cooldown before removing role
            
            if (wasLive) {
              if (timeSinceLastLive > offlineCooldown) {
                // Double check the stream status before removing the role
                try {
                  const doubleCheckUrl = `https://api.twitch.tv/helix/streams?user_login=${encodeURIComponent(login)}`;
                  
                  const doubleCheckRes = await fetch(doubleCheckUrl, { 
                    headers: { 
                      'Client-Id': clientId, 
                      'Authorization': `Bearer ${token}` 
                    } 
                  });
                  
                  if (doubleCheckRes.ok) {
                    const doubleCheckData = await doubleCheckRes.json();
                    const streamStillLive = Array.isArray(doubleCheckData?.data) && 
                                         doubleCheckData.data.length > 0 && 
                                         doubleCheckData.data[0]?.type === 'live';
                    
                    if (!streamStillLive) {
                      console.log(`[Twitch] Stream ${login} confirmed offline, removing role after cooldown`);
                      const guild = client.guilds.cache.get(gid);
                      if (guild && entry.liveRoleIds?.length) {
                        // Use discordUser field if available
                        if (entry.discordUser) {
                          const member = await guild.members.fetch(entry.discordUser).catch(() => null);
                          if (member) {
                            console.log(`[Twitch] Removing live role from ${member.user.tag} (${login})`);
                            for (const rid of entry.liveRoleIds) {
                              if (rid && member.roles.cache.has(rid)) {
                                await member.roles.remove(rid).catch(error => {
                                  console.error(`[Twitch] Failed to remove role ${rid} from ${member.user.tag}:`, error.message);
                                });
                              }
                            }
                          }
                        }
                      }
                      this.recordState(gid, 'twitch', login, 'offline', false);
                      
                      // Cleanup: delete previous stream notification if configured
                      const prevState = this.state.get(this.key(gid, 'twitch', login));
                      if (prevState?.messageId && entry.cleanup) {
                        try {
                          const channel = client.channels.cache.get(entry.channelId);
                          if (channel) {
                            await channel.messages.delete(prevState.messageId).catch(() => {});
                          }
                        } catch (error) {
                          console.error(`[Twitch] Failed to delete notification message:`, error);
                        }
                      }
                      
                      // Stop timers only for your channel
                      if (myChannel && login.toLowerCase() === myChannel.toLowerCase()) {
                        twitchTimers.onStreamEnd();
                      }
                    } else {
                      console.log(`[Twitch] Stream ${login} is still live, not removing role`);
                      this.recordState(gid, 'twitch', login, 'live', true);
                    }
                  }
                } catch (error) {
                  console.error(`[Twitch] Error during double check for ${login}:`, error);
                  // If we can't verify, don't remove the role
                  this.recordState(gid, 'twitch', login, 'live', true);
                }
              } else {
                console.log(`[Twitch] Stream ${login} appears offline but still in cooldown (${Math.ceil((offlineCooldown - timeSinceLastLive) / 1000)}s remaining)`);
              }
            }
          }
        } catch (error) {
          // Ignore stream check errors
        }
      }
    }
  }

  async resolveYouTubeChannelId(identifier, apiKey) {
    if (!identifier) return null;
    if (identifier.startsWith('UC')) return identifier; // already a channel ID
    
    // Check quota exceeded
    const now = Date.now();
    if (this.quotaExceededUntil && now < this.quotaExceededUntil) {
      return null;
    }
    
    // Check cache first (24h cache)
    const cached = this.youtubeHandleCache.get(identifier);
    if (cached && cached.exp > now) {
      return cached.channelId;
    }
    
    let channelId = null;
    
    // Use search API for all identifiers (forHandle API causes 400 errors)
    const query = identifier.startsWith('@') ? identifier.slice(1) : identifier;
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&q=${encodeURIComponent(query)}&maxResults=1&key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      if (!data.error) {
        channelId = data?.items?.[0]?.id?.channelId || null;
      }
    }
    
    // Cache result for 24 hours
    if (channelId) {
      this.youtubeHandleCache.set(identifier, {
        channelId,
        exp: Date.now() + (7 * 24 * 60 * 60 * 1000) // 7 days
      });
    }
    
    return channelId;
  }

  async fetchYouTubeChannelInfo(channelId, apiKey) {
    // Check quota exceeded
    const now = Date.now();
    if (this.quotaExceededUntil && now < this.quotaExceededUntil) {
      return null;
    }
    
    // Check cache first (6h cache for channel info)
    const cached = this.youtubeChannelCache.get(channelId);
    if (cached && cached.exp > now) {
      return cached;
    }
    
    try {
      const url = `https://www.googleapis.com/youtube/v3/channels?part=snippet&id=${encodeURIComponent(channelId)}&key=${encodeURIComponent(apiKey)}`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = await res.json();
      if (data.error) return null;
      
      const snippet = data?.items?.[0]?.snippet;
      if (!snippet) return null;
      
      const info = {
        avatar: snippet.thumbnails?.default?.url || null,
        title: snippet.title || null,
        exp: Date.now() + (24 * 60 * 60 * 1000) // 24 hours
      };
      
      // Cache the result
      this.youtubeChannelCache.set(channelId, info);
      return info;
    } catch (error) {
      return null;
    }
  }

  async checkYouTube(client) {
    const apiKey = youtubeConfig?.youtube_api_key || process.env.YOUTUBE_API_KEY;
    if (!apiKey) return;
    
    const now = Date.now();
    if (this.quotaExceededUntil && now < this.quotaExceededUntil) {
      return;
    }
    for (const [gid, guild] of client.guilds.cache) {
      const entries = streamRegistry.list(gid).filter(e => e.platform === 'youtube');
      if (!entries.length) continue;
      for (const entry of entries) {
        let channelId = await this.resolveYouTubeChannelId(entry.id, apiKey);
        if (!channelId) continue;
        
        // Check live cache first (5 minute cache)
        const liveCached = this.youtubeLiveCache.get(channelId);
        let liveData = null;
        
        if (liveCached && liveCached.exp > now) {
          liveData = liveCached;
        } else {
          // Fetch live status
          const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${encodeURIComponent(channelId)}&eventType=live&type=video&maxResults=1&key=${encodeURIComponent(apiKey)}`;
          try {
            const res = await fetch(url);
            if (!res.ok) {
              console.log(`YouTube API error for ${entry.id}: ${res.status} ${res.statusText}`);
              if (res.status === 403) {
                console.log('YouTube API quota exceeded - pausing YouTube checks for 1 hour');
                this.quotaExceededUntil = now + (60 * 60 * 1000); // 1 hour
                return; // Exit entire YouTube check
              }
              if (res.status === 400) {
                console.log(`Skipping ${entry.id} - invalid handle or channel not found`);
              }
              continue;
            }
            const data = await res.json();
            if (data.error) {
              console.log(`YouTube API error for ${entry.id}:`, data.error);
              if (data.error.code === 403 && data.error.reason === 'quotaExceeded') {
                console.log('YouTube API quota exceeded - pausing YouTube checks for 1 hour');
                this.quotaExceededUntil = now + (60 * 60 * 1000); // 1 hour
                return; // Exit entire YouTube check
              }
              continue;
            }
            
            const items = Array.isArray(data?.items) ? data.items : [];
            liveData = {
              isLive: items.length > 0,
              data: items.length > 0 ? items[0] : null,
              exp: now + (10 * 60 * 1000) // 10 minutes cache
            };
            
            // Cache the result
            this.youtubeLiveCache.set(channelId, liveData);
          } catch (error) {
            continue;
          }
        }
        
        const live = liveData.isLive;
        const items = liveData.data ? [liveData.data] : [];
        
        if (live) {
            const it = items[0];
            const streamTitle = it?.snippet?.title || 'New video';
            const vid = it?.id?.videoId;
            const watch = vid ? `https://www.youtube.com/watch?v=${vid}` : `https://www.youtube.com/@${entry.id.replace('@', '')}`;
            
            // Get channel info (cached)
            const channelInfo = await this.fetchYouTubeChannelInfo(channelId, apiKey);
            const username = it?.snippet?.channelTitle || channelInfo?.title || channelId;
            const avatar = channelInfo?.avatar;
            const imageUrl = it?.snippet?.thumbnails?.high?.url 
              || it?.snippet?.thumbnails?.medium?.url 
              || avatar;
            const tpl = entry.message || '{name} is live on YouTube: {title} {url}';
            const content = this.render(tpl, { name: username, title: streamTitle, url: watch });
            const embed = buildStreamEmbed({ platform: 'youtube', username, avatarUrl: avatar, url: watch, title: streamTitle, imageUrl });
            const keyId = channelId;
            const alreadyLive = this.state.get(this.key(gid, 'youtube', keyId))?.status === 'live';
            if (alreadyLive) continue;
            await this.post(client, entry.channelId, content, [embed]);
            // Assign live roles if configured and whitelist (if any) passes
            try {
              if (entry.discordUser) {
                const guild = client.guilds.cache.get(gid);
                const member = guild ? await guild.members.fetch(entry.discordUser).catch(() => null) : null;
                const hasWhitelist = !entry.whitelistRoleIds?.length || (member && entry.whitelistRoleIds.some(r => member.roles.cache.has(r)));
                if (member && hasWhitelist) {
                  const roles = Array.isArray(entry.liveRoleIds) ? entry.liveRoleIds : (entry.liveRoleId ? [entry.liveRoleId] : []);
                  for (const rid of roles) {
                    if (rid && !member.roles.cache.has(rid)) {
                      await member.roles.add(rid).catch(() => {
                        // Ignore role add errors
                      });
                    }
                  }
                }
              }
            } catch (error) {
              // Ignore role assignment errors
            }
            this.recordState(gid, 'youtube', keyId, 'live', true);
          } else {
            // Remove live roles if configured
            try {
              if (entry.discordUser) {
                const guild = client.guilds.cache.get(gid);
                const member = guild ? await guild.members.fetch(entry.discordUser).catch(() => null) : null;
                if (member) {
                  const roles = Array.isArray(entry.liveRoleIds) ? entry.liveRoleIds : (entry.liveRoleId ? [entry.liveRoleId] : []);
                  for (const rid of roles) {
                    if (rid && member.roles.cache.has(rid)) {
                      await member.roles.remove(rid).catch(() => {
                        // Ignore role remove errors
                      });
                    }
                  }
                }
              }
            } catch (error) {
              // Ignore role assignment errors
            }
            this.recordState(gid, 'youtube', channelId, 'offline', false);
          }

          // Check for new VOD uploads (most recent non-live video) - only if VOD message is configured
          if (entry.vodMessage && entry.id === channelId) {
            try {
              // Check VOD cache first (30 minute cache)
              const vodCached = this.youtubeVodCache.get(channelId);
              let vodData = null;
              
              if (vodCached && vodCached.exp > now) {
                vodData = vodCached;
              } else {
                const vodUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${encodeURIComponent(channelId)}&order=date&type=video&maxResults=1&key=${encodeURIComponent(apiKey)}`;
                const vodRes = await fetch(vodUrl);
                if (vodRes.ok) {
                  const vodApiData = await vodRes.json();
                  if (!vodApiData.error) {
                    const latest = Array.isArray(vodApiData?.items) && vodApiData.items.length ? vodApiData.items[0] : null;
                    vodData = {
                      latestVideo: latest,
                      exp: now + (60 * 60 * 1000) // 1 hour cache
                    };
                    this.youtubeVodCache.set(channelId, vodData);
                  }
                }
              }
              
              if (vodData?.latestVideo) {
                const latest = vodData.latestVideo;
                const videoId = latest?.id?.videoId;
                if (videoId) {
                  const cacheKey = `${gid}:${channelId}`;
                  const last = this.lastVodByGuildChannel.get(cacheKey);
                  if (last !== videoId) {
                    // Check if video is recent (within last 24 hours)
                    const publishedAt = new Date(latest?.snippet?.publishedAt);
                    const now = new Date();
                    const hoursSincePublish = (now - publishedAt) / (1000 * 60 * 60);
                    
                    if (hoursSincePublish <= 24) {
                      // Get channel info (cached)
                      const channelInfo = await this.fetchYouTubeChannelInfo(channelId, apiKey);
                      const username = latest?.snippet?.channelTitle || channelInfo?.title || channelId;
                      const title = latest?.snippet?.title || 'New upload';
                      const watch = `https://www.youtube.com/watch?v=${videoId}`;
                      const avatar = channelInfo?.avatar;
                      const imageUrl = latest?.snippet?.thumbnails?.high?.url 
                        || latest?.snippet?.thumbnails?.medium?.url 
                        || avatar;
                      const tpl = entry.vodMessage;
                      const content = this.render(tpl, { name: username, title, url: watch });
                      const embed = buildStreamEmbed({ platform: 'youtube', username, avatarUrl: avatar, url: watch, title, imageUrl });

                      // Respect cooldown to reduce spam if needed
                      const keyIdVod = `${channelId}:vod`;
                      if (!this.withinCooldown(gid, 'youtube', keyIdVod, this.defaultCooldownMinutes)) {
                        await this.post(client, entry.channelId, content, [embed]);
                        this.recordState(gid, 'youtube', keyIdVod, 'vod', true);
                      }
                    }
                    this.lastVodByGuildChannel.set(cacheKey, videoId);
                  }
                }
              }
            } catch (error) {
              // Ignore VOD errors
            }
          }
      }
    }
  }

  async checkPresenceBasedYouTube(client) {
    await this.managePresenceRoles(client, 'youtube');
    await this.postPresenceNotifications(client, 'youtube');
  }

  async managePresenceRoles(client, platform) {
    for (const [gid, guild] of client.guilds.cache) {
      const presenceRules = streamRegistry.getPresence(gid)?.[platform];
      if (!presenceRules?.liveRoleIds?.length) continue;
      
      // Skip if no whitelist roles are set (safety check - should be validated elsewhere)
      if (!presenceRules.whitelistRoleIds?.length) continue;
      
      for (const [userId, member] of guild.members.cache) {
        if (!member.presence?.activities || member.user.bot) continue;
        
        const activity = this.findPlatformActivity(member.presence.activities, platform);
        const hasWhitelistRole = presenceRules.whitelistRoleIds.some(r => member.roles.cache.has(r));
        const isStreaming = activity && (platform === 'discord' ? member.voice?.channel : activity.type === 1) && hasWhitelistRole;
        
        // Process each role
        for (const roleId of presenceRules.liveRoleIds) {
          if (!roleId) continue;
          const hasRole = member.roles.cache.has(roleId);
          
          try {
            if (isStreaming && !hasRole) {
              await member.roles.add(roleId);
            } else if (!isStreaming && hasRole) {
              await member.roles.remove(roleId);
            }
          } catch (error) {
            console.error(`Error managing role ${roleId} for user ${member.id} in guild ${guild.id}:`, error.message);
          }
        }
      }
    }
  }

  async postPresenceNotifications(client, platform) {
    for (const [gid, guild] of client.guilds.cache) {
      const presenceRules = streamRegistry.getPresence(gid)?.[platform];
      
      // Skip if no channel or whitelist roles are set
      if (!presenceRules?.channelId || !presenceRules.whitelistRoleIds?.length) continue;
      
      for (const [userId, member] of guild.members.cache) {
        if (!member.presence?.activities || member.user.bot) continue;
        
        const activity = this.findPlatformActivity(member.presence.activities, platform);
        const hasWhitelistRole = presenceRules.whitelistRoleIds.some(r => member.roles.cache.has(r));
        const isStreaming = activity && (platform === 'discord' ? member.voice?.channel : activity.type === 1) && hasWhitelistRole;
        
        if (isStreaming) {
          try {
            await this.handlePresenceNotification(client, gid, member, activity, platform, presenceRules);
          } catch (error) {
            console.error(`Error sending notification for user ${member.id} in guild ${guild.id}:`, error.message);
          }
          break; // Only notify once per member
        }
      }
    }
  }

  findPlatformActivity(activities, platform) {
    const platformMap = {
      youtube: a => a.name === 'YouTube' || a.url?.includes('youtube.com'),
      twitch: a => a.name === 'Twitch' && a.url?.includes('twitch.tv'),
      kick: a => a.name === 'Kick' || a.url?.includes('kick.com'),
      rumble: a => a.name === 'Rumble' || a.url?.includes('rumble.com'),
      tiktok: a => a.name === 'TikTok' || a.url?.includes('tiktok.com'),
      instagram: a => a.name === 'Instagram' || a.url?.includes('instagram.com'),
      facebook: a => a.name === 'Facebook' || a.url?.includes('facebook.com'),
      x: a => a.name === 'X' || a.name === 'Twitter' || a.url?.includes('x.com') || a.url?.includes('twitter.com'),
      discord: () => true
    };
    return activities.find(platformMap[platform] || (() => false));
  }

  async handlePresenceNotification(client, gid, member, activity, platform, presenceRules) {
    const keyId = `presence_${member.id}`;
    const alreadyLive = this.state.get(this.key(gid, platform, keyId))?.status === 'live';
    if (alreadyLive) return;

    if (platform === 'youtube') {
      const channelMatch = activity.url?.match(/youtube\.com\/(?:channel\/|@|c\/)([^/?]+)/);
      if (channelMatch) {
        await this.checkYouTubePresence(client, gid, channelMatch[1], presenceRules);
      }
    } else if (platform === 'twitch') {
      const match = activity.url?.match(/twitch\.tv\/([^/?]+)/);
      if (match) {
        await this.checkTwitchPresence(client, gid, match[1].toLowerCase(), presenceRules, member);
      }
    } else {
      await this.postGenericPresenceNotification(client, gid, member, activity, platform, presenceRules, keyId);
    }
  }

  async postGenericPresenceNotification(client, gid, member, activity, platform, presenceRules, keyId) {
    const platformData = {
      kick: { baseUrl: 'https://kick.com/', favicon: 'https://kick.com/favicon.ico' },
      rumble: { baseUrl: 'https://rumble.com/user/', favicon: 'https://rumble.com/favicon.ico' },
      tiktok: { baseUrl: 'https://tiktok.com/@', favicon: 'https://sf16-website-login.neutral.ttwstatic.com/obj/tiktok_web_login_static/tiktok/webapp/main/webapp-desktop/8152caf0c8e8bc67ae0d.ico' },
      instagram: { baseUrl: 'https://instagram.com/', favicon: 'https://www.instagram.com/static/images/ico/favicon-192.png/68d99ba29cc8.png' },
      facebook: { baseUrl: 'https://facebook.com/', favicon: 'https://facebook.com/favicon.ico' },
      x: { baseUrl: 'https://x.com/', favicon: 'https://abs.twimg.com/favicons/twitter.3.ico' },
      discord: { baseUrl: 'https://discord.com/users/', favicon: 'https://discord.com/assets/847541504914fd33810e70a0ea73177e.ico' }
    };

    const data = platformData[platform];
    if (!data) return;

    const username = member.displayName || member.user.username;
    const watch = activity?.url || `${data.baseUrl}${platform === 'discord' ? member.id : username}`;
    const streamTitle = activity?.details || `Live on ${platform.charAt(0).toUpperCase() + platform.slice(1)}`;
    const tpl = presenceRules.message || `{name} is live on ${platform.charAt(0).toUpperCase() + platform.slice(1)}: {title} {url}`;
    const content = this.render(tpl, { name: username, title: streamTitle, url: watch });
    const avatarUrl = member.user.displayAvatarURL() || data.favicon;
    const embed = buildStreamEmbed({ platform, username, avatarUrl, url: watch, title: streamTitle });
    
    await this.post(client, presenceRules.channelId, content, [embed]);
    this.recordState(gid, platform, keyId, 'live', true);
  }

  async checkPresenceBasedRumble(client) {
    await this.managePresenceRoles(client, 'rumble');
    await this.postPresenceNotifications(client, 'rumble');
  }

  async checkPresenceBasedTikTok(client) {
    await this.managePresenceRoles(client, 'tiktok');
    await this.postPresenceNotifications(client, 'tiktok');
  }

  async checkPresenceBasedKick(client) {
    await this.managePresenceRoles(client, 'kick');
    await this.postPresenceNotifications(client, 'kick');
  }

  async checkPresenceBasedInstagram(client) {
    await this.managePresenceRoles(client, 'instagram');
    await this.postPresenceNotifications(client, 'instagram');
  }

  async checkPresenceBasedDiscord(client) {
    await this.managePresenceRoles(client, 'discord');
    await this.postPresenceNotifications(client, 'discord');
  }

  async checkRumble(client) {
    try {
      // Rumble has no public API - only presence-based detection
      const now = Date.now();
      
        for (const [gid, guild] of client.guilds.cache) {
          const entries = streamRegistry.list(gid).filter(e => e.platform === 'rumble');
          if (!entries.length) continue;
          
          for (const entry of entries) {
            // Check if user is live via presence
            if (entry.discordUser) {
              const member = guild.members.cache.get(entry.discordUser);
              if (!member?.presence?.activities) continue;
              
              const rumbleActivity = member.presence.activities.find(a => 
                a.name === 'Rumble' || a.url?.includes('rumble.com')
              );
              
              if (rumbleActivity) {
                const keyId = entry.id;
                const alreadyLive = this.state.get(this.key(gid, 'rumble', keyId))?.status === 'live';
                if (alreadyLive) continue;
                
                const username = entry.id; // Use Rumble username
                const watch = `https://rumble.com/user/${entry.id}`;
                const streamTitle = rumbleActivity.details || 'Live on Rumble';
                
                const tpl = entry.message || '{name} is live on Rumble: {title} {url}';
                const content = this.render(tpl, { name: username, title: streamTitle, url: watch });
                const avatarUrl = 'https://rumble.com/favicon.ico'; // Use Rumble favicon as default
                const embed = buildStreamEmbed({ platform: 'rumble', username, avatarUrl, url: watch, title: streamTitle });
                
                await this.post(client, entry.channelId, content, [embed]);
                this.recordState(gid, 'rumble', keyId, 'live', true);
              } else {
                this.recordState(gid, 'rumble', entry.id, 'offline', false);
              }
            }
          }
        }
    } catch (error) {
      // Ignore Rumble check errors
    }
  }

  async checkTikTok(client) {
    try {
      // TikTok has no public API - only presence-based detection
      const now = Date.now();
      
        for (const [gid, guild] of client.guilds.cache) {
          const entries = streamRegistry.list(gid).filter(e => e.platform === 'tiktok');
          if (!entries.length) continue;
          
          for (const entry of entries) {
            // Check if user is live via presence
            if (entry.discordUser) {
              const member = guild.members.cache.get(entry.discordUser);
              if (!member?.presence?.activities) continue;
              
              const tiktokActivity = member.presence.activities.find(a => 
                a.name === 'TikTok' || a.url?.includes('tiktok.com')
              );
              
              if (tiktokActivity) {
                const keyId = entry.id;
                const alreadyLive = this.state.get(this.key(gid, 'tiktok', keyId))?.status === 'live';
                if (alreadyLive) continue;
                
                const username = entry.id; // Use TikTok username
                const watch = `https://tiktok.com/@${entry.id}`;
                const streamTitle = tiktokActivity.details || 'Live on TikTok';
                
                const tpl = entry.message || '{name} is live on TikTok: {title} {url}';
                const content = this.render(tpl, { name: username, title: streamTitle, url: watch });
                const avatarUrl = 'https://sf16-website-login.neutral.ttwstatic.com/obj/tiktok_web_login_static/tiktok/webapp/main/webapp-desktop/8152caf0c8e8bc67ae0d.ico';
                const embed = buildStreamEmbed({ platform: 'tiktok', username, avatarUrl, url: watch, title: streamTitle });
                
                await this.post(client, entry.channelId, content, [embed]);
                this.recordState(gid, 'tiktok', keyId, 'live', true);
              } else {
                this.recordState(gid, 'tiktok', entry.id, 'offline', false);
              }
            }
          }
        }
    } catch (error) {
      // Ignore TikTok check errors
    }
  }

  async checkKick(client) {
    // Kick has no public API - only presence-based detection
    const now = Date.now();
    
    for (const [gid, guild] of client.guilds.cache) {
      const entries = streamRegistry.list(gid).filter(e => e.platform === 'kick');
      if (!entries.length) continue;
      
      for (const entry of entries) {
        // Check if user is live via presence
        if (entry.discordUser) {
          const member = guild.members.cache.get(entry.discordUser);
          if (!member?.presence?.activities) continue;
          
          const kickActivity = member.presence.activities.find(a => 
            a.name === 'Kick' || a.url?.includes('kick.com')
          );
          
          if (kickActivity) {
            const keyId = entry.id;
            const alreadyLive = this.state.get(this.key(gid, 'kick', keyId))?.status === 'live';
            if (alreadyLive) continue;
            
            const username = entry.id; // Use Kick username
            const watch = `https://kick.com/${entry.id}`;
            const streamTitle = kickActivity.details || 'Live on Kick';
            
            const tpl = entry.message || '{name} is live on Kick: {title} {url}';
            const content = this.render(tpl, { name: username, title: streamTitle, url: watch });
            const avatarUrl = 'https://kick.com/favicon.ico';
            const embed = buildStreamEmbed({ platform: 'kick', username, avatarUrl, url: watch, title: streamTitle });
            
            await this.post(client, entry.channelId, content, [embed]);
            this.recordState(gid, 'kick', keyId, 'live', true);
          } else {
            this.recordState(gid, 'kick', entry.id, 'offline', false);
          }
        }
      }
    }
  }

  async checkInstagram(client) {
    // Instagram has no public API - only presence-based detection
    const now = Date.now();
    
    for (const [gid, guild] of client.guilds.cache) {
      const entries = streamRegistry.list(gid).filter(e => e.platform === 'instagram');
      if (!entries.length) continue;
      
      for (const entry of entries) {
        // Check if user is live via presence
        if (entry.discordUser) {
          const member = guild.members.cache.get(entry.discordUser);
          if (!member?.presence?.activities) continue;
          
          const instagramActivity = member.presence.activities.find(a => 
            a.name === 'Instagram' || a.url?.includes('instagram.com')
          );
          
          if (instagramActivity) {
            const keyId = entry.id;
            const alreadyLive = this.state.get(this.key(gid, 'instagram', keyId))?.status === 'live';
            if (alreadyLive) continue;
            
            const username = entry.id; // Use Instagram username
            const watch = `https://instagram.com/${entry.id}`;
            const streamTitle = instagramActivity.details || 'Live on Instagram';
            
            const tpl = entry.message || '{name} is live on Instagram: {title} {url}';
            const content = this.render(tpl, { name: username, title: streamTitle, url: watch });
            const avatarUrl = 'https://www.instagram.com/static/images/ico/favicon-192.png/68d99ba29cc8.png';
            const embed = buildStreamEmbed({ platform: 'instagram', username, avatarUrl, url: watch, title: streamTitle });
            
            await this.post(client, entry.channelId, content, [embed]);
            this.recordState(gid, 'instagram', keyId, 'live', true);
          } else {
            this.recordState(gid, 'instagram', entry.id, 'offline', false);
          }
        }
      }
    }
  }

  async checkDiscord(client) {
    // Discord has no public API - only presence-based detection
    const now = Date.now();
    
    for (const [gid, guild] of client.guilds.cache) {
      const entries = streamRegistry.list(gid).filter(e => e.platform === 'discord');
      if (!entries.length) continue;
      
      for (const entry of entries) {
        // Check if user is live via presence
        if (entry.discordUser) {
          const member = guild.members.cache.get(entry.discordUser);
          if (!member?.presence?.activities) continue;
          
          const isInVoice = member.voice?.channel;
          
          if (isInVoice) {
            const keyId = entry.id;
            const alreadyLive = this.state.get(this.key(gid, 'discord', keyId))?.status === 'live';
            if (alreadyLive) continue;
            
            const username = entry.id; // Use Discord username
            const watch = `https://discord.com/users/${entry.id}`;
            const streamTitle = 'Live on Discord';
            
            const tpl = entry.message || '{name} is live on Discord: {title} {url}';
            const content = this.render(tpl, { name: username, title: streamTitle, url: watch });
            const avatarUrl = 'https://discord.com/assets/847541504914fd33810e70a0ea73177e.ico';
            const embed = buildStreamEmbed({ platform: 'discord', username, avatarUrl, url: watch, title: streamTitle });
            
            await this.post(client, entry.channelId, content, [embed]);
            this.recordState(gid, 'discord', keyId, 'live', true);
          } else {
            this.recordState(gid, 'discord', entry.id, 'offline', false);
          }
        }
      }
    }
  }

  async checkFacebook(client) {
    try {
        for (const [gid, guild] of client.guilds.cache) {
          const entries = streamRegistry.list(gid).filter(e => e.platform === 'facebook');
          if (!entries.length) continue;
          
          for (const entry of entries) {
            if (entry.discordUser) {
              const member = guild.members.cache.get(entry.discordUser);
              if (!member?.presence?.activities) continue;
              
              const facebookActivity = member.presence?.activities?.find(a => 
                a.name === 'Facebook' || a.url?.includes('facebook.com')
              );
              
              if (facebookActivity) {
                const keyId = entry.id;
                const alreadyLive = this.state.get(this.key(gid, 'facebook', keyId))?.status === 'live';
                if (alreadyLive) continue;
                
                const username = entry.id;
                const watch = `https://facebook.com/${entry.id}`;
                const streamTitle = facebookActivity.details || 'Live on Facebook';
                
                const tpl = entry.message || '{name} is live on Facebook: {title} {url}';
                const content = this.render(tpl, { name: username, title: streamTitle, url: watch });
                const avatarUrl = 'https://facebook.com/favicon.ico';
                const embed = buildStreamEmbed({ platform: 'facebook', username, avatarUrl, url: watch, title: streamTitle });
                
                await this.post(client, entry.channelId, content, [embed]);
                this.recordState(gid, 'facebook', keyId, 'live', true);
              } else {
                this.recordState(gid, 'facebook', entry.id, 'offline', false);
              }
            }
          }
        }
    } catch (error) {
      // Ignore Facebook check errors
    }
  }

  async checkX(client) {
    for (const [gid, guild] of client.guilds.cache) {
      const entries = streamRegistry.list(gid).filter(e => e.platform === 'x');
      if (!entries.length) continue;
      
      for (const entry of entries) {
        if (entry.discordUser) {
          const member = guild.members.cache.get(entry.discordUser);
          if (!member?.presence?.activities) continue;
          
          const xActivity = member.presence?.activities?.find(a => 
            a.name === 'X' || a.name === 'Twitter' || a.url?.includes('x.com') || a.url?.includes('twitter.com')
          );
          
          if (xActivity) {
            const keyId = entry.id;
            const alreadyLive = this.state.get(this.key(gid, 'x', keyId))?.status === 'live';
            if (alreadyLive) continue;
            
            const username = entry.id;
            const watch = `https://x.com/${entry.id}`;
            const streamTitle = xActivity.details || 'Live on X';
            
            const tpl = entry.message || '{name} is live on X: {title} {url}';
            const content = this.render(tpl, { name: username, title: streamTitle, url: watch });
            const avatarUrl = 'https://abs.twimg.com/favicons/twitter.3.ico';
            const embed = buildStreamEmbed({ platform: 'x', username, avatarUrl, url: watch, title: streamTitle });
            
            await this.post(client, entry.channelId, content, [embed]);
            this.recordState(gid, 'x', keyId, 'live', true);
          } else {
            this.recordState(gid, 'x', entry.id, 'offline', false);
          }
        }
      }
    }
  }

  async checkPresenceBasedFacebook(client) {
    await this.managePresenceRoles(client, 'facebook');
    await this.postPresenceNotifications(client, 'facebook');
  }

  async checkPresenceBasedX(client) {
    await this.managePresenceRoles(client, 'x');
    await this.postPresenceNotifications(client, 'x');
  }

  async checkPresenceBasedTwitch(client) {
    await this.managePresenceRoles(client, 'twitch');
    await this.postPresenceNotifications(client, 'twitch');
  }

  async checkTwitchPresence(client, guildId, login, presenceRules, member = null) {
    const token = await this.ensureTwitchAppToken();
    const clientId = twitchConfig?.twitch_client_id;
    if (!token || !clientId) return;

    try {
      const streamUrl = `https://api.twitch.tv/helix/streams?user_login=${encodeURIComponent(login)}`;
      const streamRes = await fetch(streamUrl, { headers: { 'Client-Id': clientId, 'Authorization': `Bearer ${token}` } });
      
      if (streamRes.ok) {
        const streamData = await streamRes.json();
        const isLive = Array.isArray(streamData?.data) && streamData.data.length > 0;
        
        if (isLive) {
          const s = streamData.data[0];
          const streamTitle = s.title || 'Live now';
          const gameTitle = s.game_name || null;
          const username = s.user_name || login;
          
          // Get user avatar (cached)
          let avatar = null;
          const now = Date.now();
          const userCached = this.twitchUserCache.get(login);
          if (userCached && userCached.exp > now) {
            avatar = userCached.userData?.profile_image_url;
          } else {
            try {
              const userUrl = `https://api.twitch.tv/helix/users?login=${encodeURIComponent(login)}`;
              const userRes = await fetch(userUrl, { headers: { 'Client-Id': clientId, 'Authorization': `Bearer ${token}` } });
              if (userRes.ok) {
                const userData = await userRes.json();
                const user = userData?.data?.[0];
                if (user) {
                  this.twitchUserCache.set(login, {
                    userData: user,
                    exp: now + (6 * 60 * 60 * 1000) // 6 hours cache
                  });
                  avatar = user.profile_image_url;
                }
              }
            } catch (error) {}
          }
          if (!avatar) {
            avatar = `https://static-cdn.jtvnw.net/jtv_user_pictures/${login}-profile_image-300x300.png`;
          }
          
          const keyId = login;
          const alreadyLive = this.state.get(this.key(guildId, 'twitch', keyId))?.status === 'live';
          if (alreadyLive) return;
          
          const watch = `https://twitch.tv/${login}`;
          const imageUrl = s.thumbnail_url
            ? s.thumbnail_url.replace('{width}', '1280').replace('{height}', '720')
            : avatar;
          
          const tpl = presenceRules.message || '{name} is live on Twitch: {title} {url}';
          const content = this.render(tpl, { name: username, title: streamTitle, url: watch });
          const embed = buildStreamEmbed({ platform: 'twitch', username, avatarUrl: avatar, url: watch, title: streamTitle, game: gameTitle, imageUrl });
          
          await this.post(client, presenceRules.channelId, content, [embed]);
          this.recordState(guildId, 'twitch', keyId, 'live', true);
          // Start timers only for your channel
          const myChannel = twitchConfig?.twitch_username || twitchConfig?.username;
          if (myChannel && login.toLowerCase() === myChannel.toLowerCase()) {
            twitchTimers.onStreamStart();
          }
        }
      }
    } catch (error) {
      // Ignore presence-based Twitch check errors
    }
  }

  async checkKickPresence(client, guildId, username, presenceRules) {
    try {
      const keyId = username;
      const alreadyLive = this.state.get(this.key(guildId, 'kick', keyId))?.status === 'live';
      if (alreadyLive) return;
      
      const watch = `https://kick.com/${username}`;
      const streamTitle = 'Live on Kick';
      
      const tpl = presenceRules.message || '{name} is live on Kick: {title} {url}';
      const content = this.render(tpl, { name: username, title: streamTitle, url: watch });
      const avatarUrl = 'https://kick.com/favicon.ico';
      const embed = buildStreamEmbed({ platform: 'kick', username, avatarUrl, url: watch, title: streamTitle });
      
      await this.post(client, presenceRules.channelId, content, [embed]);
      this.recordState(guildId, 'kick', keyId, 'live', true);
    } catch (error) {
      // Ignore Kick presence check errors
    }
  }

  async checkYouTubePresence(client, guildId, channelIdentifier, presenceRules) {
    const apiKey = youtubeConfig?.youtube_api_key;
    if (!apiKey) return;

    try {
      const channelId = await this.resolveYouTubeChannelId(channelIdentifier, apiKey);
      if (!channelId) return;

      const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${encodeURIComponent(channelId)}&eventType=live&type=video&maxResults=1&key=${encodeURIComponent(apiKey)}`;
      const res = await fetch(url);
      if (!res.ok) return;
      
      const data = await res.json();
      const items = Array.isArray(data?.items) ? data.items : [];
      
      if (items.length > 0) {
        const it = items[0];
        const streamTitle = it?.snippet?.title || 'Live now';
        const vid = it?.id?.videoId;
        const watch = vid ? `https://www.youtube.com/watch?v=${vid}` : `https://www.youtube.com/@${channelIdentifier}`;
        
        const channelInfo = await this.fetchYouTubeChannelInfo(channelId, apiKey);
        const username = it?.snippet?.channelTitle || channelInfo?.title || channelId;
        const avatar = channelInfo?.avatar;
        const imageUrl = it?.snippet?.thumbnails?.high?.url || it?.snippet?.thumbnails?.medium?.url || avatar;
        
        const keyId = channelId;
        const alreadyLive = this.state.get(this.key(guildId, 'youtube', keyId))?.status === 'live';
        if (alreadyLive) return;
        
        const tpl = presenceRules.message || '{name} is live on YouTube: {title} {url}';
        const content = this.render(tpl, { name: username, title: streamTitle, url: watch });
        const embed = buildStreamEmbed({ platform: 'youtube', username, avatarUrl: avatar, url: watch, title: streamTitle, imageUrl });
        
        await this.post(client, presenceRules.channelId, content, [embed]);
        this.recordState(guildId, 'youtube', keyId, 'live', true);
      }
    } catch (error) {
      // Ignore YouTube presence check errors
    }
  }

  async post(client, channelId, content, embeds) {
    try {
      const ch = client.channels.cache.get(channelId) || await client.channels.fetch(channelId);
      if (ch?.send) {
        return await ch.send({ content, embeds });
      }
    } catch (error) {
      // Ignore post errors
    }
    return null;
  }
}

module.exports = new StreamNotifier();