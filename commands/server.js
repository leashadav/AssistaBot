const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('server')
    .setDescription('Get information about this server')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ViewChannel),

  async execute(interaction) {
    try {
      if (!interaction.inGuild()) {
        return interaction.reply({ 
          content: '❌ This command can only be used in a server.', 
          flags: 64 
        });
      }

      if (!interaction.guild.available) {
        return interaction.reply({ 
          content: '❌ Server information is currently unavailable.', 
          flags: 64 
        });
      }

      const { guild } = interaction;
      const createdAt = Math.round(guild.createdTimestamp / 1000);

      const info = [
        `**Server name:** ${guild.name}`,
        `**Description:** ${guild.description || 'No description set'}`,
        `**Created:** <t:${createdAt}:D> (<t:${createdAt}:R>)`,
        `**Members:** ${guild.memberCount.toLocaleString()}`,
        `**Boost Level:** ${guild.premiumTier}`,
        `**Boosts:** ${guild.premiumSubscriptionCount || '0'}`,
        `**Owner:** <@${guild.ownerId}>`,
        `**Roles:** ${guild.roles.cache.size - 1}`, // -1 to exclude @everyone
        `**Channels:** ${guild.channels.cache.size} total`
      ].join('\n');

      await interaction.reply({
        content: info
      });
    } catch (error) {
      console.error('Error in /server command:', error);
      await interaction.reply({
        content: '❌ An error occurred while fetching server information.'
      });
    }
  },
};