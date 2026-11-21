const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, '..', 'data', 'twitch_greetings.json');
const COOLDOWN_MS = 8 * 60 * 60 * 1000;

class TwitchGreetings {
  constructor() {
    this.streamId = null;
    this.greetedUsers = new Map();
    this.load();
  }

  load() {
    try {
      if (!fs.existsSync(DATA_PATH)) return;
      const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
      this.streamId = typeof data.streamId === 'string' ? data.streamId : null;
      if (data.greetedAt && typeof data.greetedAt === 'object' && !Array.isArray(data.greetedAt)) {
        this.greetedUsers = new Map(
          Object.entries(data.greetedAt)
            .map(([username, timestamp]) => [username.toLowerCase(), Number(timestamp)])
            .filter(([, timestamp]) => Number.isFinite(timestamp) && Date.now() - timestamp < COOLDOWN_MS)
        );
      } else {
        const migrationTimestamp = Date.now();
        this.greetedUsers = new Map(
          (Array.isArray(data.greetedUsers) ? data.greetedUsers : [])
            .map(username => [String(username).toLowerCase(), migrationTimestamp])
        );
        this.save();
      }
    } catch (error) {
      console.error('[Twitch Greetings] Failed to load greeting state:', error.message);
    }
  }

  save() {
    try {
      fs.writeFileSync(DATA_PATH, JSON.stringify({
        streamId: this.streamId,
        greetedUsers: Array.from(this.greetedUsers.keys()),
        greetedAt: Object.fromEntries(this.greetedUsers)
      }, null, 2));
    } catch (error) {
      console.error('[Twitch Greetings] Failed to save greeting state:', error.message);
    }
  }

  setStream(streamId) {
    const nextStreamId = String(streamId);
    if (this.streamId === nextStreamId) return;
    this.streamId = nextStreamId;
    this.removeExpiredGreetings();
    this.save();
  }

  hasGreeted(username) {
    const normalizedUsername = String(username).toLowerCase();
    const greetedAt = this.greetedUsers.get(normalizedUsername);
    if (greetedAt === undefined) return false;
    if (Date.now() - greetedAt < COOLDOWN_MS) return true;

    this.greetedUsers.delete(normalizedUsername);
    this.save();
    return false;
  }

  markGreeted(username) {
    this.greetedUsers.set(String(username).toLowerCase(), Date.now());
    this.save();
  }

  removeExpiredGreetings() {
    const now = Date.now();
    let removed = false;
    for (const [username, greetedAt] of this.greetedUsers) {
      if (now - greetedAt >= COOLDOWN_MS) {
        this.greetedUsers.delete(username);
        removed = true;
      }
    }
    return removed;
  }
}

module.exports = new TwitchGreetings();
