const fs = require('fs');
const path = require('path');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezonePlugin = require('dayjs/plugin/timezone');
const {
  getDateForWeekdayInTimezone,
  convertLegacyUtcTimeToLocalTime,
  adjustStandardOffsetLocalTimeToDaylight
} = require('../utils/timezone');

dayjs.extend(utc);
dayjs.extend(timezonePlugin);

const DAY_KEYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const LOCAL_SCHEDULE_TIME_FORMAT = 'local-v2';

class StreamScheduleManager {
  constructor() {
    this.dataPath = path.join(__dirname, '..', 'data', 'streamSchedules.json');
    this.migratedOnLoad = false;
    this.schedules = this.loadData();
    if (this.migratedOnLoad) this.saveData();
  }

  loadData() {
    try {
      if (!fs.existsSync(this.dataPath)) return Object.create(null);
      const parsed = JSON.parse(fs.readFileSync(this.dataPath, 'utf8') || '{}');
      const migrated = Object.create(null);

      for (const [guildId, guildData] of Object.entries(parsed)) {
        const streamerMap = Object.create(null);
        if (Array.isArray(guildData)) {
          this.migratedOnLoad = true;
          for (const legacyStreamer of guildData) {
            const streamerName = String(legacyStreamer.streamerName || '').trim();
            if (!streamerName) continue;
            const streamer = streamerMap[streamerName] || {
              timezone: legacyStreamer.timezone || 'UTC',
              streamUrl: legacyStreamer.streamUrl || null,
              discordUserId: legacyStreamer.discordUserId || null,
              addedBy: legacyStreamer.addedBy || null
            };
            for (const segment of legacyStreamer.schedules || []) {
              const dayKey = DAY_KEYS[segment.dayOfWeek];
              if (!dayKey) continue;
              if (!Array.isArray(streamer[dayKey])) streamer[dayKey] = streamer[dayKey] ? [streamer[dayKey]] : [];
              streamer[dayKey].push({
                startTime: segment.startTime,
                endTime: segment.endTime,
                isRecurring: segment.isRecurring !== false,
                specificDate: segment.specificDate || null,
                addedAt: segment.addedAt || legacyStreamer.addedAt || Date.now()
              });
            }
            for (const dayKey of DAY_KEYS) {
              if (Array.isArray(streamer[dayKey])) {
                streamer[dayKey] = streamer[dayKey].map(segment => {
                  const normalized = { ...segment };
                  delete normalized.addedAt;
                  return normalized;
                });
              }
            }
            streamerMap[streamerName] = streamer;
          }
        } else {
          for (const [streamerName, legacyStreamer] of Object.entries(guildData || {})) {
            const streamer = { ...legacyStreamer };
            delete streamer.streamerName;
            delete streamer.schedules;
            for (const dayKey of DAY_KEYS) {
              if (!streamer[dayKey]) continue;
              this.migratedOnLoad = true;
              streamer[dayKey] = (Array.isArray(streamer[dayKey]) ? streamer[dayKey] : [streamer[dayKey]])
                .map(segment => ({
                  startTime: segment.startTime,
                  endTime: segment.endTime,
                  isRecurring: segment.isRecurring !== false,
                  specificDate: segment.specificDate || null
                }));
            }
            streamerMap[streamerName] = streamer;
          }
        }

        for (const streamer of Object.values(streamerMap)) {
          const timezone = streamer.timezone || 'UTC';
          if (streamer.scheduleTimeFormat === LOCAL_SCHEDULE_TIME_FORMAT) continue;
          const convertTime = streamer.scheduleTimeFormat === 'local'
            ? value => adjustStandardOffsetLocalTimeToDaylight(value, timezone)
            : value => convertLegacyUtcTimeToLocalTime(value, timezone);
          for (const dayKey of DAY_KEYS) {
            if (!streamer[dayKey]) continue;
            streamer[dayKey] = this.getDaySegments(streamer, dayKey).map(segment => ({
              ...segment,
              startTime: convertTime(segment.startTime),
              endTime: convertTime(segment.endTime)
            }));
          }
          streamer.scheduleTimeFormat = LOCAL_SCHEDULE_TIME_FORMAT;
          this.migratedOnLoad = true;
        }
        migrated[guildId] = streamerMap;
      }
      return migrated;
    } catch (error) {
      console.error('[StreamSchedule] Error loading data:', error.message);
      return Object.create(null);
    }
  }

  saveData() {
    try {
      fs.writeFileSync(this.dataPath, JSON.stringify(this.schedules, null, 2), 'utf8');
    } catch (error) {
      console.error('[StreamSchedule] Error saving data:', error.message);
    }
  }

  getStreamerKey(guildId, streamerName) {
    const guild = this.schedules[guildId] || {};
    return Object.keys(guild).find(name => name.toLowerCase() === streamerName.toLowerCase()) || null;
  }

  getOrCreateStreamer(guildId, streamerName, requestingUserId = null) {
    if (!this.schedules[guildId]) this.schedules[guildId] = Object.create(null);
    const existingKey = this.getStreamerKey(guildId, streamerName);
    if (existingKey) return { key: existingKey, streamer: this.schedules[guildId][existingKey] };

    const streamer = {
      timezone: 'UTC',
      scheduleTimeFormat: LOCAL_SCHEDULE_TIME_FORMAT,
      streamUrl: null,
      discordUserId: null,
      addedBy: requestingUserId
    };
    this.schedules[guildId][streamerName] = streamer;
    return { key: streamerName, streamer };
  }

  getStreamer(guildId, streamerName) {
    const key = this.getStreamerKey(guildId, streamerName);
    if (!key) return null;
    return { streamerName: key, ...this.schedules[guildId][key] };
  }

  getGuildStreamers(guildId) {
    return Object.entries(this.schedules[guildId] || {}).map(([streamerName, streamer]) => ({
      streamerName,
      ...streamer
    }));
  }

  projectSegment(streamerName, streamer, dayKey, segment, segmentIndex) {
    const dayOfWeek = DAY_KEYS.indexOf(dayKey);
    if (!segment || dayOfWeek < 0) return null;
    return {
      ...segment,
      id: `${dayKey}:${segmentIndex}`,
      dayKey,
      segmentIndex,
      dayOfWeek,
      streamerName,
      timezone: streamer.timezone || 'UTC',
      streamUrl: streamer.streamUrl || null,
      discordUserId: streamer.discordUserId || null
    };
  }

  addScheduleSegment(guildId, streamerName, segmentData, requestingUserId) {
    const dayKey = DAY_KEYS[segmentData.dayOfWeek];
    if (!dayKey) return null;
    const segment = {
      startTime: segmentData.startTime,
      endTime: segmentData.endTime,
      isRecurring: segmentData.isRecurring !== false,
      specificDate: segmentData.specificDate || null
    };
    if (this.findOverlap([segment])) return null;
    const { key, streamer } = this.getOrCreateStreamer(guildId, streamerName, requestingUserId);
    const segments = this.getDaySegments(streamer, dayKey);
    const overlap = this.findOverlap([...segments, segment]);
    if (overlap) return null;

    streamer[dayKey] = [...segments, segment];
    if (!streamer.addedBy && requestingUserId) streamer.addedBy = requestingUserId;
    this.saveData();
    return this.projectSegment(key, streamer, dayKey, segment, streamer[dayKey].length - 1);
  }

  upsertScheduleEntry(guildId, streamerName, segmentData, requestingUserId) {
    const dayKey = DAY_KEYS[segmentData.dayOfWeek];
    if (!dayKey) return null;
    const segment = {
      startTime: segmentData.startTime,
      endTime: segmentData.endTime,
      isRecurring: segmentData.isRecurring !== false,
      specificDate: segmentData.specificDate || null
    };
    const overlap = this.findOverlap([segment]);
    if (overlap) return null;

    const { key, streamer } = this.getOrCreateStreamer(guildId, streamerName, requestingUserId);
    streamer[dayKey] = [segment];
    if (!streamer.addedBy && requestingUserId) streamer.addedBy = requestingUserId;
    this.saveData();
    return this.projectSegment(key, streamer, dayKey, segment, 0);
  }

  saveScheduleEntries(guildId, streamerName, entries, requestingUserId, isAdmin, discordUserId, timezone) {
    const key = this.getStreamerKey(guildId, streamerName);
    const existingStreamer = key ? this.schedules[guildId][key] : null;
    if (existingStreamer && !isAdmin && existingStreamer.addedBy !== requestingUserId) {
      return { success: false, message: 'You can only edit your own streamer schedules' };
    }

    const effectiveTimezone = timezone || existingStreamer?.timezone || 'UTC';
    const normalizedEntries = entries.map(entry => ({
      dayKey: DAY_KEYS[entry.dayOfWeek],
      segment: {
        startTime: entry.startTime,
        endTime: entry.endTime,
        isRecurring: entry.isRecurring !== false,
        specificDate: entry.specificDate || null
      },
      comparisonSegment: {
        startTime: entry.startTime,
        endTime: entry.endTime,
        isRecurring: entry.isRecurring !== false,
        specificDate: entry.specificDate || null
      }
    }));
    if (normalizedEntries.some(entry => !entry.dayKey)) {
      return { success: false, message: 'Invalid weekday' };
    }

    const updatedDays = new Set(normalizedEntries.map(entry => entry.dayKey));
    const proposed = existingStreamer
      ? DAY_KEYS.flatMap(dayKey => updatedDays.has(dayKey) ? [] : this.getDaySegments(existingStreamer, dayKey).map(segment => ({
          dayKey,
          segment,
          comparisonSegment: { ...segment }
        })))
      : [];
    proposed.push(...normalizedEntries);
    const overlap = this.findOverlap(proposed.map(entry => entry.comparisonSegment), proposed.map(entry => entry.dayKey));
    if (overlap) {
      return { success: false, message: 'This schedule overlaps another time entry for this person. Adjust the times so each event ends before the next one starts.' };
    }

    if (discordUserId) {
      const byDay = new Map();
      for (const entry of proposed) {
        if (!byDay.has(entry.dayKey)) byDay.set(entry.dayKey, []);
        byDay.get(entry.dayKey).push(entry.comparisonSegment);
      }
      for (const [otherName, otherStreamer] of Object.entries(this.schedules[guildId] || {})) {
        if (otherName === key || otherStreamer.discordUserId !== discordUserId) continue;
        for (const [dayKey, segments] of byDay) {
          const otherSegments = this.getDaySegments(otherStreamer, dayKey).map(segment => ({
            ...segment,
            startTime: this.convertLocalTimeToTimezone(segment.startTime, otherStreamer.timezone || 'UTC', effectiveTimezone),
            endTime: this.convertLocalTimeToTimezone(segment.endTime, otherStreamer.timezone || 'UTC', effectiveTimezone)
          }));
          if (this.findOverlap([...segments, ...otherSegments])) {
            return { success: false, message: 'This schedule overlaps another time entry already assigned to that Discord user.' };
          }
        }
      }
    }

    const { key: savedKey, streamer } = this.getOrCreateStreamer(guildId, streamerName, requestingUserId);
    for (const dayKey of updatedDays) {
      streamer[dayKey] = normalizedEntries.filter(entry => entry.dayKey === dayKey).map(entry => entry.segment);
    }
    if (discordUserId) streamer.discordUserId = discordUserId;
    streamer.scheduleTimeFormat = LOCAL_SCHEDULE_TIME_FORMAT;
    if (!streamer.addedBy && requestingUserId) streamer.addedBy = requestingUserId;
    this.saveData();
    return { success: true, streamer: { streamerName: savedKey, ...streamer } };
  }

  getDaySegments(streamer, dayKey) {
    const value = streamer[dayKey];
    if (!value) return [];
    return Array.isArray(value) ? value : [value];
  }

  findOverlap(segments, dayKeys = []) {
    for (let leftIndex = 0; leftIndex < segments.length; leftIndex += 1) {
      const left = segments[leftIndex];
      const leftDay = dayKeys[leftIndex];
      const leftStart = this.minutesFromTime(left.startTime);
      const leftEnd = this.minutesFromTime(left.endTime);
      if (leftStart === null || leftEnd === null || leftStart >= leftEnd) {
        return { leftIndex, rightIndex: leftIndex };
      }

      for (let rightIndex = leftIndex + 1; rightIndex < segments.length; rightIndex += 1) {
        const right = segments[rightIndex];
        if (leftDay && dayKeys[rightIndex] !== leftDay) continue;
        if (left.isRecurring === false && right.isRecurring === false && left.specificDate !== right.specificDate) continue;
        const rightStart = this.minutesFromTime(right.startTime);
        const rightEnd = this.minutesFromTime(right.endTime);
        if (rightStart === null || rightEnd === null || rightStart >= rightEnd) {
          return { leftIndex, rightIndex };
        }
        if (leftStart < rightEnd && rightStart < leftEnd) return { leftIndex, rightIndex };
      }
    }
    return null;
  }

  minutesFromTime(value) {
    if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
    const [hours, minutes] = value.split(':').map(Number);
    return hours * 60 + minutes;
  }

  convertLocalTimeToTimezone(value, sourceTimezone, targetTimezone) {
    if (sourceTimezone === targetTimezone) return value;
    if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) return value;
    const date = dayjs().tz(sourceTimezone).format('YYYY-MM-DD');
    return dayjs.tz(`${date}T${value}:00`, sourceTimezone).tz(targetTimezone).format('HH:mm');
  }

  updateStreamerInfo(guildId, streamerName, updates, requestingUserId, isAdmin) {
    const key = this.getStreamerKey(guildId, streamerName);
    if (!key) return { success: false, message: 'Streamer not found' };
    const streamer = this.schedules[guildId][key];
    if (!isAdmin && streamer.addedBy !== requestingUserId) {
      return { success: false, message: 'You can only edit your own streamer info' };
    }

    if (updates.timezone !== undefined) streamer.timezone = updates.timezone;
    if (updates.streamUrl !== undefined) streamer.streamUrl = updates.streamUrl;
    if (updates.discordUserId !== undefined) streamer.discordUserId = updates.discordUserId;
    this.saveData();
    return { success: true, streamer: { streamerName: key, ...streamer } };
  }

  editScheduleSegment(guildId, streamerName, segmentId, updates, requestingUserId, isAdmin) {
    const key = this.getStreamerKey(guildId, streamerName);
    if (!key) return { success: false, message: 'Streamer not found' };
    const streamer = this.schedules[guildId][key];
    if (!isAdmin && streamer.addedBy !== requestingUserId) {
      return { success: false, message: 'You can only edit your own streamer schedules' };
    }

    const oldDayKey = DAY_KEYS.includes(segmentId.toLowerCase()) ? segmentId.toLowerCase() : null;
    const oldSegments = oldDayKey && this.getDaySegments(streamer, oldDayKey);
    const segmentIndex = segmentId.includes(':') ? Number(segmentId.split(':')[1]) : 0;
    const oldSegment = oldSegments?.[segmentIndex];
    if (!oldSegment) return { success: false, message: 'Schedule entry not found' };

    const newDayOfWeek = updates.dayOfWeek !== undefined ? updates.dayOfWeek : DAY_KEYS.indexOf(oldDayKey);
    const newDayKey = DAY_KEYS[newDayOfWeek];
    if (!newDayKey) return { success: false, message: 'Invalid weekday' };
    const segment = { ...oldSegment };
    if (updates.startTime !== undefined) segment.startTime = updates.startTime;
    if (updates.endTime !== undefined) segment.endTime = updates.endTime;
    if (updates.isRecurring !== undefined) segment.isRecurring = updates.isRecurring;
    if (updates.specificDate !== undefined) segment.specificDate = updates.specificDate;
    const previousSegments = this.getDaySegments(streamer, oldDayKey).filter((_, index) => index !== segmentIndex);
    const newSegments = newDayKey === oldDayKey ? [...previousSegments, segment] : [...this.getDaySegments(streamer, newDayKey), segment];
    if (this.findOverlap(newSegments)) {
      return { success: false, message: 'This schedule overlaps another time entry for this person.' };
    }
    if (previousSegments.length) streamer[oldDayKey] = previousSegments;
    else if (newDayKey !== oldDayKey) delete streamer[oldDayKey];
    streamer[newDayKey] = newSegments;
    this.saveData();
    return { success: true, segment: this.projectSegment(key, streamer, newDayKey, segment, newSegments.length - 1) };
  }

  deleteScheduleSegment(guildId, streamerName, segmentId, requestingUserId, isAdmin) {
    const key = this.getStreamerKey(guildId, streamerName);
    if (!key) return { success: false, message: 'Streamer not found' };
    const streamer = this.schedules[guildId][key];
    if (!isAdmin && streamer.addedBy !== requestingUserId) {
      return { success: false, message: 'You can only delete your own streamer schedules' };
    }

    const dayKey = DAY_KEYS.includes(segmentId.toLowerCase()) ? segmentId.toLowerCase() : null;
    if (!dayKey || !streamer[dayKey]) return { success: false, message: 'Schedule entry not found' };
    delete streamer[dayKey];
    if (!this.hasScheduleEntries(streamer)) delete this.schedules[guildId][key];
    this.cleanupEmptyGuild(guildId);
    this.saveData();
    return { success: true, message: `${dayKey[0].toUpperCase()}${dayKey.slice(1)} schedule entry deleted successfully` };
  }

  deleteStreamer(guildId, streamerName, requestingUserId, isAdmin) {
    const key = this.getStreamerKey(guildId, streamerName);
    if (!key) return { success: false, message: 'Streamer not found' };
    const streamer = this.schedules[guildId][key];
    if (!isAdmin && streamer.addedBy !== requestingUserId) {
      return { success: false, message: 'You can only delete your own streamer' };
    }
    delete this.schedules[guildId][key];
    this.cleanupEmptyGuild(guildId);
    this.saveData();
    return { success: true, message: 'Streamer deleted successfully' };
  }

  hasScheduleEntries(streamer) {
    return DAY_KEYS.some(dayKey => this.getDaySegments(streamer, dayKey).length > 0);
  }

  cleanupEmptyGuild(guildId) {
    if (Object.keys(this.schedules[guildId] || {}).length === 0) delete this.schedules[guildId];
  }

  getGuildSchedules(guildId) {
    return this.getGuildStreamers(guildId).flatMap(streamer =>
      DAY_KEYS.flatMap(dayKey =>
        this.getDaySegments(streamer, dayKey).map((segment, index) =>
          this.projectSegment(streamer.streamerName, streamer, dayKey, segment, index)
        )
      )
    );
  }

  getScheduleSegmentById(guildId, segmentId, streamerName) {
    if (streamerName) {
      const streamer = this.getStreamer(guildId, streamerName);
      if (!streamer) return null;
      const [dayKey, indexValue] = segmentId.toLowerCase().split(':');
      return this.projectSegment(streamer.streamerName, streamer, dayKey, this.getDaySegments(streamer, dayKey)[Number(indexValue) || 0], Number(indexValue) || 0);
    }
    for (const streamer of this.getGuildStreamers(guildId)) {
      const [dayKey, indexValue] = segmentId.toLowerCase().split(':');
      const segment = this.projectSegment(streamer.streamerName, streamer, dayKey, this.getDaySegments(streamer, dayKey)[Number(indexValue) || 0], Number(indexValue) || 0);
      if (segment) return segment;
    }
    return null;
  }

  getSchedulesForDay(guildId, dayOfWeek) {
    const dayKey = DAY_KEYS[dayOfWeek];
    if (!dayKey) return [];
    return this.getGuildStreamers(guildId).flatMap(streamer => {
      const timezone = streamer.timezone || 'UTC';
      const targetDate = getDateForWeekdayInTimezone(dayOfWeek, timezone);
      return this.getDaySegments(streamer, dayKey)
        .map((segment, index) => this.projectSegment(streamer.streamerName, streamer, dayKey, segment, index))
        .filter(segment => segment.isRecurring || segment.specificDate === targetDate);
    });
  }

  getUserSchedules(guildId, discordUserId) {
    return this.getGuildSchedules(guildId).filter(schedule => schedule.discordUserId === discordUserId);
  }

  getStreamerForSegment(guildId, segmentId) {
    return this.getScheduleSegmentById(guildId, segmentId);
  }

  cleanupExpiredEvents() {
    let changed = false;

    for (const [guildId, guild] of Object.entries(this.schedules)) {
      for (const [streamerName, streamer] of Object.entries(guild)) {
        const todayString = dayjs().tz(streamer.timezone || 'UTC').format('YYYY-MM-DD');
        for (const dayKey of DAY_KEYS) {
          const entries = this.getDaySegments(streamer, dayKey);
          const remaining = entries.filter(entry => entry.isRecurring || !entry.specificDate || entry.specificDate >= todayString);
          if (remaining.length !== entries.length) changed = true;
          if (remaining.length) streamer[dayKey] = remaining;
          else delete streamer[dayKey];
        }
        if (!this.hasScheduleEntries(streamer)) {
          delete guild[streamerName];
          changed = true;
        }
      }
      if (Object.keys(guild).length === 0) delete this.schedules[guildId];
    }
    if (changed) this.saveData();
  }

  getWeeklySchedules(guildId) {
    return this.getGuildSchedules(guildId).filter(schedule => {
      if (schedule.isRecurring) return true;
      const timezone = schedule.timezone || 'UTC';
      const date = dayjs().tz(timezone);
      const weekdayOffset = date.day() === 0 ? 6 : date.day() - 1;
      const monday = date.subtract(weekdayOffset, 'day').format('YYYY-MM-DD');
      const sunday = dayjs.utc(`${monday}T00:00:00Z`).add(6, 'day').format('YYYY-MM-DD');
      return schedule.specificDate && schedule.specificDate >= monday && schedule.specificDate <= sunday;
    });
  }
}

module.exports = new StreamScheduleManager();
