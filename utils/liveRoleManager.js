async function resolveLinkedMember(guild, linkedUser) {
  const rawValue = String(linkedUser || '').trim();
  const mention = rawValue.match(/^<@!?(\d+)>$/);
  const value = mention ? mention[1] : rawValue;
  if (!value) return null;

  if (/^\d+$/.test(value)) {
    return guild.members.fetch(value).catch(() => null);
  }

  const query = value.replace(/^@/, '').trim();
  if (!query) return null;

  const matches = await guild.members.search({ query, limit: 100 }).catch(err => {
    console.error(`[LiveRoles] Could not search for "${query}" in guild ${guild.id}: ${err.message}`);
    return null;
  });
  if (!matches) return null;

  const lowerQuery = query.toLowerCase();
  const exactMatch = matches.find(member => [
    member.user?.username,
    member.user?.globalName,
    member.user?.tag,
    member.nickname,
    member.displayName
  ].some(candidate => String(candidate || '').toLowerCase() === lowerQuery));

  if (exactMatch) return exactMatch;
  return matches.size === 1 ? matches.first() : null;
}

async function updateLiveRoles(client, guildId, linkedUser, roleIds, action, reason, platform) {
  if (!Array.isArray(roleIds) || roleIds.length === 0 || !linkedUser) return;

  try {
    const guild = await client.guilds.fetch(guildId);
    const member = await resolveLinkedMember(guild, linkedUser);
    if (!member) {
      console.error(`[${platform}] Could not resolve linked Discord user "${linkedUser}" in guild ${guildId}`);
      return;
    }

    for (const roleId of roleIds) {
      const alreadyHasRole = member.roles.cache.has(roleId);
      if ((action === 'add' && alreadyHasRole) || (action === 'remove' && !alreadyHasRole)) continue;

      const role = await guild.roles.fetch(roleId).catch(err => {
        console.error(`[${platform}] Could not fetch live role ${roleId} in guild ${guildId}: ${err.message}`);
        return null;
      });
      if (!role) continue;

      try {
        await member.roles[action](role, reason);
      } catch (err) {
        console.error(`[${platform}] Failed to ${action} live role ${role.name} ${action === 'add' ? 'to' : 'from'} ${member.displayName}: ${err.message}`);
      }
    }
  } catch (err) {
    console.error(`[${platform}] Error updating live roles in guild ${guildId}: ${err.message}`);
  }
}

module.exports = { updateLiveRoles };
