const { handleInviteJoin } = require('../modules/inviteTracker');

module.exports = {
  name: 'guildMemberAdd',
  async execute(member, client) {
    handleInviteJoin(member, client);
  },
};