/**
 * @file Invites Command
 * @module commands/invites
 * @description This module provides functionality to track and display invite usage statistics for the server.
 * It shows which users have invited others and how many times each invite code has been used.
 * @requires discord.js
 * @requires ../modules/inviteTracker
 */

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { invites } = require('../modules/inviteTracker');

/**
 * Command data and execution logic for the 'invites' command.
 * @type {Object}
 * @property {SlashCommandBuilder} data - The command definition.
 * @property {Function} execute - The command execution function.
 */
module.exports = {
  /**
   * Command configuration and options.
   * @type {SlashCommandBuilder}
   */
  data: new SlashCommandBuilder()
    .setName('invites')
    .setDescription('View invite usage statistics for this server')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('View invite stats for a specific user')
        .setRequired(false)
    ),

  /**
   * Executes the invites command to display invite usage statistics.
   * @async
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction that triggered the command.
   * @returns {Promise<void>}
   * @throws {Error} If there's an error fetching or processing invite data.
   */
  async execute(interaction) {
    // Ensure the command is used in a server
    if (!interaction.inGuild()) {
      return interaction.reply({ 
        content: '❌ This command can only be used in a server.',
        flags: MessageFlags.Ephemeral
      });
    }

    try {
      // Defer the reply to allow time for data processing
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const guildId = interaction.guild.id;
      const guildInvites = invites.get(guildId);
      const targetUser = interaction.options.getUser('user');

      // Handle case where no invite data is available
      if (!guildInvites || guildInvites.size === 0) {
        return interaction.editReply({ 
          content: 'No invite data available for this server.',
          flags: MessageFlags.Ephemeral
        });
      }

      // Fetch all invites from the Discord API
      let invitesFromApi;
      try {
        invitesFromApi = await interaction.guild.invites.fetch();
      } catch (error) {
        console.error('Error fetching invites:', error);
        return interaction.editReply({ 
          content: '❌ Failed to fetch invite data. Please try again later.',
          flags: MessageFlags.Ephemeral
        });
      }

      let info = '## 📊 Invite Statistics\n\n';
      const inviteData = [];

      // Process each invite code
      for (const [code, inviteDataObj] of guildInvites) {
        const invite = invitesFromApi.find(inv => inv.code === code);
        if (!invite || !invite.inviter) continue;

        // If filtering by user and this isn't their invite, skip
        if (targetUser && invite.inviter.id !== targetUser.id) continue;

        const member = await interaction.guild.members.fetch(invite.inviter.id).catch(() => null);
        const inviterName = member ? member.displayName : invite.inviter.username;
        
        inviteData.push({
          inviter: inviterName,
          code,
          uses: inviteDataObj.uses,
          maxUses: invite.maxUses || 'Unlimited',
          expiresAt: invite.expiresAt ? new Date(invite.expiresAt).toLocaleDateString() : 'Never'
        });
      }

      // Handle no results when filtering by user
      if (targetUser && inviteData.length === 0) {
        return interaction.editReply({
          content: `No invite data found for ${targetUser.username}.`,
          flags: MessageFlags.Ephemeral
        });
      }

      // Sort by number of uses (descending)
      inviteData.sort((a, b) => b.uses - a.uses);

      // Format the output
      info += inviteData
        .map(invite => 
          `**${invite.inviter}**\n` +
          `• Code: \`${invite.code}\`\n` +
          `• Uses: **${invite.uses}** (Max: ${invite.maxUses})\n` +
          `• Expires: ${invite.expiresAt}\n`
        )
        .join('\n');

      // Add a note if filtered by user
      if (targetUser) {
        info += `\nShowing invites created by ${targetUser.username}`;
      }

      return interaction.editReply({ 
        content: info,
        flags: MessageFlags.Ephemeral
      });

    } catch (error) {
      console.error('Error in invites command:', error);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ 
          content: '❌ An error occurred while processing your request.',
          flags: MessageFlags.Ephemeral
        });
      } else {
        await interaction.editReply({
          content: '❌ An error occurred while processing your request.',
          flags: MessageFlags.Ephemeral
        });
      }
    }
  }
};