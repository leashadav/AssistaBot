const { SlashCommandBuilder } = require('discord.js');
const { invites } = require('../modules/inviteTracker');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('invites')
    .setDescription('Shows invite usage info for this server')
    .setDMPermission(false),
  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: 'This command can only be used in a server.', flags: 64 });
    }
    const guildId = interaction.guild.id;
    const guildInvites = invites.get(guildId);

    if (!guildInvites || guildInvites.size === 0) {
      return interaction.reply({ content: 'No invite data available for this server.', flags: 64 });
    }

    let info = 'Invite usage:\n';
    // Fetch all invites from Discord to get inviter info
    let invitesFromApi;
    try {
      invitesFromApi = await interaction.guild.invites.fetch();
    } catch (e) {
      return interaction.reply({ content: 'I need the Manage Guild permission to read invite data.', flags: 64 });
    }

    for (const [code, uses] of guildInvites) {
      const inviteObj = invitesFromApi.find(inv => inv.code === code);
      let inviterName = 'Unknown';
      if (inviteObj && inviteObj.inviter) {
        const member = await interaction.guild.members.fetch(inviteObj.inviter.id).catch(() => null);
        inviterName = member ? member.displayName : inviteObj.inviter.tag;
      }
      info += `• **${inviterName}** code \`${code}\` used **${uses}** times\n`;
    }

    await interaction.reply({ content: info, flags: 64 });
  },
};