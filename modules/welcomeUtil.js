const { EmbedBuilder } = require('discord.js');

// Badge map for user flags
const BADGE_MAP = {
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
  'PremiumEarlySupporter': '💜 Nitro Classic',
  'HypeSquadOnlineHouse1': '🏠 Hypesquad Bravery',
  'HypeSquadOnlineHouse2': '🏠 Hypesquad Brilliance',
  'HypeSquadOnlineHouse3': '🏠 Hypesquad Balance',
  'Spammer': '⚠️ Spammer',
  'Quarantined': '🚫 Quarantined',
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

function parseColor(raw) {
  if (raw == null) return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.floor(raw) & 0xFFFFFF;
  let s = String(raw).trim();
  if (!s) return null;
  if (s.startsWith('#')) s = s.slice(1);
  if (/^0x/i.test(s)) s = s.slice(2);
  if (/^[0-9a-fA-F]{6}$/.test(s)) return parseInt(s, 16);
  const n = Number(s);
  if (Number.isFinite(n) && n >= 0 && n <= 0xFFFFFF) return Math.floor(n);
  return null;
}

function getUserBadges(user) {
  const badges = [];
  
  // Get all user flags/badges
  if (user.flags) {
    const flags = user.flags.toArray();
    flags.forEach(flag => {
      if (BADGE_MAP[flag]) {
        badges.push(BADGE_MAP[flag]);
      }
    });
  }
  
  // Check for Nitro status
  if (user.avatarDecoration || user.avatarDecorationURL?.()) {
    badges.push('💜 Nitro');
  }
  
  return badges;
}

function renderTemplate(tpl, guild, user, memberDisplayName) {
  const replacements = {
    '{user}': user.username,
    '{username}': user.username,
    '{displayName}': memberDisplayName || user.username,
    '{tag}': user.tag,
    '{id}': user.id,
    '{mention}': `<@${user.id}>`,
    '{server}': guild.name,
    '{guild}': guild.name,
    '{memberCount}': String(guild.memberCount || guild.members?.cache?.size || '')
  };
  let out = String(tpl || '');
  for (const [k, v] of Object.entries(replacements)) {
    out = out.split(k).join(v);
  }
  return out;
}

function buildWelcomeEmbed({ guild, user, description, title, embedColor, inviter }) {
  const color = parseColor(embedColor) ?? 0xff6600;
  const avatar = user.displayAvatarURL({ size: 128 });
  const embedTitle = title || `Welcome ${user.displayName || user.username}`;
  const desc = description || null;
  
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(embedTitle)
    .setImage(avatar)
    .setDescription(desc);
  
  // Build footer with user type, inviter info, badges, and account info
  let footerParts = [];

  // Add ID
  footerParts.push(`ID: ${user.id}`);
  
  // Add user type indicator
  footerParts.push(`User is ${user.bot ? '🤖 Bot' : '🤷 Human'}`);
  
  // Add age group (adult/minor status)
  if (user.ageGroup) {
    const ageGroupMap = {
      'unknown': 'Age: Unknown',
      'minor': '🔞 Minor',
      'adult': '👤 Adult'
    };
    footerParts.push(ageGroupMap[user.ageGroup] || `Age: ${user.ageGroup}`);
  }
  
  // Add verification status
  if (user.verified !== undefined) {
    footerParts.push(`${user.verified ? 'Verified' : 'Unverified'}`);
  }
  
  // Add account creation date
  if (user.createdAt) {
    const createdDate = user.createdAt.toLocaleDateString();
    const accountAge = Math.floor((Date.now() - user.createdAt.getTime()) / (1000 * 60 * 60 * 24));
    footerParts.push(`Account created: ${createdDate} (${accountAge} days ago)`);
  }
  
  // Add user badges if any
  const badges = getUserBadges(user);
  if (badges.length > 0) {
    footerParts.push(badges.join(' | '));
  }
  
  // Add inviter information if available
  if (inviter) {
    const inviterName = inviter.username || inviter.tag || inviter;
    footerParts.push(`Invited By: ${inviterName}`);
  }

  // Add member count
  footerParts.push(`Member #${guild.memberCount}`);

  embed.setFooter({ 
    text: footerParts.join('\n'),
  });
  
  return embed;
}

function buildGoodbyeEmbed({ guild, user, member, description, title, embedColor, inviter, leaveType }) {
  const color = parseColor(embedColor) ?? 0xff6600;
  const avatar = user.displayAvatarURL({ size: 128 });
  const embedTitle = title || `Goodbye ${user.displayName || user.username}`;
  const desc = description || null;
  
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(embedTitle)
    .setImage(avatar)
    .setDescription(desc);
  
  // Build footer with user type, inviter info, badges, and leave info
  let footerParts = [];
  
  // Add ID
  footerParts.push(`ID: ${user.id}`);
  // Add user type indicator
  footerParts.push(`User is ${user.bot ? '🤖 Bot' : '🤷 Human'}`);
  
  // Add age group (adult/minor status)
  if (user.ageGroup) {
    const ageGroupMap = {
      'unknown': 'Age: Unknown',
      'minor': '🔞 Minor',
      'adult': '👤 Adult'
    };
    footerParts.push(ageGroupMap[user.ageGroup] || `Age: ${user.ageGroup}`);
  }
  
  // Add verification status
  if (user.verified !== undefined) {
    footerParts.push(`${user.verified ? 'Verified' : 'Unverified'}`);
  }
  
  // Add account creation date
  if (user.createdAt) {
    const createdDate = user.createdAt.toLocaleDateString();
    const accountAge = Math.floor((Date.now() - user.createdAt.getTime()) / (1000 * 60 * 60 * 24));
    footerParts.push(`Account created: ${createdDate} (${accountAge} days ago)`);
  }
  
  // Add join date if member is available
  if (member && member.joinedAt) {
    const joinDate = member.joinedAt.toLocaleDateString();
    const joinDuration = Math.floor((Date.now() - member.joinedAt.getTime()) / (1000 * 60 * 60 * 24));
    footerParts.push(`Joined: ${joinDate} (${joinDuration} days ago)`);
  }
  
  // Add user badges if any
  const badges = getUserBadges(user);
  if (badges.length > 0) {
    footerParts.push(badges.join(' | '));
  }
  
  // Add inviter information if available
  if (inviter) {
    const inviterName = inviter.username || inviter.tag || inviter;
    footerParts.push(`Was Invited By: ${inviterName}`);
  }

  // Add leave type (banned/kicked/left)
  if (leaveType) {
    footerParts.push(`📢 ${leaveType}`);
  }

  // Add member count
  footerParts.push(`Members remaining: ${guild.memberCount}`);

  embed.setFooter({ 
    text: footerParts.join('\n'),
  });
  
  return embed;
}

module.exports = {
  parseColor,
  renderTemplate,
  buildWelcomeEmbed,
  buildGoodbyeEmbed,
  getUserBadges
};