const guildSettings = require('../modules/guildSettings');

module.exports = {
  name: 'guildCreate',
  once: false,
  async execute(guild, client) {
    // Record when the bot joined this guild
    const settings = guildSettings.getSettings(guild.id);
    if (!settings.joinedAt) {
      settings.joinedAt = guild.joinedAt ? guild.joinedAt.toISOString() : new Date().toISOString();
      guildSettings.updateSettings(guild.id, { joinedAt: settings.joinedAt });
    }
  }
};
