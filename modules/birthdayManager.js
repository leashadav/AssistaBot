const fs = require('fs');
const path = require('path');
const guildSettings = require('./guildSettings');

const dataFile = path.join(__dirname, '../data/birthdays.json');
const ONE_DAY_MS = 1000 * 60 * 60 * 24;

function safeLoadJSON(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const raw = fs.readFileSync(filePath, 'utf8');
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch (error) {
    console.error('Error loading birthday data:', error);
    return {};
  }
}

// Load or initialize data keyed by guildId
let birthdaysByGuild = {};
if (fs.existsSync(dataFile)) {
  const loaded = safeLoadJSON(dataFile);
  birthdaysByGuild = typeof loaded === 'object' && !Array.isArray(loaded) ? loaded : {};
}

function saveBirthdays() {
  try {
    fs.writeFileSync(dataFile, JSON.stringify(birthdaysByGuild, null, 2));
  } catch (error) {
    console.error('Error saving birthday data:', error);
  }
}

function ensureGuild(guildId) {
  if (!birthdaysByGuild[guildId]) {
    birthdaysByGuild[guildId] = {};
  }
}

/**
 * Add or update a birthday for a user in a guild
 */
function setBirthday(guildId, userId, dateString) {
  ensureGuild(guildId);
  birthdaysByGuild[guildId][userId] = dateString; // MM-DD or MM-DD-YYYY
  saveBirthdays();
}

/**
 * Delete a birthday for a user in a guild
 */
function deleteBirthday(guildId, userId) {
  ensureGuild(guildId);
  delete birthdaysByGuild[guildId][userId];
  saveBirthdays();
}

/**
 * Get all birthdays happening today for a guild
 */
function getTodaysBirthdays(guildId) {
  if (!guildId) return [];
  const today = new Date();
  const monthDay = today.toISOString().slice(5, 10); // "MM-DD"
  const map = birthdaysByGuild[guildId] || {};
  return Object.entries(map).filter(([, date]) => {
    // Handle both MM-DD and MM-DD-YYYY formats
    return date.slice(5) === monthDay || date === monthDay;
  });
}

/** Return all birthdays map for a guild */
function getGuildBirthdays(guildId) {
  return birthdaysByGuild[guildId] || {};
}

/**
 * Calculate age if year is included
 */
function getAge(dateString) {
  if (dateString.length === 5) return null; // no year
  try {
    const today = new Date();
    const birthDate = new Date(dateString);
    if (isNaN(birthDate.getTime())) return null;
    
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    return age > 0 ? age : null;
  } catch {
    return null;
  }
}

/**
 * Check and handle birthdays for all guilds
 */
async function checkBirthdays(client) {
  if (!client) return;

  for (const [guildId] of client.guilds.cache) {
    try {
      const birthdays = getTodaysBirthdays(guildId);
      if (!birthdays.length) continue;

      const settings = guildSettings.getSettings(guildId);
      const birthdayInfo = settings?.birthdayInfo;
      const channelId = birthdayInfo?.birthdayChannel;
      const roleId = birthdayInfo?.birthdayRole;

      if (!channelId) continue;

      const channel = await client.channels.fetch(channelId);
      if (!channel?.isTextBased()) continue;

      const guild = channel.guild;

      for (const [userId, date] of birthdays) {
        try {
          const member = await guild.members.fetch(userId).catch(() => null);
          if (!member) continue;

          const age = getAge(date);
          const ageText = age ? `${age} ` : '';

          // Birthday message
          await channel.send(`<:happybirthday:1410064532398805152> Happy ${ageText}Birthday <@${userId}>!`);

          // Add role
          if (roleId) {
            await member.roles.add(roleId).catch(() => {
              // Ignore role add errors
            });

            // Remove role after 24h
            setTimeout(() => {
              member.roles.remove(roleId).catch(() => {
                // Ignore role remove errors
              });
            }, ONE_DAY_MS);
          }
        } catch (error) {
          console.error(`Error handling birthday for ${userId} in guild ${guildId}:`, error);
        }
      }
    } catch (error) {
      console.error(`Error checking birthdays for guild ${guildId}:`, error);
    }
  }
}

module.exports = { setBirthday, deleteBirthday, getTodaysBirthdays, getGuildBirthdays, getAge, checkBirthdays };