const fs = require('fs');
const path = require('path');
const guildSettings = require('./guildSettings');
const branding = require('./configLoader').load('branding');
const {
  DEFAULT_TIMEZONE,
  getDatePartsInTimezone,
  getDateStringInTimezone,
  getMillisecondsUntilNextDayInTimezone
} = require('../utils/timezone');

const dataFile = path.join(__dirname, '../data/birthdays.json');
const activeRolesFile = path.join(__dirname, '../data/active_birthday_roles.json');
const ONE_DAY_MS = 1000 * 60 * 60 * 24;

// Track the last time birthdays were checked (to prevent multiple checks per day)
let lastCheckData = {
  lastCheckDate: null,  // YYYY-MM-DD format
  lastCheckTime: null,  // Timestamp of last check
  postedBirthdays: {}   // Track birthdays already posted today {guildId: {userId: true}}
};

// Load last check data if it exists
const lastCheckFile = path.join(__dirname, '../data/birthday_last_check.json');
function loadLastCheckData() {
  if (fs.existsSync(lastCheckFile)) {
    try {
      lastCheckData = JSON.parse(fs.readFileSync(lastCheckFile, 'utf8'));
    } catch (e) {}
  }
}
if (process.argv[1] && !process.argv[1].includes('deploy-commands')) {
  loadLastCheckData();
}

function saveLastCheck() {
  try {
    fs.writeFileSync(lastCheckFile, JSON.stringify(lastCheckData, null, 2));
  } catch (e) {
    console.error('Error saving last check data:', e);
  }
}



function safeLoadJSON(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const raw = fs.readFileSync(filePath, 'utf8');
  if (!raw.trim()) return {};
  try { return JSON.parse(raw); } catch (e) { return {}; }
}

let birthdaysByGuild = {};
let activeBirthdayRoles = {};

// Load data
if (process.argv[1] && !process.argv[1].includes('deploy-commands')) {
  if (fs.existsSync(dataFile)) birthdaysByGuild = safeLoadJSON(dataFile) || {};
  if (fs.existsSync(activeRolesFile)) activeBirthdayRoles = safeLoadJSON(activeRolesFile) || {};
}

// Save functions
function saveBirthdays() { fs.writeFileSync(dataFile, JSON.stringify(birthdaysByGuild, null, 2)); }
function saveActiveRoles() { fs.writeFileSync(activeRolesFile, JSON.stringify(activeBirthdayRoles, null, 2)); }

function ensureGuild(guildId) { 
  if (!birthdaysByGuild[guildId]) birthdaysByGuild[guildId] = {}; 
  if (!activeBirthdayRoles[guildId]) activeBirthdayRoles[guildId] = {};
}

function setBirthday(guildId, userId, dateString) { ensureGuild(guildId); birthdaysByGuild[guildId][userId] = dateString; saveBirthdays(); }
function deleteBirthday(guildId, userId) { ensureGuild(guildId); delete birthdaysByGuild[guildId][userId]; saveBirthdays(); }
function getGuildBirthdays(guildId) { return birthdaysByGuild[guildId] || {}; }

function getTodaysBirthdays(guildId) {
  if (!guildId) return [];
  const { month, day } = getDatePartsInTimezone(new Date(), DEFAULT_TIMEZONE);
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  const map = birthdaysByGuild[guildId] || {};
  return Object.entries(map).filter(([, d]) => {
    if (typeof d !== 'string') return false;
    // Normalize to zero-padded MM/DD for comparison
    const parts = d.split('/');
    if (parts.length < 2) return false;
    const bMm = parts[0].padStart(2, '0');
    const bDd = parts[1].padStart(2, '0');
    return bMm === mm && bDd === dd;
  });
}

function getAge(dateString) {
  if (!dateString || typeof dateString !== 'string') return null;
  
  // Check if it's MM/DD format (no year) - return null immediately
  if (/^\d{2}\/\d{2}$/.test(dateString)) return null;
  if (/^\d{2}-\d{2}$/.test(dateString)) return null;
  
  try {
    const isoDate = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(dateString);
    const monthFirstDate = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(dateString);
    const birthYear = Number(isoDate?.[1] || monthFirstDate?.[3]);
    const birthMonth = Number(isoDate?.[2] || monthFirstDate?.[1]);
    const birthDay = Number(isoDate?.[3] || monthFirstDate?.[2]);
    if (!birthYear || !birthMonth || !birthDay) return null;
    const today = getDatePartsInTimezone(new Date(), DEFAULT_TIMEZONE);
    let age = today.year - birthYear;
    if (today.month < birthMonth || (today.month === birthMonth && today.day < birthDay)) age--;
    return age > 0 ? age : null;
  } catch (e) { return null; }
}

async function checkBirthdays(client, force = false) {
  if (!client) return;

  await checkAndRemoveExpiredRoles(client);

  const todayString = getDateStringInTimezone(new Date(), DEFAULT_TIMEZONE);

  if (!lastCheckData.postedBirthdays) lastCheckData.postedBirthdays = {};

  // Reset posted tracking on a new day
  if (lastCheckData.lastCheckDate !== todayString) {
    lastCheckData.postedBirthdays = {};
    lastCheckData.lastCheckDate = todayString;
    lastCheckData.lastCheckTime = null;
  }

  // Skip if already ran today (unless forced)
  if (!force && lastCheckData.lastCheckTime) return;

  lastCheckData.lastCheckTime = Date.now();
  
  for (const guild of client.guilds.cache.values()) {
    const guildId = guild.id;
    try {
      const settings = guildSettings.getSettings(guildId) || {};
      const bInfo = settings?.birthdayInfo || {};
      const roleId = bInfo?.birthdayRole;
      const channelId = bInfo?.birthdayChannel;
      
      if (!roleId || !channelId) continue;
      
      const role = await guild.roles.fetch(roleId).catch(() => null);
      if (!role) continue;
      
      const birthdays = getTodaysBirthdays(guildId);
      const birthdayUserIds = new Set(birthdays.map(([userId]) => userId));
      
      for (const [memberId, member] of role.members) {
        if (!birthdayUserIds.has(memberId)) {
          try {
            await member.roles.remove(roleId);
            if (activeBirthdayRoles[guildId]?.[memberId]) {
              delete activeBirthdayRoles[guildId][memberId];
              if (Object.keys(activeBirthdayRoles[guildId]).length === 0) {
                delete activeBirthdayRoles[guildId];
              }
              saveActiveRoles();
            }
          } catch (e) {}
        }
      }
      
      if (!birthdays.length) continue;
      
      const defaultMessage = `${branding.birthdayEmoji || '🎂'} Happy \${ageText}Birthday <@\${userId}>!`;
      const template = (bInfo?.message?.trim()) || defaultMessage;
      
      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (!channel?.send) continue;
      
      if (!lastCheckData.postedBirthdays[guildId]) {
        lastCheckData.postedBirthdays[guildId] = {};
      }
      
      for (const [userId, date] of birthdays) {
        try {
          const member = await guild.members.fetch(userId).catch(() => null);
          if (!member) continue;
          
          if (!lastCheckData.postedBirthdays[guildId][userId]) {
            const age = getAge(date);
            const ageText = age ? `${age} ` : '';
            
            try {
              const msg = template
                .replace(/\$\{ageText\}/g, ageText)
                .replace(/\$\{userId\}/g, userId);
              await channel.send(msg);
              lastCheckData.postedBirthdays[guildId][userId] = true;
            } catch (e) {
              await channel.send(`${branding.birthdayEmoji || '🎂'} Happy ${ageText}Birthday <@${userId}>!`).catch(() => {});
              lastCheckData.postedBirthdays[guildId][userId] = true;
            }
          }
          
          if (roleId && member.roles?.add) {
            try {
              await member.roles.add(roleId);
              
              const expirationTime = Date.now() + ONE_DAY_MS;
              if (!activeBirthdayRoles[guildId]) activeBirthdayRoles[guildId] = {};
              activeBirthdayRoles[guildId][userId] = expirationTime;
              saveActiveRoles();
            } catch (e) {}
          }
        } catch (e) {}
      }
    } catch (e) {}
  }
  
  saveLastCheck();
}

// Export the forceCheck function for manual checks
async function forceCheck(client) {
  return checkBirthdays(client, true);
}

// Check for and remove expired birthday roles
async function checkAndRemoveExpiredRoles(client) {
  const now = Date.now();
  let madeChanges = false;

  for (const [guildId, users] of Object.entries(activeBirthdayRoles)) {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) continue;

    for (const [userId, expirationTime] of Object.entries(users)) {
      if (expirationTime <= now) {
        try {
          const member = await guild.members.fetch(userId).catch(() => null);
          if (member) {
            const settings = guildSettings.getSettings(guildId) || {};
            const roleId = settings?.birthdayInfo?.birthdayRole;
            if (roleId) {
              await member.roles.remove(roleId);
            }
          }
          delete activeBirthdayRoles[guildId][userId];
          madeChanges = true;
        } catch (e) {
          console.error(`[Birthday] Error removing expired birthday role from ${userId} in ${guildId}:`, e);
        }
      }
    }

    // Clean up empty guild entries
    if (Object.keys(activeBirthdayRoles[guildId]).length === 0) {
      delete activeBirthdayRoles[guildId];
      madeChanges = true;
    }
  }

  if (madeChanges) {
    try {
      saveActiveRoles();
    } catch (e) {
      console.error('[Birthday] Error saving active roles:', e);
    }
  }
}

// Set up periodic checks
let checkInterval;
let roleCleanupInterval;
function startPeriodicChecks(client) {
  if (!client) return;
  
  if (checkInterval) {
    try { clearTimeout(checkInterval); } catch (e) {}
    checkInterval = null;
  }
  if (roleCleanupInterval) {
    clearInterval(roleCleanupInterval);
    roleCleanupInterval = null;
  }

  roleCleanupInterval = setInterval(() => {
    if (client && client.guilds) checkAndRemoveExpiredRoles(client);
  }, 60 * 60 * 1000);
  
  const scheduleNextCheck = () => {
    if (!client || !client.guilds) return;

    const msUntilMidnight = getMillisecondsUntilNextDayInTimezone(DEFAULT_TIMEZONE);

    checkInterval = setTimeout(() => {
      if (client && client.guilds) {
        checkBirthdays(client);
        scheduleNextCheck();
      }
    }, msUntilMidnight);
  };

  scheduleNextCheck();
  // Also run once shortly after startup in case today's birthdays haven't been posted yet
  setTimeout(() => { if (client && client.guilds) checkBirthdays(client); }, 60000);
}

module.exports = { 
  setBirthday, 
  deleteBirthday, 
  getTodaysBirthdays, 
  getGuildBirthdays, 
  getAge, 
  checkBirthdays,
  forceCheck,
  startPeriodicChecks
};