import assert from 'node:assert/strict';
import { formatKolkataDate, getEmailDeliveryMode, TIMEZONE } from './emailService.js';
import {
  getTodayKolkataString,
  isDeadlineDueOrOverdueTodayKolkata,
  isDeadlineTodayKolkata,
  normalizeDateToYYYYMMDD,
} from './reminderScheduler.js';

function addCalendarDays(dateString, days) {
  const [year, month, day] = dateString.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function runTests() {
  const today = getTodayKolkataString();
  const yesterday = addCalendarDays(today, -1);
  const tomorrow = addCalendarDays(today, 1);

  assert.match(today, /^\d{4}-\d{2}-\d{2}$/, 'Today should use YYYY-MM-DD format.');
  assert.equal(normalizeDateToYYYYMMDD(`${today}T18:30:00.000Z`), today);
  assert.equal(normalizeDateToYYYYMMDD(null), null);
  assert.equal(isDeadlineTodayKolkata(today), true);
  assert.equal(isDeadlineTodayKolkata(tomorrow), false);
  assert.equal(isDeadlineDueOrOverdueTodayKolkata(yesterday), true);
  assert.equal(isDeadlineDueOrOverdueTodayKolkata(today), true);
  assert.equal(isDeadlineDueOrOverdueTodayKolkata(tomorrow), false);
  assert.notEqual(formatKolkataDate(today), 'N/A');
  assert.ok(['smtp', 'simulated'].includes(getEmailDeliveryMode()));

  console.log(`Reminder date tests passed for ${today} (${TIMEZONE}).`);
  console.log(`Email delivery mode: ${getEmailDeliveryMode()}. No email was sent by this test.`);
}

runTests();
