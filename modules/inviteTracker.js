const { saveData, loadData } = require('../utils/database');
const { logGeneral, sendLog } = require('../modules/logger');

let invites = new Map();

async function initInvites(client) {
  for (const [guildId, guild] of client.guilds.cache) {
    const guildInvites = await guild.invites.fetch();
    invites.set(guildId, new Map(guildInvites.map(inv => [inv.code, inv.uses])));
  }
}

async function handleInviteJoin(member, client) {
  const guildInvites = await member.guild.invites.fetch();
  const cachedInvites = invites.get(member.guild.id);

  // Find the invite that was used
  const usedInvite = guildInvites.find(inv => cachedInvites.get(inv.code) < inv.uses);
  if (usedInvite) {
    const inviter = usedInvite.inviter ? usedInvite.inviter.tag : 'Unknown';
    const inviteCode = usedInvite.code;
    const inviteUrl = `https://discord.gg/${inviteCode}`;

    // Log to the invite log channel
    const content = `${member.user.tag} joined using invite \`${inviteCode}\` by ${inviter}. [Invite Link](${inviteUrl})`;
    sendLog(client, 'generalLog', content); // Send it to the general log channel
    sendLog(client, 'memberJoin', content);  // Send it to the member join log channel (optional)

    console.log(`${member.user.tag} joined using invite ${inviteCode} by ${inviter}`);
  }

  // Update cached invites after the join
  invites.set(member.guild.id, new Map(guildInvites.map(inv => [inv.code, inv.uses])));
}

module.exports = { initInvites, handleInviteJoin };