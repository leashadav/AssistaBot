const { handleInviteCreate } = require('../modules/inviteTracker');

module.exports = {
  name: 'inviteCreate',
  async execute(invite, client) {
    await handleInviteCreate(invite, client);
  }
};
