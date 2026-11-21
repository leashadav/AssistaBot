const { sendLog } = require('../modules/logger');

module.exports = {
  name: 'userUpdate',
  async execute(oldUser, newUser, client) {
    const changes = [];
    if (oldUser.username !== newUser.username) {
      changes.push(`Username: ${oldUser.username} -> ${newUser.username}`);
    }
    if (oldUser.globalName !== newUser.globalName) {
      changes.push(`Display name: ${oldUser.globalName || 'None'} -> ${newUser.globalName || 'None'}`);
    }
    if (changes.length === 0) return;

    const content = [
      `User: ${newUser} (${newUser.id})`,
      ...changes
    ].join('\n');

    for (const guild of client.guilds.cache.values()) {
      if (guild.members.cache.has(newUser.id)) {
        await sendLog(client, guild.id, 'moderationLog', content, null, null, 'User Name Changed');
      }
    }
  }
};
