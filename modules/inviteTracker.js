const fs = require('fs');
const path = require('path');
const { sendLog } = require('../modules/logger');
const DEBUG = /^(1|true)$/i.test(String(process.env.ASSISTABOT_DEBUG || ''));

// Cache: per-guild map of invite code -> { uses, inviterId }
let invites = new Map();

// Persistent map of who invited whom: { [guildId]: { [memberId]: inviterId } }
const PERSIST_PATH = path.join(__dirname, '..', 'data', 'inviteTracker.json');
let invitedBy = {};

function loadPersist() {
  try {
    if (fs.existsSync(PERSIST_PATH)) {
      invitedBy = JSON.parse(fs.readFileSync(PERSIST_PATH, 'utf8') || '{}');
    }
  } catch (error) {
    console.error('inviteTracker: failed to load persist file', error);
    invitedBy = {};
  }
}

function savePersist() {
  try {
    fs.writeFileSync(PERSIST_PATH, JSON.stringify(invitedBy, null, 2), 'utf8');
  } catch (error) {
    console.error('inviteTracker: failed to save persist file', error);
  }
}

function setInviterForMember(guildId, memberId, inviterId) {
  if (!invitedBy[guildId]) {
    invitedBy[guildId] = {};
  }
  invitedBy[guildId][memberId] = inviterId || null;
  savePersist();
}

function getInviterForMember(guildId, memberId) {
  return invitedBy[guildId]?.[memberId] || null;
}

async function initInvites(client) {
  loadPersist();
  for (const [guildId, guild] of client.guilds.cache) {
    try {
      const guildInvites = await guild.invites.fetch();
      invites.set(
        guildId,
        new Map(
          guildInvites.map(inv => [inv.code, { uses: inv.uses, inviterId: inv.inviter?.id || null }])
        )
      );
    } catch (error) {
      if (DEBUG) console.warn('initInvites: failed to fetch invites for guild', guildId, error?.message || String(error));
      invites.set(guildId, new Map());
    }
  }
}

function computeInviterTotalUses(guildInvites, inviterId) {
  if (!inviterId) return 0;
  try {
    return guildInvites
      .filter(inv => inv.inviter?.id === inviterId)
      .reduce((acc, inv) => acc + (inv.uses || 0), 0);
  } catch {
    return 0;
  }
}

async function handleInviteJoin(member, client) {
  try {
    const guildInvites = await member.guild.invites.fetch();
    const cached = invites.get(member.guild.id) || new Map();

    // Find the invite that was used (uses increased)
    const usedInvite = guildInvites.find(inv => {
      const prev = cached.get(inv.code);
      return prev ? (prev.uses < inv.uses) : (inv.uses > 0);
    });

    let inviterId = null;
    let inviterTag = 'Unknown';
    let inviteCode = 'Unknown';
    let inviteUrl = '';
    let inviterUses = 0;

    if (usedInvite) {
      inviterId = usedInvite.inviter?.id || null;
      inviterTag = usedInvite.inviter?.tag || String(inviterId);
      inviteCode = usedInvite.code;
      inviteUrl = `https://discord.gg/${inviteCode}`;
      inviterUses = computeInviterTotalUses(guildInvites, inviterId);
      // Persist mapping for leave tracking
      setInviterForMember(member.guild.id, member.id, inviterId);
    }

    const typeText = member.user.bot ? 'Bot' : 'User';
    const contentLines = [
      `**${typeText} Invited**`,
      `Display Name: ${member.user}`,
      `${member.user.tag} (${member.user.id})`
    ];
    if (usedInvite) {
      contentLines.push('', `Used invite [\`${inviteCode}\`](${inviteUrl}) by ${inviterTag}`, `Inviter total uses: ${inviterUses}`);
    } else {
      contentLines.push('', 'Used invite: Unknown');
    }

    sendLog(client, member.guild.id, 'inviteLog', contentLines.join('\n'));

    if (DEBUG) {
      console.info({
        event: 'invite_resolved_on_join',
        guild: member.guild.id,
        user: member.user.id,
        code: inviteCode,
        inviter: inviterId,
        inviterUses
      });
    }

    // Update cached invites after the join
    invites.set(
      member.guild.id,
      new Map(guildInvites.map(inv => [inv.code, { uses: inv.uses, inviterId: inv.inviter?.id || null }]))
    );
  } catch (error) {
    console.error('handleInviteJoin error:', error);
  }
}

async function handleInviteLeave(member, client) {
  try {
    const guildId = member.guild.id;
    const inviterId = getInviterForMember(guildId, member.id);

    let inviterUses = 0;
    let inviterTag = 'Unknown';
    if (inviterId) {
      try {
        const guildInvites = await member.guild.invites.fetch();
        inviterUses = computeInviterTotalUses(guildInvites, inviterId);
        const any = guildInvites.find(inv => inv.inviter?.id === inviterId);
        if (any?.inviter) {
          inviterTag = any.inviter.tag;
        }
      } catch {
        // Ignore invite fetch errors on leave
      }
    }

    const typeText = member.user.bot ? 'Bot' : 'User';
    const lines = [
      `**${typeText} Invited - Left**`,
      `Display Name: ${member.user}`,
      `${member.user.tag} (${member.user.id})`,
      '',
      `Invited by: ${inviterId ? `${inviterTag} (${inviterId})` : 'Unknown'}`
    ];
    if (inviterId) lines.push(`Inviter total uses (current): ${inviterUses}`);

    sendLog(client, guildId, 'inviteLog', lines.join('\n'));

    // Optionally, clean up stored mapping to reduce file size over time
    if (invitedBy[guildId]) {
      delete invitedBy[guildId][member.id];
      savePersist();
    }

    if (DEBUG) {
      console.info({ event: 'invite_on_leave', guild: guildId, user: member.id, inviterId, inviterUses });
    }
  } catch (error) {
    console.error('handleInviteLeave error:', error);
  }
}

module.exports = { initInvites, handleInviteJoin, handleInviteLeave, invites };