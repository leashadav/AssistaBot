const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');

/**
 * User command for displaying user information
 * @module commands/user
 */

module.exports = {
  data: new SlashCommandBuilder()
    .setName('user')
    .setDescription('Get information about a user')
    .setDMPermission(false)
    .addUserOption(option => 
      option.setName('user')
        .setDescription('The user to get information about')
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ViewChannel),
  /**
   * Execute the user command
   * @param {import('discord.js').CommandInteraction} interaction - The interaction object
   */
  async execute(interaction) {
    try {
      if (!interaction.inGuild()) {
        return interaction.reply({ 
          content: '❌ This command can only be used in a server.'
        });
      }

      await interaction.deferReply();
      
      // Get the target user or default to the command user
      const targetUser = interaction.options.getUser('user') || interaction.user;
      const member = await interaction.guild.members.fetch(targetUser.id);
      
      // Calculate server join-related info
      const joinDate = member.joinedAt ? Math.floor(member.joinedAt.getTime() / 1000) : 'Unknown';

      // Create embed
      const embed = new EmbedBuilder()
        .setColor(member.displayHexColor || '#0099ff')
        .setAuthor({
          name: targetUser.tag,
          iconURL: targetUser.displayAvatarURL({ dynamic: true })
        })
        .setThumbnail(targetUser.displayAvatarURL({ dynamic: true, size: 1024 }))
        .addFields(
          { name: 'Display Name', value: member.displayName || 'None', inline: false },
          { name: 'User ID', value: targetUser.id, inline: false },
          { name: 'Account Created', value: `<t:${Math.floor(targetUser.createdTimestamp / 1000)}:R>`, inline: true },
          { name: 'Joined Server', value: joinDate !== 'Unknown' ? `<t:${joinDate}:R>` : 'Unknown', inline: true },
          { 
            name: 'Roles', 
            value: member.roles.cache
              .sort((a, b) => b.position - a.position)
              .map(role => role.toString())
              .slice(0, 10) // Limit to first 10 roles to avoid hitting embed field limits
              .join(' ') || 'None',
            inline: false
          }
        )
        .setFooter({ 
          text: `User is ${targetUser.bot ? '🤖 Bot' : '🤷 Human'}`
        })

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error('Error in user command:', error);
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({
          content: '❌ An error occurred while fetching user information.'
        });
      } else {
        await interaction.reply({
          content: '❌ An error occurred while fetching user information.'
        });
      }
    }
  },
};