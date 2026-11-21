const { logDelete } = require('../modules/logger');
const DEBUG = /^(1|true)$/i.test(String(process.env.ASSISTABOT_DEBUG || ''));

module.exports = {
  name: 'messageDelete',
  async execute(message, client) {
    if (DEBUG) {
      console.info({
        event: 'message_delete',
        message: message?.id,
        channel: message.channelId || message.channel?.id,
        guild: message.guildId || message.guild?.id,
        author: message.author?.id
      });
    }
    logDelete(message, client);
  },
};