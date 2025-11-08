const { EmbedBuilder } = require('discord.js');

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

function buildWelcomeEmbed({ guild, user, message, embedColor }) {
  const color = parseColor(embedColor) ?? 0xff6600;
  const avatar = user.displayAvatarURL({ size: 128 });
  const title = `Welcome ${user.displayName || user.username}`;
  const desc = message || '';
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setThumbnail(avatar)
    .setDescription(desc)
    .setFooter({ text: `You are member #${guild.memberCount}` });
}

function buildGoodbyeEmbed({ guild, user, message, embedColor }) {
  const color = parseColor(embedColor) ?? 0xff6600;
  const avatar = user.displayAvatarURL({ size: 128 });
  const title = `Goodbye ${user.displayName || user.username}`;
  const desc = message || '';
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setThumbnail(avatar)
    .setDescription(desc)
    .setFooter({ text: `Members remaining: ${guild.memberCount}` });
}

module.exports = {
  parseColor,
  renderTemplate,
  buildWelcomeEmbed,
  buildGoodbyeEmbed
};
