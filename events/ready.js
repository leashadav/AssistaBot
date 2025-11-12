const { ActivityType } = require('discord.js');
const { sendLog } = require('../modules/logger');
const { checkBirthdays } = require('../modules/birthdayManager');
const { initInvites } = require('../modules/inviteTracker');
const apiStreamNotifier = require('../modules/apiStreamNotifier');
const presenceStreamNotifier = require('../modules/presenceStreamNotifier');
const configLoader = require('../modules/configLoader');

// Only log errors
const DEBUG = false;

module.exports = {
  name: 'clientReady',
  once: true,
  async execute(client) {
    // Set initial presence
    client.user.setPresence({
      activities: [{ name: "Using a fire extinguisher on Shadav's brain", type: ActivityType.Custom }],
      status: 'online',
    });

    // Log bot info
    console.log(`Ready! Logged in as ${client.user.tag}`);
    console.log(`Serving ${client.guilds.cache.size} guilds`);
    
    try {
      // Initialize invite tracking
      await initInvites(client);
      
      // Start checking birthdays
      checkBirthdays(client);
      
      // Start the stream notifiers with configurable intervals
      const apiCheckInterval = configLoader.config.apiCheckInterval || 180000; // 3 minutes
      const presenceCheckInterval = configLoader.config.presenceCheckInterval || 60000; // 1 minute
      
      await apiStreamNotifier.start(client, apiCheckInterval);
      await presenceStreamNotifier.start(client, presenceCheckInterval);
      
    } catch (error) {
      console.error('Error initializing notifiers:', error);
      // Try to continue even if notifiers fail to start
    }
    
    console.log('Bot initialization complete');
  }
};
