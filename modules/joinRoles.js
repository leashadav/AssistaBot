const guildSettings = require('./guildSettings');

const ASSIGNMENT_DELAY_MS = 30 * 1000;
const pendingAssignments = new Map();

function getAssignmentKey(guildId, userId) {
  return `${guildId}:${userId}`;
}

function hasSuspiciousFlag(member) {
  const flags = member.user.flags;
  return Boolean(flags?.has('Spammer') || flags?.has('Quarantined'));
}

function getRoleCategory(member) {
  if (hasSuspiciousFlag(member)) return 'suspicious';
  return member.user.bot ? 'bots' : 'members';
}

function cancel(member) {
  const key = getAssignmentKey(member.guild.id, member.id);
  const timer = pendingAssignments.get(key);
  if (timer) {
    clearTimeout(timer);
    pendingAssignments.delete(key);
  }
}

async function assignRoles(member) {
  const settings = guildSettings.getSettings(member.guild.id).joinRoles;
  if (!settings?.enabled || member.pending) return;

  const category = getRoleCategory(member);
  const roleIds = Array.isArray(settings[category]) ? settings[category] : [];
  if (roleIds.length === 0) return;

  const validRoleIds = roleIds.filter(roleId => {
    if (member.guild.roles.cache.has(roleId)) return true;
    console.error(`[Join Roles] Configured role ${roleId} does not exist in guild ${member.guild.id}.`);
    return false;
  });
  if (validRoleIds.length === 0) return;

  await member.roles.add(validRoleIds, 'Automatic join role assignment after screening delay');
}

function schedule(member) {
  if (member.pending) return;

  const settings = guildSettings.getSettings(member.guild.id).joinRoles;
  if (!settings?.enabled) return;
  if (!['members', 'bots', 'suspicious'].some(category => settings[category]?.length)) return;

  cancel(member);
  const key = getAssignmentKey(member.guild.id, member.id);
  const timer = setTimeout(() => {
    pendingAssignments.delete(key);
    assignRoles(member).catch(error => {
      console.error(`[Join Roles] Failed assigning roles to ${member.id} in guild ${member.guild.id}:`, error);
    });
  }, ASSIGNMENT_DELAY_MS);
  timer.unref?.();
  pendingAssignments.set(key, timer);
}

function handleMemberUpdate(oldMember, newMember) {
  if (oldMember.pending && !newMember.pending) {
    schedule(newMember);
  }
}

module.exports = { schedule, handleMemberUpdate, cancel, ASSIGNMENT_DELAY_MS };
