const { ActivityType } = require('discord.js');
const { sendLog } = require('../modules/logger');
const { checkBirthdays } = require('../modules/birthdayManager');
const { initInvites } = require('../modules/inviteTracker');

// Only log errors
const DEBUG = false;

module.exports = {
  name: 'ready',
  once: true,
  async execute(client) {
    // Set initial presence
    client.user.setPresence({
      activities: [{ name: "Using a fire extinguisher on Shadav's brain", type: ActivityType.Custom }],
      status: 'PresenceUpdateStatus.Online',
    });

    // Log bot info
    console.log(`Ready! Logged in as ${client.user.tag}`);
    console.log(`Serving ${client.guilds.cache.size} guilds`);

    const base = `${client.user} is now online`;
    const tasks = [];
    for (const [gid] of client.guilds.cache) {
      // Log startup only to assistabotLogging
      tasks.push(sendLog(client, gid, 'assistabotLogging', base));
    }
    await Promise.allSettled(tasks);

    try {
      // Initialize invite tracking
      await initInvites(client);
      
      // Start checking birthdays
      checkBirthdays(client);
      
    } catch (error) {
      console.error('Error initializing services:', error);
      // Try to continue even if initialization fails
    }
    
    console.log('Bot initialization complete');
  }
};
