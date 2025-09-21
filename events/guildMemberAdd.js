const { handleInviteJoin } = require('../modules/inviteTracker');
const { logMemberJoin } = require('../modules/logger');

module.exports = {
  name: 'guildMemberAdd',
  async execute(member, client) {
  	await handleInviteJoin(member, client);
    logMemberJoin(member, client);
  },
};