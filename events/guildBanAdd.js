const { sendLog } = require('../modules/logger');
const { AuditLogEvent } = require('discord.js');
const DEBUG = /^(1|true)$/i.test(String(process.env.ASSISTABOT_DEBUG || ''));

module.exports = {
  name: 'guildBanAdd',
  async execute(ban, client) {
    if (DEBUG) console.info({ event: 'guild_ban_add', user: ban.user?.id, guild: ban.guild?.id });

    try {
      // Fetch audit logs to get the executor and reason
      const banLogs = await ban.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.MemberBanAdd });
      const banEntry = banLogs.entries.first();
      
      let actorText = 'Unknown';
      let reasonText = ban.reason || 'No reason provided';
      
      if (banEntry && banEntry.executor) {
        actorText = `${banEntry.executor.username} (${banEntry.executor.id})`;
      }
      
      if (banEntry && banEntry.reason) {
        reasonText = banEntry.reason;
      }

      const createdAt = ban.user?.createdAt?.toUTCString() || 'Unknown';
      const content = `**User Banned**\nDisplay Name: ${ban.user}\nUsername: ${ban.user.username}\nUser ID: ${ban.user.id}\nAccount created: ${createdAt}\nActor: ${actorText}\nReason: ${reasonText}`;

      sendLog(client, ban.guild.id, 'memberBan', content, null, null, 'User Banned');
    } catch (error) {
      console.error('Error in guildBanAdd event handler:', error);
    }
  }
};
