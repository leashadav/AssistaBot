const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const configLoader = require('../modules/configLoader');

dayjs.extend(utc);
dayjs.extend(timezone);

const DEFAULT_TIMEZONE = configLoader.config.timezone || 'UTC';

function getDatePartsInTimezone(date = new Date(), timeZone = DEFAULT_TIMEZONE) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day)
  };
}

function getDateStringInTimezone(date = new Date(), timeZone = DEFAULT_TIMEZONE) {
  const { year, month, day } = getDatePartsInTimezone(date, timeZone);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function getCurrentYearInTimezone(date = new Date(), timeZone = DEFAULT_TIMEZONE) {
  return getDatePartsInTimezone(date, timeZone).year;
}

function getDateForWeekdayInTimezone(dayOfWeek, timeZone, now = new Date()) {
  const today = dayjs(now).tz(timeZone);
  const currentDay = today.day();
  const mondayStartCurrentDay = currentDay === 0 ? 6 : currentDay - 1;
  let daysToAdd = dayOfWeek - mondayStartCurrentDay;
  if (daysToAdd < 0) daysToAdd -= 7;
  return today.add(daysToAdd, 'day').format('YYYY-MM-DD');
}

function getLocalTimeTimestamp(date, time, timeZone) {
  return Math.floor(dayjs.tz(`${date}T${time}:00`, timeZone).valueOf() / 1000);
}

function convertLegacyUtcTimeToLocalTime(time, timeZone) {
  if (typeof time !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) return time;
  // Legacy records have no save date; schedules were saved using the active daylight offset.
  const year = new Date().getUTCFullYear();
  const january = dayjs.utc(`${year}-01-15T${time}:00Z`).tz(timeZone);
  const july = dayjs.utc(`${year}-07-15T${time}:00Z`).tz(timeZone);
  return (january.utcOffset() >= july.utcOffset() ? january : july).format('HH:mm');
}

function adjustStandardOffsetLocalTimeToDaylight(time, timeZone) {
  if (typeof time !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) return time;
  const year = new Date().getUTCFullYear();
  const januaryOffset = dayjs.utc(`${year}-01-15T00:00:00Z`).tz(timeZone).utcOffset();
  const julyOffset = dayjs.utc(`${year}-07-15T00:00:00Z`).tz(timeZone).utcOffset();
  const [hours, minutes] = time.split(':').map(Number);
  const adjustedMinutes = (hours * 60 + minutes + Math.abs(julyOffset - januaryOffset)) % 1440;
  return `${String(Math.floor(adjustedMinutes / 60)).padStart(2, '0')}:${String(adjustedMinutes % 60).padStart(2, '0')}`;
}

function getMillisecondsUntilNextDayInTimezone(timeZone = DEFAULT_TIMEZONE, now = Date.now()) {
  const currentDate = getDateStringInTimezone(new Date(now), timeZone);
  const [year, month, day] = currentDate.split('-').map(Number);
  const nextDate = new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
  const nextMidnight = dayjs.tz(`${nextDate}T00:00:01`, timeZone);
  return nextMidnight.valueOf() - now;
}

module.exports = {
  DEFAULT_TIMEZONE,
  getDatePartsInTimezone,
  getDateStringInTimezone,
  getCurrentYearInTimezone,
  getDateForWeekdayInTimezone,
  getLocalTimeTimestamp,
  convertLegacyUtcTimeToLocalTime,
  adjustStandardOffsetLocalTimeToDaylight,
  getMillisecondsUntilNextDayInTimezone
};
