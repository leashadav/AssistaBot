const fs = require('fs');
const path = require('path');
const BirthdayInfo = require('../config.json').BirthdayInfo;

const dataFile = path.join(__dirname, '../data/birthdays.json');

function safeLoadJSON(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const raw = fs.readFileSync(filePath, 'utf8');
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.error('Error loading birthday data:', e);
    return {};
  }
}

// Load or initialize data
let birthdays = {};
if (fs.existsSync(dataFile)) {
  birthdays = safeLoadJSON(dataFile);
}

function saveBirthdays() {
  fs.writeFileSync(dataFile, JSON.stringify(birthdays, null, 2));
}

/**
 * Add or update a birthday
 */
function setBirthday(userId, dateString) {
  // dateString format: "MM-DD" or "MM-DD-YYYY"
  birthdays[userId] = dateString;
  saveBirthdays();
}

/**
 * Delete a birthday
 */
function deleteBirthday(userId) {
  delete birthdays[userId];
  saveBirthdays();
}

/**
 * Get all birthdays happening today
 */
function getTodaysBirthdays() {
  const today = new Date();
  const monthDay = today.toISOString().slice(5, 10); // "MM-DD"

  return Object.entries(birthdays).filter(([id, date]) => {
    return date.slice(5) === monthDay || date === monthDay; // handles with/without year
  });
}

/**
 * Calculate age if year is included
 */
function getAge(dateString) {
  if (dateString.length === 5) return null; // no year
  const today = new Date();
  const birthDate = new Date(dateString);
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
}

  // Run every day at midnight
  setInterval(checkBirthdays, 1000 * 60 * 60 * 24);
  checkBirthdays(); // Run once on startup

async function checkBirthdays() {
  const birthdays = getTodaysBirthdays();
  if (!birthdays.length) return;

  const channel = await client.channels.fetch(BIRTHDAY_CHANNEL);

  for (const [userId, date] of birthdays) {
    try {
      const guild = channel.guild;
      const member = await guild.members.fetch(userId);
      const age = getAge(date);

      // Birthday message
      await channel.send(`<:happybirthday:1410064532398805152> Happy ${age ? `${age}` : ''} Birthday <@${userId}>!`);

      // Add role
      if (BIRTHDAY_ROLE) {
        await member.roles.add(BIRTHDAY_ROLE);

        // Remove role after 24h
        setTimeout(() => {
          member.roles.remove(BIRTHDAY_ROLE).catch(() => {});
        }, 1000 * 60 * 60 * 24);
      }
    } catch (err) {
      console.error(`Error handling birthday for ${userId}`, err);
    }
  }
}


module.exports = { setBirthday, deleteBirthday, getTodaysBirthdays, getAge };