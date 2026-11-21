const selfAssignableRoles = require('../modules/selfAssignableRoles');

module.exports = {
  name: 'messageReactionAdd',
  async execute(reaction, user, client) {
    if (user?.bot) return;

    try {
      if (reaction.partial) {
        await reaction.fetch();
      }
    } catch (error) {
      return;
    }

    const message = reaction.message;
    if (!message || !message.guild) return;

    const guildId = message.guild.id;
    const messageId = message.id;
    const emojiKey = selfAssignableRoles.normalizeEmojiKey(reaction.emoji);
    if (!emojiKey) return;

    const mapping = selfAssignableRoles.getRoleForReaction(guildId, messageId, reaction.emoji);
    if (!mapping) return;

    const member = message.guild.members.cache.get(user.id) || await message.guild.members.fetch(user.id).catch(() => null);
    if (!member) return;

    if (member.roles.cache.has(mapping.roleId)) return;
    try {
      await member.roles.add(mapping.roleId, 'Self-assignable role reaction');
    } catch (error) {
      console.error('selfAssignableRoles add error:', error?.message || error);
    }
  }
};