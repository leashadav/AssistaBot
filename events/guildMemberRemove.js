const { handleInviteLeave } = require('../modules/inviteTracker');
const { logMemberLeave } = require('../modules/logger');
const guildSettings = require('../modules/guildSettings');
const { renderTemplate, buildGoodbyeEmbed } = require('../modules/welcomeUtil');
const DEBUG = /^(1|true)$/i.test(String(process.env.ASSISTABOT_DEBUG || ''));

module.exports = {
  name: 'guildMemberRemove',
  async execute(member, client) {
    if (DEBUG) console.info({ event: 'guild_member_remove', user: member.user?.id, guild: member.guild?.id });

    await handleInviteLeave?.(member, client);
    logMemberLeave?.(member, client);

    try {
      const gs = guildSettings.getSettings(member.guild.id);
      const goodbye = gs?.goodbye;
      if (!goodbye?.enabled) return;

      const messageTemplate = goodbye.message ?? guildSettings.defaultSettings.goodbye.message;
      const message = renderTemplate(messageTemplate, member.guild, member.user, member.displayName);
      const content = goodbye.content 
        ? renderTemplate(goodbye.content, member.guild, member.user, member.displayName)
        : undefined;
      const embed = buildGoodbyeEmbed({ 
        guild: member.guild, 
        user: member.user, 
        message, 
        embedColor: gs.embedColor 
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
