const fs = require('fs');
const path = require('path');

class ConfigLoader {
  constructor() {
    this.configDir = path.join(__dirname, '..', 'config');
    this.cache = new Map();
  }

  load(configName) {
    if (this.cache.has(configName)) {
      return this.cache.get(configName);
    }

    try {
      const configPath = path.join(this.configDir, `${configName}.json`);
      if (fs.existsSync(configPath)) {
        const data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        this.cache.set(configName, data);
        return data;
      }
    } catch (error) {
      console.error(`Error loading config ${configName}:`, error?.message || 'Unknown error');
    }
    
    return {};
  }

  get config() {
    return this.load('config');
  }

  get twitch() {
    return this.load('twitch');
  }

  get twitter() {
    return this.load('twitter');
  }

  get youtube() {
    return this.load('youtube');
  }

  reload() {
    this.cache.clear();
  }
}

module.exports = new ConfigLoader();