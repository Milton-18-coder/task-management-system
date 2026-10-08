import cron from 'node-cron';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { getPool } from './db.js';
import {
  sendTaskDeadlineReminderEmail,
  formatKolkataDate,
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
 * Check if a date/string falls on today's date in Asia/Kolkata
 */
export function isDeadlineTodayKolkata(dateInput) {
  if (!dateInput) return false;
  try {
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return false;

    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const taskDateStr = formatter.format(d);
    const todayStr = getTodayKolkataString();

    return taskDateStr === todayStr;
  } catch {
    return false;
  }
}

/**
 * Query eligible tasks and send final deadline reminders
 */
export async function checkAndSendDeadlineReminders({
  forceAll = false,
  targetTaskId = null,
  markSent = true,
} = {}) {
  const pool = getPool();
  if (!pool) {
    console.warn('[TaskReminder] Database pool unavailable for reminder check.');
    return { error: 'Database unavailable' };
  }

  const todayStr = getTodayKolkataString();
  const testMode = process.env.TASK_REMINDER_TEST_MODE === 'true';

  console.log(`[TaskReminder] 🔍 Running deadline reminder check for date: ${todayStr} (Timezone: ${TIMEZONE}, ForceAll: ${forceAll || testMode})`);

  try {
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

    const [rows] = await pool.query(query, params);

    const summary = {
      totalFound: rows.length,
      sentCount: 0,
      failedCount: 0,
      skippedCount: 0,
      details: [],
    };

    for (const task of rows) {
      const isToday = isDeadlineTodayKolkata(task.due_date);

      // Skip if not today (unless targetTaskId or forceAll is specified)
      if (!isToday && !targetTaskId && !forceAll && !testMode) {
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

      // Send the reminder email
      const result = await sendTaskDeadlineReminderEmail(task, assigneeUser, creatorUser, pool);

      if (result.success) {
        // Mark as sent in the database safely AFTER email was sent
        if (markSent) {
          await pool.query(
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
      `[TaskReminder] Finished reminder cycle. Sent: ${summary.sentCount}, Failed: ${summary.failedCount}, Skipped: ${summary.skippedCount}`
    );

    return summary;
  } catch (error) {
    console.error('[TaskReminder] Error during deadline reminder execution:', error);
    return { error: error.message };
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
    `⏰ Deadline reminder scheduler scheduled: Daily at ${validHour.toString().padStart(2, '0')}:${validMinute.toString().padStart(2, '0')} (${TIMEZONE}) [Expression: "${cronExpression}"]`
  );

  const task = cron.schedule(
    cronExpression,
    async () => {
      console.log(`⏰ Triggering daily deadline reminder cron job at ${new Date().toISOString()}...`);
      await checkAndSendDeadlineReminders();
    },
    {
      timezone: TIMEZONE,
    }
  );

  return task;
}
