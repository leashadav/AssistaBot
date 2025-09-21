const { SlashCommandBuilder } = require('discord.js');
const { invites } = require('../modules/inviteTracker');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('invites')
    .setDescription('Shows invite usage info for this server'),
  async execute(interaction) {
    const guildId = interaction.guild.id;
    const guildInvites = invites.get(guildId);

    if (!guildInvites || guildInvites.size === 0) {
      return interaction.reply({ content: 'No invite data available for this server.', flags: 64 });
    }

    let info = 'Invite usage:\n';
    // Fetch all invites from Discord to get inviter info
    const invitesFromApi = await interaction.guild.invites.fetch();

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