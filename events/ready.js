const { checkBirthdays } = require('../modules/birthdayManager');
const { initInvites } = require('../modules/inviteTracker');
const { logGeneral } = require('../modules/logger');
const { ActivityType, PresenceUpdateStatus } = require('discord.js');

module.exports = {
  name: 'clientReady',
  once: true,
  execute(client) {
    console.log('client.channels:', client.channels);
    console.log(`Ready! Logged in as ${client.user.tag}`);
    client.user.setPresence({
      activities: [
        { name: "Using a fire extinguisher on Shadav's brain", type: ActivityType.Custom }
      ],
      status: PresenceUpdateStatus.Online
    });

    // Send bot startup log to the general log channel
    logGeneral(`Bot started and ready as ${client.user.tag}`, client);

    // Init invite tracking
    initInvites(client);

    // Birthday checker every 24h
    setInterval(() => checkBirthdays(client), 86400000);
  },
};