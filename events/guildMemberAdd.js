const { handleInviteJoin, getInviterForMember } = require('../modules/inviteTracker');
const { logMemberJoin } = require('../modules/logger');
const guildSettings = require('../modules/guildSettings');
const { renderTemplate, buildWelcomeEmbed } = require('../modules/welcomeUtil');
const joinRoles = require('../modules/joinRoles');
const DEBUG = /^(1|true)$/i.test(String(process.env.ASSISTABOT_DEBUG || ''));

module.exports = {
  name: 'guildMemberAdd',
  async execute(member, client) {
    if (DEBUG) console.info({ event: 'guild_member_add', user: member.user?.id, guild: member.guild?.id });
    joinRoles.schedule(member);
    await handleInviteJoin(member, client);
    logMemberJoin(member, client);

    try {
      const gs = guildSettings.getSettings(member.guild.id);
      const welcome = gs?.welcome;
      if (!welcome?.enabled) return;

      const tpl = (welcome && welcome.description) ?? guildSettings.defaultSettings.welcome.description;
      const titleTpl = (welcome && welcome.title) ?? guildSettings.defaultSettings.welcome.title;
      const memberDisplayName = member.displayName || member.user.username;
      const msg = renderTemplate(tpl, member.guild, member.user, memberDisplayName);
      const title = renderTemplate(titleTpl, member.guild, member.user, memberDisplayName);
      const contentTpl = welcome && welcome.content ? welcome.content : null;
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
      
      const embed = buildWelcomeEmbed({ 
        guild: member.guild, 
        user: member.user, 
        description: msg,
        title: title,
        embedColor: gs.embedColor,
        inviter: inviterInfo
      });

      if (welcome.channelId) {
        try {
          const channel = client.channels.cache.get(welcome.channelId) || await client.channels.fetch(welcome.channelId);
          if (channel?.send) await channel.send({ content, embeds: [embed] });
        } catch (e) {
          if (DEBUG) console.warn('Welcome channel send failed:', e?.message || String(e));
        }
      }
    } catch (e) {
      if (DEBUG) console.warn('Welcome handling error:', e?.message || String(e));
    }
  },
};