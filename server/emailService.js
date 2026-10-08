import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '.env') });
dotenv.config();

let transporter = null;

/**
 * Timezone configuration (default: Asia/Kolkata)
 */
export const TIMEZONE = process.env.TASK_TIMEZONE || 'Asia/Kolkata';

/**
 * Format a date string/object into Asia/Kolkata readable format
 * e.g. "10-Oct-2026" or "10-Oct-2026 11:59 PM IST"
 */
export function formatKolkataDate(dateInput, includeTime = false) {
  if (!dateInput) return 'N/A';

  try {
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return String(dateInput);

    const options = {
      timeZone: TIMEZONE,
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      ...(includeTime
        ? {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
          }
        : {}),
    };

    const formatter = new Intl.DateTimeFormat('en-GB', options);
    const parts = formatter.formatToParts(d);
    
    const day = parts.find((p) => p.type === 'day')?.value || '';
    const month = parts.find((p) => p.type === 'month')?.value || '';
    const year = parts.find((p) => p.type === 'year')?.value || '';
    
    let baseDate = `${day}-${month}-${year}`;

    if (includeTime) {
      const hour = parts.find((p) => p.type === 'hour')?.value || '';
      const minute = parts.find((p) => p.type === 'minute')?.value || '';
      const dayPeriod = parts.find((p) => p.type === 'dayPeriod')?.value?.toUpperCase() || '';
      return `${baseDate} ${hour}:${minute} ${dayPeriod} IST`;
    }

    return baseDate;
  } catch (err) {
    return String(dateInput);
  }
}

/**
 * Initialize or get Nodemailer Transporter
 */
export async function getTransporter() {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT) || 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const secure = process.env.SMTP_SECURE === 'true' || port === 465;

  if (host && user && pass) {
    // Configured with real SMTP server
    transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass },
      tls: {
        rejectUnauthorized: false,
      },
    });
    console.log(`📧 Nodemailer SMTP transporter initialized with host: ${host}:${port}`);
  } else {
    // Development fallback: Use JSON transport / ethereal mock for local testing
    console.log(`⚠️ SMTP credentials not fully configured in .env. Initializing local dev mock transporter.`);
    transporter = nodemailer.createTransport({
      jsonTransport: true,
    });
  }

  return transporter;
}

/**
 * Log email notification to database
 */
export async function logNotification(pool, {
  taskId = null,
  recipientId = null,
  recipientEmail,
  notificationType,
  status,
  errorMessage = null,
}) {
  try {
    if (!pool) return;
    await pool.query(
      `INSERT INTO email_notifications (task_id, recipient_id, recipient_email, notification_type, status, error_message, sent_at)
       VALUES (?, ?, ?, ?, ?, ?, NOW())`,
      [taskId, recipientId, recipientEmail, notificationType, status, errorMessage ? errorMessage.slice(0, 1000) : null]
    );
  } catch (err) {
    console.error('Failed to log email notification to database:', err.message);
  }
}

/**
 * Generate Base Email Shell HTML
 */
function getEmailShell({ badgeText, badgeBg, badgeColor, title, subtitle, contentHtml }) {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      background-color: #f1f5f9;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      color: #1e293b;
      -webkit-font-smoothing: antialiased;
    }
    .wrapper {
      width: 100%;
      table-layout: fixed;
      background-color: #f1f5f9;
      padding: 40px 16px;
    }
    .email-container {
      max-width: 600px;
      margin: 0 auto;
      background-color: #ffffff;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.08), 0 8px 10px -6px rgba(0, 0, 0, 0.04);
      border: 1px solid #e2e8f0;
    }
    .header {
      background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
      padding: 32px 28px;
      text-align: center;
      color: #ffffff;
    }
    .brand-title {
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 2px;
      text-transform: uppercase;
      color: #94a3b8;
      margin: 0 0 10px 0;
    }
    .badge {
      display: inline-block;
      padding: 6px 14px;
      border-radius: 9999px;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      background-color: ${badgeBg};
      color: ${badgeColor};
      margin-bottom: 12px;
    }
    .header-heading {
      font-size: 24px;
      font-weight: 700;
      margin: 0;
      line-height: 1.3;
      color: #ffffff;
    }
    .content {
      padding: 32px 28px;
    }
    .greeting {
      font-size: 17px;
      font-weight: 600;
      color: #0f172a;
      margin-top: 0;
      margin-bottom: 12px;
    }
    .intro-text {
      font-size: 15px;
      line-height: 1.6;
      color: #475569;
      margin-bottom: 24px;
    }
    .card {
      background-color: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 24px;
    }
    .card-title {
      font-size: 18px;
      font-weight: 700;
      color: #0f172a;
      margin: 0 0 8px 0;
    }
    .card-desc {
      font-size: 14px;
      line-height: 1.5;
      color: #64748b;
      margin: 0 0 16px 0;
    }
    .details-table {
      width: 100%;
      border-collapse: collapse;
    }
    .details-table td {
      padding: 10px 0;
      border-bottom: 1px solid #e2e8f0;
      font-size: 14px;
    }
    .details-table tr:last-child td {
      border-bottom: none;
    }
    .detail-label {
      color: #64748b;
      font-weight: 600;
      width: 35%;
    }
    .detail-value {
      color: #0f172a;
      font-weight: 500;
      text-align: right;
    }
    .pill {
      display: inline-block;
      padding: 3px 10px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      text-transform: capitalize;
    }
    .pill-urgent { background-color: #fee2e2; color: #dc2626; }
    .pill-high { background-color: #ffedd5; color: #ea580c; }
    .pill-medium { background-color: #fef9c3; color: #ca8a04; }
    .pill-low { background-color: #dbeafe; color: #2563eb; }
    .pill-todo { background-color: #ede9fe; color: #6366f1; }
    .pill-in_progress { background-color: #fef3c7; color: #d97706; }
    .pill-done { background-color: #d1fae5; color: #059669; }
    .footer {
      background-color: #f8fafc;
      border-top: 1px solid #e2e8f0;
      padding: 20px 28px;
      text-align: center;
      font-size: 13px;
      color: #94a3b8;
    }
    .callout {
      background-color: #eff6ff;
      border-left: 4px solid #3b82f6;
      padding: 12px 16px;
      border-radius: 4px;
      margin: 20px 0 0 0;
      font-size: 14px;
      color: #1e40af;
      font-weight: 500;
    }
    .callout-warning {
      background-color: #fffbeb;
      border-left: 4px solid #f59e0b;
      color: #b45309;
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <table class="email-container" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td class="header">
          <div class="brand-title">TASK MANAGEMENT SYSTEM</div>
          <div class="badge">${badgeText}</div>
          <h1 class="header-heading">${title}</h1>
        </td>
      </tr>
      <tr>
        <td class="content">
          ${contentHtml}
        </td>
      </tr>
      <tr>
        <td class="footer">
          <p style="margin: 0 0 6px 0;">© ${new Date().getFullYear()} Task Management System. All rights reserved.</p>
          <p style="margin: 0; font-size: 12px;">Timezone: ${TIMEZONE}</p>
        </td>
      </tr>
    </table>
  </div>
</body>
</html>
`;
}

/**
 * EVENT 1: Send Task Assigned Email immediately upon task creation/assignment
 */
export async function sendTaskAssignedEmail(task, assigneeUser, creatorUser, pool = null) {
  const taskId = task.id ? `TASK-${task.id}` : 'TASK-NEW';
  const recipientEmail = assigneeUser?.email;
  const assigneeName = assigneeUser?.name || 'Team Member';
  const creatorName = creatorUser?.name || 'Administrator';
  const priority = (task.priority || 'medium').toLowerCase();
  const status = (task.status || (task.completed ? 'done' : 'todo')).toLowerCase();
  const deadlineStr = task.due_date ? formatKolkataDate(task.due_date) : 'No deadline set';
  const createdDateStr = formatKolkataDate(task.created_at || new Date(), true);

  if (!recipientEmail) {
    console.warn(`[TaskEmail] Task ${taskId} has no assignee email. Skipping email.`);
    return { success: false, status: 'skipped', reason: 'No recipient email' };
  }

  const subject = `New Task Assigned: ${task.title}`;
  const fromAddress = process.env.SMTP_FROM || `"Task Management System" <notifications@taskmanagement.local>`;

  const contentHtml = `
    <p class="greeting">Hello ${assigneeName},</p>
    <p class="intro-text">A new task has been assigned to you in the Task Management System.</p>

    <div class="card">
      <div class="card-title">${task.title}</div>
      ${task.description ? `<p class="card-desc">${task.description}</p>` : ''}
      
      <table class="details-table">
        <tr>
          <td class="detail-label">Task ID:</td>
          <td class="detail-value" style="font-family: monospace; font-weight: 700;">${taskId}</td>
        </tr>
        <tr>
          <td class="detail-label">Priority:</td>
          <td class="detail-value">
            <span class="pill pill-${priority}">${priority.toUpperCase()}</span>
          </td>
        </tr>
        <tr>
          <td class="detail-label">Assigned By:</td>
          <td class="detail-value">${creatorName}</td>
        </tr>
        <tr>
          <td class="detail-label">Assigned To:</td>
          <td class="detail-value">${assigneeName}</td>
        </tr>
        <tr>
          <td class="detail-label">Start Date:</td>
          <td class="detail-value">${createdDateStr}</td>
        </tr>
        <tr>
          <td class="detail-label">Deadline:</td>
          <td class="detail-value" style="color: #dc2626; font-weight: 700;">${deadlineStr}</td>
        </tr>
        <tr>
          <td class="detail-label">Status:</td>
          <td class="detail-value">
            <span class="pill pill-${status}">${status.replace('_', ' ').toUpperCase()}</span>
          </td>
        </tr>
      </table>
    </div>

    <div class="callout">
      📌 Please review and complete the task before the deadline.
    </div>
  `;

  const html = getEmailShell({
    badgeText: 'New Task Assignment',
    badgeBg: 'rgba(99, 102, 241, 0.2)',
    badgeColor: '#818cf8',
    title: 'New Task Assigned',
    subtitle: task.title,
    contentHtml,
  });

  try {
    const mailer = await getTransporter();
    const info = await mailer.sendMail({
      from: fromAddress,
      to: recipientEmail,
      subject,
      html,
    });

    console.log(`[TaskEmail] Task created: ${taskId} | Recipient: ${recipientEmail} | Status: SENT`);

    if (pool) {
      await logNotification(pool, {
        taskId: task.id,
        recipientId: assigneeUser?.id || null,
        recipientEmail,
        notificationType: 'TASK_ASSIGNED_EMAIL',
        status: 'SENT',
      });
    }

    return { success: true, status: 'sent', messageId: info.messageId };
  } catch (error) {
    console.error(`[TaskEmail] Task: ${taskId} | Recipient: ${recipientEmail} | Status: FAILED | Reason: ${error.message}`);

    if (pool) {
      await logNotification(pool, {
        taskId: task.id,
        recipientId: assigneeUser?.id || null,
        recipientEmail,
        notificationType: 'TASK_ASSIGNED_EMAIL',
        status: 'FAILED',
        errorMessage: error.message,
      });
    }

    return { success: false, status: 'failed', error: error.message };
  }
}

/**
 * EVENT 2: Send Final Deadline Reminder Email on task deadline day
 */
export async function sendTaskDeadlineReminderEmail(task, assigneeUser, creatorUser, pool = null) {
  const taskId = task.id ? `TASK-${task.id}` : 'TASK-UNKNOWN';
  const recipientEmail = assigneeUser?.email;
  const assigneeName = assigneeUser?.name || 'Team Member';
  const creatorName = creatorUser?.name || 'Administrator';
  const priority = (task.priority || 'medium').toLowerCase();
  const status = (task.status || (task.completed ? 'done' : 'todo')).toLowerCase();
  const deadlineStr = task.due_date ? formatKolkataDate(task.due_date) : 'Today';
  const deadlineWithTime = `${deadlineStr} 11:59 PM IST`;

  if (!recipientEmail) {
    console.warn(`[TaskReminder] Task ${taskId} has no assignee email. Skipping reminder.`);
    return { success: false, status: 'skipped', reason: 'No recipient email' };
  }

  const subject = `Final Reminder: Task Deadline Today - ${task.title}`;
  const fromAddress = process.env.SMTP_FROM || `"Task Management System" <notifications@taskmanagement.local>`;

  const contentHtml = `
    <p class="greeting">Hello ${assigneeName},</p>
    <p class="intro-text">
      This is your <strong>final reminder</strong> that the following task is due <strong>today</strong>.
    </p>

    <div class="card" style="border-left: 4px solid #f59e0b;">
      <div class="card-title">${task.title}</div>
      ${task.description ? `<p class="card-desc">${task.description}</p>` : ''}
      
      <table class="details-table">
        <tr>
          <td class="detail-label">Task ID:</td>
          <td class="detail-value" style="font-family: monospace; font-weight: 700;">${taskId}</td>
        </tr>
        <tr>
          <td class="detail-label">Priority:</td>
          <td class="detail-value">
            <span class="pill pill-${priority}">${priority.toUpperCase()}</span>
          </td>
        </tr>
        <tr>
          <td class="detail-label">Deadline:</td>
          <td class="detail-value" style="color: #b45309; font-weight: 700;">${deadlineWithTime}</td>
        </tr>
        <tr>
          <td class="detail-label">Current Status:</td>
          <td class="detail-value">
            <span class="pill pill-${status}">${status.replace('_', ' ').toUpperCase()}</span>
          </td>
        </tr>
        <tr>
          <td class="detail-label">Assigned By:</td>
          <td class="detail-value">${creatorName}</td>
        </tr>
        <tr>
          <td class="detail-label">Assigned To:</td>
          <td class="detail-value">${assigneeName}</td>
        </tr>
      </table>
    </div>

    <div class="callout callout-warning">
      ⚠️ <strong>Action Required:</strong> Please complete and submit your task before the end of the day.
    </div>
  `;

  const html = getEmailShell({
    badgeText: 'Deadline Today',
    badgeBg: 'rgba(245, 158, 11, 0.2)',
    badgeColor: '#fbbf24',
    title: 'FINAL DEADLINE REMINDER',
    subtitle: task.title,
    contentHtml,
  });

  try {
    const mailer = await getTransporter();
    const info = await mailer.sendMail({
      from: fromAddress,
      to: recipientEmail,
      subject,
      html,
    });

    console.log(`[TaskReminder] Task: ${taskId} | Deadline: ${deadlineStr} | Recipient: ${recipientEmail} | Status: SENT`);

    if (pool) {
      await logNotification(pool, {
        taskId: task.id,
        recipientId: assigneeUser?.id || null,
        recipientEmail,
        notificationType: 'TASK_DEADLINE_REMINDER_EMAIL',
        status: 'SENT',
      });
    }

    return { success: true, status: 'sent', messageId: info.messageId };
  } catch (error) {
    console.error(`[TaskReminder] Task: ${taskId} | Recipient: ${recipientEmail} | Status: FAILED | Reason: ${error.message}`);

    if (pool) {
      await logNotification(pool, {
        taskId: task.id,
        recipientId: assigneeUser?.id || null,
        recipientEmail,
        notificationType: 'TASK_DEADLINE_REMINDER_EMAIL',
        status: 'FAILED',
        errorMessage: error.message,
      });
    }

    return { success: false, status: 'failed', error: error.message };
  }
}
