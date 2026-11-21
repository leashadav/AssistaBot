const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const environmentConfig = {
  config: {
    token: 'DISCORD_TOKEN',
    clientId: 'DISCORD_CLIENT_ID',
    clientSecret: 'DISCORD_CLIENT_SECRET',
    WEBHOOK_URL: 'DISCORD_STATUS_WEBHOOK_URL',
    timezone: 'ASSISTABOT_TIMEZONE',
    'clientsettings.nodes.0.password': 'DATABASE_PASSWORD'
  },
  paypal: {
    clientId: 'PAYPAL_CLIENT_ID',
    secret: 'PAYPAL_SECRET'
  },
  twitch: {
    twitch_client_id: 'TWITCH_CLIENT_ID',
    twitch_oauth: 'TWITCH_OAUTH_TOKEN',
    twitch_client_secret: 'TWITCH_CLIENT_SECRET',
    twitch_authorization_code: 'TWITCH_AUTHORIZATION_CODE',
    twitch_broadcaster_oauth: 'TWITCH_BROADCASTER_OAUTH_TOKEN',
    twitch_broadcaster_refresh_token: 'TWITCH_BROADCASTER_REFRESH_TOKEN',
    publicUrl: 'ASSISTABOT_ALERT_PUBLIC_URL'
  },
  webhooks: {
    secret: 'WEBHOOK_SERVER_SECRET',
    'twitch.webhookSecret': 'TWITCH_WEBHOOK_SECRET',
    'youtube.verifyToken': 'YOUTUBE_WEBHOOK_VERIFY_TOKEN'
  },
  youtube: {
    youtube_api_key: 'YOUTUBE_API_KEY',
    youtube_video_id: 'YOUTUBE_VIDEO_ID',
    youtube_live_chat_id: 'YOUTUBE_LIVE_CHAT_ID',
    youtube_channel_handle: 'YOUTUBE_CHANNEL_HANDLE',
    youtube_song_secret: 'YOUTUBE_SONG_SECRET'
  },
  kick: {
    kick_client_id: 'KICK_CLIENT_ID',
    kick_client_secret: 'KICK_CLIENT_SECRET',
    kick_broadcaster_user_id: 'KICK_BROADCASTER_USER_ID'
  }
};

class ConfigLoader {
  constructor() {
    this.configDir = path.join(__dirname, '..', 'config');
    this.envPath = path.join(__dirname, '..', '.env');
    this.cache = new Map();
    const result = dotenv.config({ path: this.envPath, quiet: true });
    this.dotEnvValues = Object.fromEntries(
      Object.entries(result.parsed || {}).filter(([name, value]) => process.env[name] === value)
    );
  }

  load(configName) {
    if (this.cache.has(configName)) {
      return this.cache.get(configName);
    }

    try {
      const configPath = path.join(this.configDir, `${configName}.json`);
      const examplePath = path.join(this.configDir, `${configName}.example.json`);
      const sourcePath = fs.existsSync(configPath) ? configPath : examplePath;
      const data = fs.existsSync(sourcePath)
        ? JSON.parse(fs.readFileSync(sourcePath, 'utf8'))
        : {};
      this.applyEnvironment(data, environmentConfig[configName]);
      this.cache.set(configName, data);
      return data;
    } catch (error) {
      console.error(`Error loading config ${configName}:`, error?.message || 'Unknown error');
    }
    
    return {};
  }

  applyEnvironment(config, mappings = {}) {
    for (const [configPath, variable] of Object.entries(mappings || {})) {
      const segments = configPath.split('.');
      let target = config;
      for (const segment of segments.slice(0, -1)) {
        target = target?.[Array.isArray(target) ? Number(segment) : segment];
        if (target === undefined || target === null) break;
      }

      if (target !== undefined && target !== null) {
        const key = segments[segments.length - 1];
        target[Array.isArray(target) ? Number(key) : key] = process.env[variable] === undefined
          ? ''
          : process.env[variable];
      }
    }
  }

  persistEnvironmentVariable(name, value) {
    if (!Object.prototype.hasOwnProperty.call(this.dotEnvValues, name)) {
      return false;
    }
    if (/[\r\n]/.test(value)) {
      throw new Error(`Environment variable ${name} cannot contain a newline`);
    }

    const contents = fs.readFileSync(this.envPath, 'utf8');
    const entry = `${name}=${JSON.stringify(value)}`;
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const variableLine = new RegExp(`^[ \\t]*${escapedName}[ \\t]*=.*$`, 'm');
    const updated = variableLine.test(contents)
      ? contents.replace(variableLine, entry)
      : `${contents}${contents.endsWith('\n') || contents.length === 0 ? '' : '\n'}${entry}\n`;
    fs.writeFileSync(this.envPath, updated, 'utf8');
    this.dotEnvValues[name] = value;
    return true;
  }

  get config() {
    return this.load('config');
  }

  get twitch() {
    return this.load('twitch');
  }

  reload() {
    this.cache.clear();
  }
}

module.exports = new ConfigLoader();