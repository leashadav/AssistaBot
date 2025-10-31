const { logMemberLeave } = require('../modules/logger');

module.exports = {
  name: 'guildMemberRemove',
  async execute(member, client) {
    // Log the member leaving
    logMemberLeave(member, client);
  },
};
