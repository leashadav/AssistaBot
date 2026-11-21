const { handleInviteLeave, getInviterForMember } = require('../modules/inviteTracker');
const { logMemberLeave } = require('../modules/logger');
const guildSettings = require('../modules/guildSettings');
const { renderTemplate, buildGoodbyeEmbed } = require('../modules/welcomeUtil');
const { AuditLogEvent } = require('discord.js');
const joinRoles = require('../modules/joinRoles');
const DEBUG = /^(1|true)$/i.test(String(process.env.ASSISTABOT_DEBUG || ''));

module.exports = {
  name: 'guildMemberRemove',
  async execute(member, client) {
    if (DEBUG) console.info({ event: 'guild_member_remove', user: member.user?.id, guild: member.guild?.id });

    joinRoles.cancel(member);
    await handleInviteLeave?.(member, client);
    logMemberLeave?.(member, client);

    try {
      const gs = guildSettings.getSettings(member.guild.id);
      const goodbye = gs?.goodbye;
      if (!goodbye?.enabled) return;

      const tpl = (goodbye && goodbye.description) ?? guildSettings.defaultSettings.goodbye.description;
      const titleTpl = (goodbye && goodbye.title) ?? guildSettings.defaultSettings.goodbye.title;
      const memberDisplayName = member.displayName || member.user.username;
      const msg = renderTemplate(tpl, member.guild, member.user, memberDisplayName);
      const title = renderTemplate(titleTpl, member.guild, member.user, memberDisplayName);
      const contentTpl = goodbye && goodbye.content ? goodbye.content : null;
      const content = contentTpl ? renderTemplate(contentTpl, member.guild, member.user, memberDisplayName) : undefined;
      
      // Fetch inviter information
      let inviterInfo = null;
      try {
        const inviterId = getInviterForMember(member.guild.id, member.user.id);
        if (inviterId) {
          const inviterUser = await client.users.fetch(inviterId);
          if (inviterUser) {
            inviterInfo = `${inviterUser.username} (${inviterUser.id})`;
          }
        }
      } catch (e) {
        // Silently fail if inviter fetch fails
      }

      // Check if the member was kicked by checking audit logs
      let leaveType = 'Left';
      try {
        const kickLogs = await member.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.MemberKick });
        const kickEntry = kickLogs.entries.first();
        if (kickEntry && kickEntry.target && kickEntry.target.id === member.user.id) {
          // Check if the kick happened recently (within last 5 seconds)
          const kickTime = kickEntry.createdTimestamp;
          const now = Date.now();
          if (now - kickTime < 5000) {
            leaveType = '👢 Kicked';
          }
        }
      } catch (e) {
        // Silently fail if audit log check fails
      }
      
      const embed = buildGoodbyeEmbed({ 
        guild: member.guild, 
        user: member.user, 
        member: member,
        description: msg,
        title: title,
        embedColor: gs.embedColor,
        inviter: inviterInfo,
        leaveType: leaveType
      });

      const targetChannelId = goodbye.channelId || gs.welcome?.channelId;
      if (!targetChannelId) return;

      const channel = client.channels.cache.get(targetChannelId) || await client.channels.fetch(targetChannelId);
      if (channel?.send) await channel.send({ content, embeds: [embed] });
    } catch (e) {
      if (DEBUG) console.warn('Goodbye handling error:', e?.message || String(e));
    }
  }
};
