const { handleInviteJoin } = require('../modules/inviteTracker');
const { logMemberJoin } = require('../modules/logger');
const guildSettings = require('../modules/guildSettings');
const { renderTemplate, buildWelcomeEmbed } = require('../modules/welcomeUtil');
const DEBUG = /^(1|true)$/i.test(String(process.env.ASSISTABOT_DEBUG || ''));

module.exports = {
  name: 'guildMemberAdd',
  async execute(member, client) {
    if (DEBUG) console.info({ event: 'guild_member_add', user: member.user?.id, guild: member.guild?.id });
    await handleInviteJoin(member, client);
    logMemberJoin(member, client);

    try {
      const gs = guildSettings.getSettings(member.guild.id);
      const welcome = gs?.welcome;
      if (!welcome?.enabled) return;

      const messageTemplate = welcome.message ?? guildSettings.defaultSettings.welcome.message;
      const message = renderTemplate(messageTemplate, member.guild, member.user, member.displayName);
      const content = welcome.content 
        ? renderTemplate(welcome.content, member.guild, member.user, member.displayName)
        : undefined;
      const embed = buildWelcomeEmbed({ 
        guild: member.guild, 
        user: member.user, 
        message, 
        embedColor: gs.embedColor 
      });

      if (welcome.channelId) {
        try {
          const channel = client.channels.cache.get(welcome.channelId) || await client.channels.fetch(welcome.channelId);
          if (channel?.send) await channel.send({ content, embeds: [embed] });
        } catch (e) {
          if (DEBUG) console.warn('Welcome channel send failed:', e?.message || String(e));
        }
      }

      if (welcome.dm) {
        try {
          await member.send({ content, embeds: [embed] });
        } catch (e) {
          if (DEBUG) console.warn('Welcome DM failed:', e?.message || String(e));
        }
      }
    } catch (e) {
      if (DEBUG) console.warn('Welcome handling error:', e?.message || String(e));
    }
  },
};