import cron from 'node-cron';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { getPool } from './db.js';
import {
  sendTaskDeadlineReminderEmail,
  TIMEZONE,
} from './emailService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '.env') });
dotenv.config();

/**
 * Get current date string in Asia/Kolkata as YYYY-MM-DD
 */
export function getTodayKolkataString() {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(new Date()); // Outputs "YYYY-MM-DD"
}

/**
 * Robustly normalize any date string or Date object to YYYY-MM-DD in TIMEZONE
 */
export function normalizeDateToYYYYMMDD(dateInput) {
  if (!dateInput) return null;
  if (typeof dateInput === 'string') {
    const match = dateInput.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      return `${match[1]}-${match[2]}-${match[3]}`;
    }
  }
  if (dateInput instanceof Date && !isNaN(dateInput.getTime())) {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(dateInput);
  }
  try {
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return null;
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(d);
  } catch {
    return null;
  }
}

/**
 * Check if a date falls strictly on today's date in Asia/Kolkata
 */
export function isDeadlineTodayKolkata(dateInput) {
  const taskDateStr = normalizeDateToYYYYMMDD(dateInput);
  if (!taskDateStr) return false;
  const todayStr = getTodayKolkataString();
  return taskDateStr === todayStr;
}

/**
 * Check if a deadline is due today or past due (and needs reminder)
 */
export function isDeadlineDueOrOverdueTodayKolkata(dateInput) {
  const taskDateStr = normalizeDateToYYYYMMDD(dateInput);
  if (!taskDateStr) return false;
  const todayStr = getTodayKolkataString();
  return taskDateStr <= todayStr;
}

/**
 * Query eligible tasks and send deadline reminder emails on the deadline date
 */
export async function checkAndSendDeadlineReminders({
  forceAll = false,
  targetTaskId = null,
  markSent = true,
  ownerUserId = null,
} = {}) {
  const pool = getPool();
  if (!pool) {
    console.warn('[TaskReminder] Database pool unavailable for reminder check.');
    return { error: 'Database unavailable' };
  }

  const todayStr = getTodayKolkataString();
  const testMode = process.env.TASK_REMINDER_TEST_MODE === 'true';

  console.log(`[TaskReminder] Running deadline reminder check for ${todayStr} (${TIMEZONE}, force: ${forceAll || testMode})`);

  let lockAcquired = false;
  let lockConnection;
  try {
    lockConnection = await pool.getConnection();
    const [lockRows] = await lockConnection.query('SELECT GET_LOCK(?, 0) AS acquired', ['taskpulse_deadline_reminders']);
    lockAcquired = Boolean(lockRows[0]?.acquired);
    if (!lockAcquired) {
      return { busy: true, message: 'Another reminder check is already running.' };
    }

    let query = `
      SELECT t.*, u.name AS assignee_name, u.email AS assignee_email,
             c.name AS creator_name, c.email AS creator_email
      FROM tasks t
      LEFT JOIN users u ON t.user_id = u.id
      LEFT JOIN users c ON t.created_by = c.id
      WHERE t.completed = 0
        AND (t.status IS NULL OR t.status != 'done')
        AND t.due_date IS NOT NULL
    `;

    const params = [];

    if (targetTaskId) {
      query += ` AND t.id = ?`;
      params.push(targetTaskId);
    } else if (!forceAll && !testMode) {
      query += ` AND t.deadline_reminder_sent = 0`;
    }

    if (ownerUserId) {
      query += ` AND (t.created_by = ? OR t.user_id = ?)`;
      params.push(ownerUserId, ownerUserId);
    }

    const [rows] = await lockConnection.query(query, params);

    const summary = {
      totalFound: rows.length,
      sentCount: 0,
      failedCount: 0,
      skippedCount: 0,
      simulatedCount: 0,
      details: [],
    };

    for (const task of rows) {
      const isDue = isDeadlineDueOrOverdueTodayKolkata(task.due_date);

      // Skip if deadline has not arrived yet (unless targetTaskId or forceAll is specified)
      if (!isDue && !targetTaskId && !forceAll && !testMode) {
        summary.skippedCount++;
        continue;
      }

      // Check if already sent and not forcing
      if (task.deadline_reminder_sent && !targetTaskId && !forceAll) {
        summary.skippedCount++;
        continue;
      }

      // If task has no assignee email, skip
      if (!task.assignee_email) {
        console.warn(`[TaskReminder] Task TASK-${task.id} has no assigned email. Skipping.`);
        summary.skippedCount++;
        summary.details.push({
          taskId: task.id,
          status: 'skipped',
          reason: 'No assignee email',
        });
        continue;
      }

      const assigneeUser = {
        id: task.user_id,
        name: task.assignee_name || 'Team Member',
        email: task.assignee_email,
      };

      const creatorUser = {
        id: task.created_by,
        name: task.creator_name || 'Administrator',
        email: task.creator_email,
      };

      // Send the deadline reminder email
      const result = await sendTaskDeadlineReminderEmail(task, assigneeUser, creatorUser, pool);

      if (result.delivered) {
        // Mark as sent in the database safely AFTER email was sent
        if (markSent) {
          await lockConnection.query(
            `UPDATE tasks SET deadline_reminder_sent = 1, deadline_reminder_sent_at = NOW() WHERE id = ?`,
            [task.id]
          );
        }

        summary.sentCount++;
        summary.details.push({
          taskId: task.id,
          recipient: task.assignee_email,
          status: 'sent',
        });
      } else if (result.simulated) {
        summary.simulatedCount++;
        summary.details.push({
          taskId: task.id,
          recipient: task.assignee_email,
          status: 'simulated',
        });
      } else {
        // Keep deadline_reminder_sent = 0 to allow retry
        summary.failedCount++;
        summary.details.push({
          taskId: task.id,
          recipient: task.assignee_email,
          status: 'failed',
          error: result.error,
        });
      }
    }

    console.log(
      `[TaskReminder] Finished reminder cycle. Sent: ${summary.sentCount}, Simulated: ${summary.simulatedCount}, Failed: ${summary.failedCount}, Skipped: ${summary.skippedCount}`
    );

    return summary;
  } catch (error) {
    console.error('[TaskReminder] Error during deadline reminder execution:', error);
    return { error: error.message };
  } finally {
    if (lockAcquired) {
      await lockConnection.query('SELECT RELEASE_LOCK(?)', ['taskpulse_deadline_reminders']).catch(() => {});
    }
    lockConnection?.release();
  }
}

/**
 * Initialize Node-Cron Scheduler
 */
export function initDeadlineScheduler() {
  const reminderHour = parseInt(process.env.TASK_REMINDER_HOUR ?? '9', 10);
  const reminderMinute = parseInt(process.env.TASK_REMINDER_MINUTE ?? '0', 10);
  const validHour = isNaN(reminderHour) || reminderHour < 0 || reminderHour > 23 ? 9 : reminderHour;
  const validMinute = isNaN(reminderMinute) || reminderMinute < 0 || reminderMinute > 59 ? 0 : reminderMinute;

  const cronExpression = `${validMinute} ${validHour} * * *`;

  console.log(
    `Deadline reminder scheduler active: daily at ${validHour.toString().padStart(2, '0')}:${validMinute.toString().padStart(2, '0')} (${TIMEZONE}); safety check every 5 minutes.`
  );

  // 1. Immediate check on server boot so tasks due today are immediately processed
  setTimeout(() => {
    checkAndSendDeadlineReminders().catch((err) => {
      console.error('[TaskReminder] Initial startup check error:', err.message);
    });
  }, 2000);

  // 2. Periodic check every 5 minutes to capture any tasks whose deadline is reached during the day
  cron.schedule(
    '*/5 * * * *',
    async () => {
      await checkAndSendDeadlineReminders();
    },
    { timezone: TIMEZONE }
  );

  // 3. Primary daily morning scheduled run
  const task = cron.schedule(
    cronExpression,
    async () => {
      console.log(`Triggering daily deadline reminder job at ${new Date().toISOString()}.`);
      await checkAndSendDeadlineReminders();
    },
    {
      timezone: TIMEZONE,
    }
  );

  return task;
}
