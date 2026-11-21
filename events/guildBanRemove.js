const { AuditLogEvent } = require('discord.js');
const { sendLog } = require('../modules/logger');

module.exports = {
  name: 'guildBanRemove',
  async execute(ban, client) {
    try {
      const auditLogs = await ban.guild.fetchAuditLogs({
        limit: 5,
        type: AuditLogEvent.MemberBanRemove
      });
      const entry = auditLogs.entries.find(log =>
        log.target?.id === ban.user.id &&
        Date.now() - log.createdTimestamp < 30000
      );

      const actorText = entry?.executor
        ? `${entry.executor.username} (${entry.executor.id})`
        : 'Unknown';
      const reasonText = entry?.reason || 'No reason provided';
      const content = [
        '**User Unbanned**',
        `Username: ${ban.user.username}`,
        `User ID: ${ban.user.id}`,
        `Actor: ${actorText}`,
        `Reason: ${reasonText}`
      ].join('\n');

      await sendLog(client, ban.guild.id, 'memberBan', content, null, null, 'User Unbanned');
    } catch (error) {
      console.error('Error in guildBanRemove event handler:', error);
    }
  }
};
