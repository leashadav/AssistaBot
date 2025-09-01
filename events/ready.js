const { logGeneral } = require('../modules/logger');

module.exports = {
  name: 'clientReady',
  once: true,
  execute(client) {
    const { logGeneral } = require('../modules/logger');
    console.log(`Ready! Logged in as ${client.user.tag}`);
        
    // Send bot startup log to the general log channel
    logGeneral(client, `Bot started and ready as ${client.user.tag}`);

    // Optionally, initialize invite tracking
    // Optionally, start checking birthdays
  },
};