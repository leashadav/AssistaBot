const booster = require('../modules/booster');
const { AuditLogEvent } = require('discord.js');
const { sendLog } = require('../modules/logger');
const joinRoles = require('../modules/joinRoles');

module.exports = {
  name: 'guildMemberUpdate',
  once: false,
  /**
   * @param {import('discord.js').GuildMember} oldMember
   * @param {import('discord.js').GuildMember} newMember
   * @param {import('discord.js').Client} client
   */
  async execute(oldMember, newMember, client) {
    joinRoles.handleMemberUpdate(oldMember, newMember);

    try {
      await booster.handleMemberUpdate(oldMember, newMember);
    } catch (error) {
      console.error('guildMemberUpdate (booster) error:', error?.message || error);
    }

    if (oldMember?.nickname !== newMember?.nickname) {
      let actorText = 'Unknown';
      let reasonText = 'No reason provided';
      try {
        const auditLogs = await newMember.guild.fetchAuditLogs({
          limit: 5,
          type: AuditLogEvent.MemberUpdate
        });
        const entry = auditLogs.entries.find(log =>
          log.target?.id === newMember.id &&
          Date.now() - log.createdTimestamp < 30000 &&
          log.changes?.some(change => change.key === 'nick')
        );
        if (entry?.executor) actorText = `${entry.executor.username} (${entry.executor.id})`;
        if (entry?.reason) reasonText = entry.reason;
      } catch {
        // Audit log access is optional; the nickname change can still be logged.
      }

      const oldName = oldMember.nickname || oldMember.user.username;
      const newName = newMember.nickname || newMember.user.username;
      const content = `Member: ${newMember.user} (${newMember.id})\nOld name: ${oldName}\nNew name: ${newName}\nActor: ${actorText}\nReason: ${reasonText}`;
      await sendLog(client, newMember.guild.id, 'moderationLog', content, null, null, 'Member Nickname Changed');
    }

    const oldTimeout = oldMember?.communicationDisabledUntilTimestamp || null;
    const newTimeout = newMember?.communicationDisabledUntilTimestamp || null;
    if (oldTimeout !== newTimeout) {
      let actorText = 'Unknown';
      let reasonText = 'No reason provided';
      try {
        const auditLogs = await newMember.guild.fetchAuditLogs({ limit: 5, type: AuditLogEvent.MemberUpdate });
        const entry = auditLogs.entries.find(log =>
          log.target?.id === newMember.id &&
          Date.now() - log.createdTimestamp < 30000 &&
          log.changes?.some(change => change.key === 'communication_disabled_until')
        );
        if (entry?.executor) actorText = `${entry.executor.username} (${entry.executor.id})`;
        if (entry?.reason) reasonText = entry.reason;
      } catch {
        // Audit log access is optional; the timeout change can still be logged.
      }

      const isTimedOut = newTimeout && newTimeout > Date.now();
      const untilText = isTimedOut ? `<t:${Math.floor(newTimeout / 1000)}:F>` : 'Removed';
      const action = isTimedOut ? 'Member Timed Out' : 'Member Timeout Removed';
      const content = `**${action}**\nMember: ${newMember.user} (${newMember.id})\nActor: ${actorText}\nUntil: ${untilText}\nReason: ${reasonText}`;
      await sendLog(client, newMember.guild.id, 'moderationLog', content, null, null, action);
    }
  }
};
