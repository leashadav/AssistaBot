const moment = require('moment');
const { saveData, loadData } = require('../utils/database');

let birthdays = loadData('birthdays.json') || {};

function setBirthday(userId, date) {
  birthdays[userId] = date;
  saveData('birthdays.json', birthdays);
}

function getBirthday(userId) {
  return birthdays[userId];
}

function checkBirthdays(client) {
  const today = moment().format('MM-DD');
  for (const [userId, date] of Object.entries(birthdays)) {
    if (date === today) {
      const user = client.users.cache.get(userId);
      if (user) user.send(`🎉 Happy Birthday, ${user.username}! 🎂`);
    }
  }
}

module.exports = { setBirthday, getBirthday, checkBirthdays };