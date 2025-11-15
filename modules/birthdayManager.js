const fs = require('fs');
const path = require('path');
const guildSettings = require('./guildSettings');

const dataFile = path.join(__dirname, '../data/birthdays.json');
const ONE_DAY_MS = 1000 * 60 * 60 * 24;

function safeLoadJSON(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const raw = fs.readFileSync(filePath, 'utf8');
  if (!raw.trim()) return {};
  try { return JSON.parse(raw); } catch (e) { return {}; }
}

let birthdaysByGuild = {};
if (fs.existsSync(dataFile)) birthdaysByGuild = safeLoadJSON(dataFile) || {};

function saveBirthdays() { fs.writeFileSync(dataFile, JSON.stringify(birthdaysByGuild, null, 2)); }
function ensureGuild(guildId) { if (!birthdaysByGuild[guildId]) birthdaysByGuild[guildId] = {}; }

function setBirthday(guildId, userId, dateString) { ensureGuild(guildId); birthdaysByGuild[guildId][userId] = dateString; saveBirthdays(); }
function deleteBirthday(guildId, userId) { ensureGuild(guildId); delete birthdaysByGuild[guildId][userId]; saveBirthdays(); }
function getGuildBirthdays(guildId) { return birthdaysByGuild[guildId] || {}; }

function getTodaysBirthdays(guildId) {
  if (!guildId) return [];
  const today = new Date();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  const monthDay = `${mm}-${dd}`;
  const map = birthdaysByGuild[guildId] || {};
  return Object.entries(map).filter(([, d]) => typeof d === 'string' && d.includes(monthDay));
}

function getAge(dateString) {
  if (!dateString || typeof dateString !== 'string') return null;
  if (/^\d{2}-\d{2}$/.test(dateString)) return null;
  try {
    let norm = dateString;
    if (/^\d{2}-\d{2}-\d{4}$/.test(dateString)) {
      const [mm, dd, yyyy] = dateString.split('-'); norm = `${yyyy}-${mm}-${dd}`;
    } else norm = dateString.replace(/\//g, '-');
    const bd = new Date(norm);
    if (isNaN(bd.getTime())) return null;
    const t = new Date();
    let age = t.getFullYear() - bd.getFullYear();
    const m = t.getMonth() - bd.getMonth();
    if (m < 0 || (m === 0 && t.getDate() < bd.getDate())) age--;
    return age > 0 ? age : null;
  } catch (e) { return null; }
}

async function checkBirthdays(client) {
  if (!client) return;
  for (const guild of client.guilds.cache.values()) {
    const guildId = guild.id;
    try {
      const birthdays = getTodaysBirthdays(guildId);
      if (!birthdays.length) continue;
      const settings = guildSettings.getSettings(guildId) || {};
      const bInfo = settings?.birthdayInfo || {};
      const channelId = bInfo?.birthdayChannel; const roleId = bInfo?.birthdayRole;
      const defaultMessage = '<:happybirthday:1410064532398805152> Happy ${ageText}Birthday <@${userId}>!';
      const template = (bInfo && typeof bInfo.message === 'string' && bInfo.message.trim()) ? bInfo.message : defaultMessage;
      if (!channelId) continue;
      const channel = await client.channels.fetch(channelId).catch(() => null); if (!channel || typeof channel.send !== 'function') continue;
      for (const [userId, date] of birthdays) {
        try {
          const member = await guild.members.fetch(userId).catch(() => null); if (!member) continue;
          const age = getAge(date); const ageText = age ? `${age} ` : '';
          try { const msg = template.replace(/\$\{ageText\}/g, ageText).replace(/\$\{userId\}/g, userId); await channel.send(msg); }
          catch (_) { await channel.send(`<:happybirthday:1410064532398805152> Happy ${ageText}Birthday <@${userId}>!`); }
          if (roleId && member.roles && typeof member.roles.add === 'function') {
            await member.roles.add(roleId).catch(() => null);
            setTimeout(() => { member.roles.remove(roleId).catch(() => null); }, ONE_DAY_MS);
          }
        } catch (e) { console.error(`Error handling birthday ${userId} in ${guildId}:`, e); }
      }
    } catch (e) { console.error(`Error checking birthdays for ${guild.id}:`, e); }
  }
}

module.exports = { setBirthday, deleteBirthday, getTodaysBirthdays, getGuildBirthdays, getAge, checkBirthdays };