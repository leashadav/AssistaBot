const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, EmbedBuilder } = require('discord.js');
const requestBatcher = require('../utils/requestBatcher');
const cache = require('../utils/cache');
const guildSettings = require('../modules/guildSettings');

/**
 * User command for displaying user information
 * @module commands/user
 */

module.exports = {
  data: new SlashCommandBuilder()
    .setName('user')
    .setDescription('Get information about a user')
    .addUserOption(option => 
      option.setName('user')
        .setDescription('The user to get information about')
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ViewChannel),

  /**
   * Execute the user command with caching and batching
   * @param {import('discord.js').CommandInteraction} interaction - The interaction object
   */
  async execute(interaction) {
    // Defer immediately before any async work to prevent interaction timeout
    if (!interaction.inGuild()) {
      return interaction.reply({ 
        content: '❌ This command can only be used in a server.',
        flags: MessageFlags.Ephemeral
      }).catch(() => {});
    }

    try {
      await interaction.deferReply().catch(err => {
        if (err.code === 10062) return; // Interaction expired before we could defer — nothing to do
        throw err;
      });
      if (!interaction.deferred) return; // deferReply silently failed, interaction is gone
      
      const targetUser = interaction.options.getUser('user') || interaction.user;
      const cacheKey = `user:${interaction.guildId}:${targetUser.id}`;

      try {
        // Try to get member from cache first, then fall back to batched fetch
        const member = await cache.get(
          cacheKey,
          () => requestBatcher.enqueue(
            () => interaction.guild.members.fetch({ 
              user: targetUser.id, 
              force: false // Use cache when possible
            }),
            `member:${interaction.guildId}:${targetUser.id}`
          )
        );

        if (!member) {
          return interaction.editReply({
            content: '❌ Could not fetch member information.'
          });
        }

        // Prepare embed data
        // Get guild-specific embed color - no hardcoded fallback
        const settings = guildSettings.getSettings(interaction.guildId);
        const guildEmbedColor = settings?.embedColor;
        
        // Get user's highest role color
        let userRoleColor = null;
        if (member && member.roles.cache.size > 0) {
          // Find the highest role with a color
          const coloredRoles = member.roles.cache
            .map(role => role)
            .filter(role => role.color && role.color !== 0)
            .sort((a, b) => b.position - a.position);
          
          if (coloredRoles.length > 0) {
            userRoleColor = coloredRoles[0].color;
          }
        }
        
        // Use user's role color first, then guild color as fallback
        const embedColor = userRoleColor || guildEmbedColor;
        
        const embed = new EmbedBuilder()
          .setColor(embedColor)
          .setAuthor({
            name: targetUser.username,
            iconURL: targetUser.displayAvatarURL({ dynamic: true, size: 128 })
          });

        // Set thumbnail with optimized size
        const avatarUrl = targetUser.displayAvatarURL({ 
          dynamic: true, 
          size: 1024 
        });
        if (avatarUrl) {
          embed.setThumbnail(avatarUrl);
        }

        // Add basic fields
        embed.addFields(
          { 
            name: 'Display Name', 
            value: member.displayName || 'None', 
            inline: false 
          },
          { 
            name: 'User ID', 
            value: `\`${targetUser.id}\``, 
            inline: false 
          },
          { 
            name: 'User Type', 
            value: targetUser.bot ? '🤖 Bot' : '🤷 Human', 
            inline: true 
          }
        );

        // Add age group if available
        if (targetUser.ageGroup) {
          const ageGroupMap = {
            'unknown': 'Age: Unknown',
            'minor': '🔞 Minor',
            'adult': '👤 Adult'
          };
          embed.addFields({
            name: 'Age Group',
            value: ageGroupMap[targetUser.ageGroup] || targetUser.ageGroup,
            inline: true
          });
        }

        // Add verification status
        if (targetUser.verified !== undefined) {
          embed.addFields({
            name: 'Verified',
            value: targetUser.verified ? '✅ Yes' : '❌ No',
            inline: true
          });
        }

        // Add account creation date and age
        const accountAge = Math.floor((Date.now() - targetUser.createdTimestamp) / (1000 * 60 * 60 * 24));
        embed.addFields(
          { 
            name: 'Account Created', 
            value: `<t:${Math.floor(targetUser.createdTimestamp / 1000)}:R> (${accountAge} days ago)`, 
            inline: true 
          }
        );

        // Add server join date if available
        if (member.joinedAt) {
          const joinDuration = Math.floor((Date.now() - member.joinedAt.getTime()) / (1000 * 60 * 60 * 24));
          embed.addFields({
            name: 'Joined Server',
            value: `<t:${Math.floor(member.joinedAt.getTime() / 1000)}:R> (${joinDuration} days ago)`,
            inline: true
          });
        }

        // Add server boost status if boosting
        if (member.premiumSince) {
          const boostDuration = Math.floor((Date.now() - member.premiumSince.getTime()) / (1000 * 60 * 60 * 24));
          embed.addFields({
            name: 'Server Boost',
            value: `Boosting for ${boostDuration} days`,
            inline: false
          });
        }

        // Add roles if any
        const roles = member.roles.cache
          .sort((a, b) => b.position - a.position)
          .filter(role => role.id !== interaction.guild.roles.everyone.id)
          .map(role => role.toString());
        
        if (roles.length > 0) {
          embed.addFields({
            name: `Roles [${roles.length}]`,
            value: roles.join(', ')
          });
        }

        // Add user type indicator and badges
        let userBadges = [];
        
        // Get all user badges/flags
        if (targetUser.flags) {
          const flags = targetUser.flags.toArray();
          
          // Map Discord flags to display names and emojis
          const badgeMap = {
            'Staff': '🛡️ Discord Staff',
            'Partner': '⭐ Partnered Server Owner',
            'Hypesquad': '🏠 Hypesquad',
            'BugHunterLevel1': '🐛 Bug Hunter Level 1',
            'BugHunterLevel2': '🐛 Bug Hunter Level 2',
            'ActiveDeveloper': '💻 Active Developer',
            'VerifiedDeveloper': '💻 Verified Developer',
            'VerifiedBot': '🤖 Verified Bot',
            'BotHTTPInteractions': '🤖 HTTP Only Bot',
            'EarlyVerifiedBotDeveloper': '🤖 Early Verified Bot Developer',
            'PremiumEarlySupporter': '💜 Nitro Classic', // Only for early Nitro supporters
            'HypeSquadOnlineHouse1': '🏠 Hypesquad Bravery',
            'HypeSquadOnlineHouse2': '🏠 Hypesquad Brilliance', 
            'HypeSquadOnlineHouse3': '🏠 Hypesquad Balance',
            'Spammer': '⚠️ Spammer',
            'Quarantined': '🚫 Quarantined',
            // Additional flags from Discord.js v14.25.1
            'CertifiedModerator': '🛡️ Certified Moderator',
            'Collaborator': '🤝 Collaborator',
            'DisablePremium': '💔 Premium Disabled',
            'HasUnreadUrgentMessages': '📬 Unread Urgent Messages',
            'MFASMS': '📱 MFA SMS 2FA Enabled',
            'MFA_SMS': '📱 MFA SMS 2FA Enabled',
            'PremiumPromoDismissed': '🙄 Promo Dismissed',
            'RestrictedCollaborator': '🔒 Restricted Collaborator',
            'System': '🔧 Discord System Account',
            'TeamPseudoUser': '👥 Team User',
            'UNDERAGE_DELETED': '❌ Underage Account Deleted',
            'HIGH_GLOBAL_RATE_LIMIT': '⚠️ High Global Rate Limit',
            'DELETED': '❌ Account Deleted',
            'DISABLED_SUSPICIOUS_ACTIVITY': '🔒 Disabled for Suspicious Activity',
            'SELF_DELETED': '❌ Self Deleted',
            'DISABLED': '🔒 Account Disabled'
          };
          
          // Add all available badges
          flags.forEach(flag => {
            if (badgeMap[flag]) {
              userBadges.push(badgeMap[flag]);
            }
          });
        }
        
        // Check for Nitro status (working detection methods)
        if (targetUser.avatarDecoration || targetUser.avatarDecorationURL()) {
          userBadges.push('💜 Nitro');
        }
        
        // Check for unusual activity indicators
        if (member) {
          // Check if user is boosting server
          if (member.premiumSince) {
            userBadges.push('💎 Server Booster');
          }
          
          // Check if user has pending verification
          if (member.pending) {
            userBadges.push('⏳ Pending Verification');
          }

         // Check if user is in timeout
          if (member.isCommunicationDisabled()) {
            userBadges.push('🔇 Timed Out');
          }
        }
        
        // Build footer text with badges only (user type is now in fields)
        let footerText = '';
        if (userBadges.length > 0) {
          footerText = userBadges.join(' | ');
        }
        
        embed.setFooter({ 
          text: footerText || 'No badges',
          iconURL: targetUser.displayAvatarURL({ size: 32 })
        });

        await interaction.editReply({ embeds: [embed] });

      } catch (error) {
        console.error('Error in user command (cached fetch):', error);
        throw error; // Re-throw to be caught by outer try-catch
      }

    } catch (error) {
      console.error('Error in user command:', error);
      const errorMessage = '❌ An error occurred while fetching user information.';
      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply({ content: errorMessage });
        } else {
          await interaction.reply({ content: errorMessage, flags: MessageFlags.Ephemeral });
        }
      } catch (_) {
        // Interaction expired or already responded — nothing we can do
      }
    }
  },
};