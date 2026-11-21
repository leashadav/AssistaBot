const fs = require('fs');
const path = require('path');

const GIVEAWAYS_FILE = path.join(__dirname, '..', 'data', 'giveaways.json');

class GiveawayManager {
  constructor() {
    this.interval = null;
  }

  start(client) {
    if (this.interval) clearInterval(this.interval);
    
    const checkGiveaways = async () => {
      try {
        const data = this.loadGiveaways();
        const now = Date.now();
        
        for (const [messageId, giveaway] of Object.entries(data.giveaways)) {
          if (!giveaway.ended && now >= giveaway.endTime) {
            const { endGiveaway } = require('../commands/giveaway');
            await endGiveaway(client, messageId, giveaway);
          }
        }
      } catch (error) {
        console.error('Error checking giveaways:', error?.message || 'Unknown error');
      }
    };

    checkGiveaways();
    this.interval = setInterval(checkGiveaways, 30000); // Check every 30 seconds
  }

  stop() {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
  }

  loadGiveaways() {
    try {
      if (!fs.existsSync(GIVEAWAYS_FILE)) {
        fs.writeFileSync(GIVEAWAYS_FILE, JSON.stringify({ giveaways: {} }, null, 2));
      }
      return JSON.parse(fs.readFileSync(GIVEAWAYS_FILE, 'utf8'));
    } catch (error) {
      console.error('Error loading giveaways:', error?.message || 'Unknown error');
      return { giveaways: {} };
    }
  }
}

module.exports = new GiveawayManager();