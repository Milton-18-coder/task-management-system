import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { initDatabase, getPool, closePool } from './db.js';
import { sendTaskAssignedEmail, sendTaskDeadlineReminderEmail, getEmailDeliveryMode } from './emailService.js';
import { initDeadlineScheduler, checkAndSendDeadlineReminders, isDeadlineTodayKolkata } from './reminderScheduler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '.env') });

const app = express();
const PORT = Number(process.env.PORT) || 5000;
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
const NODE_ENV = process.env.NODE_ENV || 'development';
const DEV_TOOLS_ENABLED = NODE_ENV !== 'production' && process.env.ENABLE_DEV_TOOLS === 'true';
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'muralisubbu11@gmail.com').trim().toLowerCase();
const VALID_PRIORITIES = new Set(['low', 'medium', 'high', 'urgent']);
const VALID_STATUSES = new Set(['todo', 'in_progress', 'done']);
const VALID_TASK_TYPES = new Set(['personal', 'assigned']);

const allowedOrigins = (process.env.CLIENT_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Origin is not allowed by CORS policy.'));
  },
}));
app.use(express.json({ limit: '100kb' }));

function runtimeConfigError() {
  if (!JWT_SECRET || JWT_SECRET.length < 32 || JWT_SECRET.includes('replace_with')) {
    return 'JWT_SECRET is required and must be a random value of at least 32 characters.';
  }
  return null;
}

function parseId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function normalizeDate(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    return undefined;
  }
  return value;
}

function validateTaskFields(body, { partial = false } = {}) {
  const errors = [];
  const clean = {};

  if (!partial || body.title !== undefined) {
    if (typeof body.title !== 'string' || !body.title.trim()) errors.push('Task title is required.');
    else if (body.title.trim().length > 255) errors.push('Task title must be 255 characters or fewer.');
    else clean.title = body.title.trim();
  }

  if (body.description !== undefined) {
    if (typeof body.description !== 'string') errors.push('Description must be text.');
    else if (body.description.length > 5000) errors.push('Description must be 5,000 characters or fewer.');
    else clean.description = body.description.trim();
  } else if (!partial) {
    clean.description = '';
  }

  if (body.priority !== undefined) {
    if (!VALID_PRIORITIES.has(body.priority)) errors.push('Priority must be low, medium, high, or urgent.');
    else clean.priority = body.priority;
  } else if (!partial) {
    clean.priority = 'medium';
  }

  if (body.status !== undefined) {
    if (!VALID_STATUSES.has(body.status)) errors.push('Status must be todo, in_progress, or done.');
    else clean.status = body.status;
  } else if (!partial) {
    clean.status = 'todo';
  }

  if (body.completed !== undefined) {
    if (typeof body.completed !== 'boolean') errors.push('Completed must be a boolean.');
    else clean.completed = body.completed;
  }

  if (body.due_date !== undefined) {
    const dueDate = normalizeDate(body.due_date);
    if (dueDate === undefined) errors.push('Due date must be a valid date in YYYY-MM-DD format.');
    else clean.due_date = dueDate;
  } else if (!partial) {
    clean.due_date = null;
  }

  if (body.user_id !== undefined) {
    const userId = parseId(body.user_id);
    if (!userId) errors.push('Assigned user is invalid.');
    else clean.user_id = userId;
  }

  if (body.task_type !== undefined) {
    if (!VALID_TASK_TYPES.has(body.task_type)) errors.push('Task type must be personal or assigned.');
    else clean.task_type = body.task_type;
  } else if (!partial) {
    clean.task_type = 'personal';
  }

  return { clean, errors };
}

function isAdmin(user) {
  return user?.role === 'admin' && String(user.email || '').toLowerCase() === ADMIN_EMAIL;
}

function isTaskManager(task, user) {
  if ((task.task_type || 'personal') === 'personal') return Number(task.user_id) === Number(user.id);
  return isAdmin(user) && Number(task.created_by) === Number(user.id);
}

function canUpdateTaskStatus(task, user) {
  return isTaskManager(task, user) || Number(task.user_id) === Number(user.id);
}

function formatTask(task, user) {
  const completed = Boolean(task.completed);
  const status = task.status || (completed ? 'done' : 'todo');
  return {
    ...task,
    task_type: task.task_type || 'personal',
    completed,
    status,
    deadline_reminder_sent: Boolean(task.deadline_reminder_sent),
    can_manage: isTaskManager(task, user),
    can_update_status: canUpdateTaskStatus(task, user),
  };
}

async function getTask(pool, id) {
  const [rows] = await pool.query(
    `SELECT t.*,
            u.name AS assignee_name, u.email AS assignee_email,
            c.name AS creator_name, c.email AS creator_email
     FROM tasks t
     LEFT JOIN users u ON t.user_id = u.id
     LEFT JOIN users c ON t.created_by = c.id
     WHERE t.id = ?`,
    [id]
  );
  return rows[0] || null;
}

async function userExists(pool, userId) {
  const [rows] = await pool.query('SELECT id FROM users WHERE id = ? LIMIT 1', [userId]);
  return rows.length > 0;
}

function respondWithServerError(res, context, error) {
  console.error(`${context}:`, error);
  return res.status(500).json({ error: 'The server could not complete this request. Please try again.' });
}

function signToken(user) {
  return jwt.sign({ id: user.id }, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
    issuer: 'taskpulse-api',
  });
}

async function authenticateToken(req, res, next) {
  const authHeader = req.get('authorization');
  const [scheme, token] = authHeader?.split(' ') || [];
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Access token required. Please sign in.' });
  }

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET, { issuer: ['taskpulse-api', 'taskflow-api'] });
  } catch {
    return res.status(401).json({ error: 'Your session is invalid or expired. Please sign in again.' });
  }

  try {
    const userId = parseId(payload.id);
    if (!userId) return res.status(401).json({ error: 'Your session is invalid or expired. Please sign in again.' });
    const [rows] = await getPool().query(
      'SELECT id, name, email, role FROM users WHERE id = ? LIMIT 1',
      [userId]
    );
    if (!rows[0]) return res.status(401).json({ error: 'Your account no longer exists.' });
    req.user = rows[0];
    return next();
  } catch (error) {
    return respondWithServerError(res, 'Session lookup failed', error);
  }
}

function requireAdmin(req, res, next) {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Only the TaskPulse admin can access the user directory.' });
  return next();
}

function requireDevTools(req, res, next) {
  if (!DEV_TOOLS_ENABLED) return res.status(404).json({ error: 'Endpoint not found.' });
  return next();
}

app.get('/api/health', async (req, res) => {
  try {
    await getPool().query('SELECT 1');
    return res.json({
      status: 'ok',
      message: 'Database connected',
      timezone: process.env.TASK_TIMEZONE || 'Asia/Kolkata',
      emailMode: getEmailDeliveryMode(),
      devToolsEnabled: DEV_TOOLS_ENABLED,
    });
  } catch {
    return res.status(503).json({
      status: 'error',
      message: 'Database unavailable',
      devToolsEnabled: DEV_TOOLS_ENABLED,
    });
  }
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = req.body.password;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!name || name.length > 100) return res.status(400).json({ error: 'Name is required and must be 100 characters or fewer.' });
    if (!emailRegex.test(email) || email.length > 191) return res.status(400).json({ error: 'Enter a valid email address.' });
    if (typeof password !== 'string' || password.length < 8 || password.length > 72) {
      return res.status(400).json({ error: 'Password must contain between 8 and 72 characters.' });
    }

    const pool = getPool();
    const passwordHash = await bcrypt.hash(password, 12);
    const role = email === ADMIN_EMAIL ? 'admin' : 'user';
    const [result] = await pool.query(
      'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
      [name, email, passwordHash, role]
    );
    const user = { id: result.insertId, name, email, role };
    return res.status(201).json({ message: 'Account created.', user, token: signToken(user) });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'An account with this email already exists.' });
    return respondWithServerError(res, 'Registration failed', error);
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = req.body.password;
    if (!email || typeof password !== 'string') return res.status(400).json({ error: 'Email and password are required.' });

    const [rows] = await getPool().query(
      'SELECT id, name, email, password_hash, role FROM users WHERE email = ? LIMIT 1',
      [email]
    );
    if (!rows[0] || !(await bcrypt.compare(password, rows[0].password_hash))) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const user = { id: rows[0].id, name: rows[0].name, email: rows[0].email, role: rows[0].role };
    return res.json({ message: 'Signed in.', user, token: signToken(user) });
  } catch (error) {
    return respondWithServerError(res, 'Login failed', error);
  }
});

app.get('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    const [rows] = await getPool().query(
      'SELECT id, name, email, role, created_at FROM users WHERE id = ? LIMIT 1',
      [req.user.id]
    );
    if (!rows[0]) return res.status(401).json({ error: 'Your account no longer exists.' });
    return res.json({ user: rows[0] });
  } catch (error) {
    return respondWithServerError(res, 'Profile lookup failed', error);
  }
});

app.get('/api/users', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const [rows] = await getPool().query('SELECT id, name, email, role FROM users ORDER BY name, id');
    return res.json(rows);
  } catch (error) {
    return respondWithServerError(res, 'User lookup failed', error);
  }
});

app.get('/api/tasks', authenticateToken, async (req, res) => {
  try {
    const [rows] = await getPool().query(
      `SELECT t.*,
              u.name AS assignee_name, u.email AS assignee_email,
              c.name AS creator_name, c.email AS creator_email
       FROM tasks t
       LEFT JOIN users u ON t.user_id = u.id
       LEFT JOIN users c ON t.created_by = c.id
       WHERE (t.task_type = 'personal' AND t.user_id = ?)
          OR (t.task_type = 'assigned' AND (t.user_id = ? OR (? = 1 AND t.created_by = ?)))
       ORDER BY t.updated_at DESC, t.id DESC`,
      [req.user.id, req.user.id, isAdmin(req.user) ? 1 : 0, req.user.id]
    );
    return res.json(rows.map((task) => formatTask(task, req.user)));
  } catch (error) {
    return respondWithServerError(res, 'Task lookup failed', error);
  }
});

app.post('/api/tasks', authenticateToken, async (req, res) => {
  try {
    const { clean, errors } = validateTaskFields(req.body);
    if (errors.length) return res.status(400).json({ error: errors[0], errors });

    const pool = getPool();
    const taskType = clean.task_type;
    if (taskType === 'assigned' && !isAdmin(req.user)) {
      return res.status(403).json({ error: 'Only the TaskPulse admin can assign work to other users.' });
    }
    if (taskType === 'personal' && clean.user_id && clean.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Personal tasks can only belong to your own to-do list.' });
    }
    const assignedUserId = taskType === 'personal' ? req.user.id : (clean.user_id || req.user.id);
    if (!(await userExists(pool, assignedUserId))) return res.status(400).json({ error: 'The selected assignee does not exist.' });

    const taskStatus = clean.status;
    const completed = taskStatus === 'done';
    const [result] = await pool.query(
      `INSERT INTO tasks
       (user_id, created_by, task_type, title, description, completed, status, priority, due_date, deadline_reminder_sent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [assignedUserId, req.user.id, taskType, clean.title, clean.description, completed, taskStatus, clean.priority, clean.due_date]
    );

    const rawTask = await getTask(pool, result.insertId);
    const task = formatTask(rawTask, req.user);
    let emailNotification = { status: 'skipped' };
    if (taskType === 'assigned' && rawTask.assignee_email) {
      const emailResult = await sendTaskAssignedEmail(
        task,
        { id: rawTask.user_id, name: rawTask.assignee_name, email: rawTask.assignee_email },
        { id: req.user.id, name: req.user.name, email: req.user.email },
        pool
      );
      emailNotification = { status: emailResult.status, simulated: Boolean(emailResult.simulated) };
    }

    if (clean.due_date && isDeadlineTodayKolkata(clean.due_date) && !completed) {
      setTimeout(() => {
        checkAndSendDeadlineReminders({ targetTaskId: result.insertId, markSent: true }).catch((error) => {
          console.error('[TaskReminder] New-task reminder check failed:', error.message);
        });
      }, 1000);
    }

    return res.status(201).json({ ...task, emailNotification });
  } catch (error) {
    return respondWithServerError(res, 'Task creation failed', error);
  }
});

app.put('/api/tasks/:id', authenticateToken, async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Task id is invalid.' });

    const pool = getPool();
    const current = await getTask(pool, id);
    if (!current || !canUpdateTaskStatus(current, req.user)) {
      return res.status(404).json({ error: 'Task not found.' });
    }

    const canManage = isTaskManager(current, req.user);
    if (!canManage) {
      const forbiddenFields = Object.keys(req.body).filter((key) => !['status', 'completed'].includes(key));
      if (forbiddenFields.length) return res.status(403).json({ error: 'Assignees can only change task status. All other changes require the TaskPulse admin.' });
    }

    const { clean, errors } = validateTaskFields(req.body, { partial: true });
    if (errors.length) return res.status(400).json({ error: errors[0], errors });
    if (Object.keys(clean).length === 0) return res.status(400).json({ error: 'No valid task fields were supplied.' });
    if (clean.task_type !== undefined && clean.task_type !== current.task_type) {
      return res.status(400).json({ error: 'A task cannot be moved between personal and assigned work.' });
    }
    if (current.task_type === 'personal' && clean.user_id !== undefined && clean.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Personal tasks cannot be assigned to another user.' });
    }
    if (current.task_type === 'assigned' && canManage && !isAdmin(req.user)) {
      return res.status(403).json({ error: 'Only the TaskPulse admin can manage assigned work.' });
    }

    const next = {
      title: clean.title ?? current.title,
      description: clean.description ?? current.description ?? '',
      priority: clean.priority ?? current.priority ?? 'medium',
      due_date: clean.due_date !== undefined ? clean.due_date : current.due_date,
      user_id: current.task_type === 'personal' ? req.user.id : (clean.user_id ?? current.user_id ?? req.user.id),
      status: clean.status ?? current.status ?? (current.completed ? 'done' : 'todo'),
    };

    if (clean.status !== undefined) next.completed = clean.status === 'done';
    else if (clean.completed !== undefined) {
      next.completed = clean.completed;
      if (clean.completed) next.status = 'done';
      else if (next.status === 'done') next.status = 'todo';
    } else next.completed = next.status === 'done';

    if (!(await userExists(pool, next.user_id))) return res.status(400).json({ error: 'The selected assignee does not exist.' });

    const oldDueDate = normalizeDate(current.due_date);
    const dueDateChanged = oldDueDate !== next.due_date;
    const assigneeChanged = Number(current.user_id) !== Number(next.user_id);
    const reopened = Boolean(current.completed) && !next.completed;
    const resetReminder = dueDateChanged || assigneeChanged || reopened;

    await pool.query(
      `UPDATE tasks SET
         title = ?, description = ?, completed = ?, status = ?, priority = ?, due_date = ?, user_id = ?,
         deadline_reminder_sent = ?, deadline_reminder_sent_at = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        next.title,
        next.description,
        next.completed,
        next.status,
        next.priority,
        next.due_date,
        next.user_id,
        resetReminder ? 0 : current.deadline_reminder_sent,
        resetReminder ? null : current.deadline_reminder_sent_at,
        id,
      ]
    );

    const rawTask = await getTask(pool, id);
    const task = formatTask(rawTask, req.user);
    let emailNotification = null;
    if (current.task_type === 'assigned' && assigneeChanged && rawTask.assignee_email) {
      const emailResult = await sendTaskAssignedEmail(
        task,
        { id: rawTask.user_id, name: rawTask.assignee_name, email: rawTask.assignee_email },
        { id: req.user.id, name: req.user.name, email: req.user.email },
        pool
      );
      emailNotification = { status: emailResult.status, simulated: Boolean(emailResult.simulated) };
    }

    if (resetReminder && next.due_date && isDeadlineTodayKolkata(next.due_date) && !next.completed) {
      setTimeout(() => {
        checkAndSendDeadlineReminders({ targetTaskId: id, markSent: true }).catch((error) => {
          console.error('[TaskReminder] Updated-task reminder check failed:', error.message);
        });
      }, 1000);
    }

    return res.json({ ...task, ...(emailNotification ? { emailNotification } : {}) });
  } catch (error) {
    return respondWithServerError(res, 'Task update failed', error);
  }
});

app.delete('/api/tasks/:id', authenticateToken, async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Task id is invalid.' });
    const pool = getPool();
    const task = await getTask(pool, id);
    if (!task || !isTaskManager(task, req.user)) return res.status(404).json({ error: 'Task not found.' });
    await pool.query('DELETE FROM tasks WHERE id = ?', [id]);
    return res.json({ message: 'Task deleted.', id });
  } catch (error) {
    return respondWithServerError(res, 'Task deletion failed', error);
  }
});

app.delete('/api/tasks', authenticateToken, async (req, res) => {
  try {
    const taskType = req.query.task_type;
    if (!VALID_TASK_TYPES.has(taskType)) return res.status(400).json({ error: 'Choose personal or assigned tasks to clear.' });
    if (taskType === 'assigned' && !isAdmin(req.user)) {
      return res.status(403).json({ error: 'Only the TaskPulse admin can clear assigned work.' });
    }
    const [result] = taskType === 'personal'
      ? await getPool().query("DELETE FROM tasks WHERE task_type = 'personal' AND user_id = ?", [req.user.id])
      : await getPool().query("DELETE FROM tasks WHERE task_type = 'assigned' AND created_by = ?", [req.user.id]);
    return res.json({ message: `${taskType === 'personal' ? 'Personal' : 'Assigned'} tasks deleted.`, deletedCount: result.affectedRows });
  } catch (error) {
    return respondWithServerError(res, 'Bulk task deletion failed', error);
  }
});

app.post('/api/tasks/:id/test-reminder', authenticateToken, requireDevTools, async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Task id is invalid.' });
    const pool = getPool();
    const task = await getTask(pool, id);
    if (!task || !isTaskManager(task, req.user)) return res.status(404).json({ error: 'Task not found.' });
    if (task.completed || task.status === 'done') return res.status(400).json({ error: 'Completed tasks do not receive reminders.' });
    if (!task.assignee_email) return res.status(400).json({ error: 'This task has no assignee email.' });

    const result = await sendTaskDeadlineReminderEmail(
      task,
      { id: task.user_id, name: task.assignee_name, email: task.assignee_email },
      { id: task.created_by, name: task.creator_name, email: task.creator_email },
      pool
    );
    const markSent = Boolean(req.body.markSent) && result.delivered;
    if (markSent) {
      await pool.query('UPDATE tasks SET deadline_reminder_sent = 1, deadline_reminder_sent_at = NOW() WHERE id = ?', [id]);
    }
    return res.json({
      success: result.success,
      delivered: Boolean(result.delivered),
      simulated: Boolean(result.simulated),
      message: result.simulated
        ? `Reminder simulated for ${task.assignee_email}; configure SMTP for delivery.`
        : result.success
          ? `Reminder sent to ${task.assignee_email}.`
          : 'Reminder delivery failed.',
      markSent,
    });
  } catch (error) {
    return respondWithServerError(res, 'Test reminder failed', error);
  }
});

app.post('/api/reminder/trigger-check', authenticateToken, requireDevTools, async (req, res) => {
  try {
    const summary = await checkAndSendDeadlineReminders({
      forceAll: Boolean(req.body.forceAll),
      ownerUserId: req.user.id,
    });
    return res.json({ success: !summary.error, message: 'Reminder check completed.', summary });
  } catch (error) {
    return respondWithServerError(res, 'Reminder check failed', error);
  }
});

app.get('/api/notifications', authenticateToken, async (req, res) => {
  try {
    const [rows] = await getPool().query(
      `SELECT n.id, n.task_id, n.recipient_id, n.recipient_email, n.notification_type,
              n.status, n.sent_at, n.error_message, t.title AS task_title
       FROM email_notifications n
       LEFT JOIN tasks t ON n.task_id = t.id
       WHERE n.recipient_id = ?
          OR (t.task_type = 'personal' AND t.user_id = ?)
          OR (t.task_type = 'assigned' AND (t.user_id = ? OR (? = 1 AND t.created_by = ?)))
       ORDER BY n.id DESC LIMIT 50`,
      [req.user.id, req.user.id, req.user.id, isAdmin(req.user) ? 1 : 0, req.user.id]
    );
    return res.json(rows);
  } catch (error) {
    return respondWithServerError(res, 'Notification lookup failed', error);
  }
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint not found.' }));
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error.message === 'Origin is not allowed by CORS policy.') return res.status(403).json({ error: error.message });
  if (error instanceof SyntaxError && 'body' in error) return res.status(400).json({ error: 'Request body contains invalid JSON.' });
  console.error('Unhandled request error:', error);
  return res.status(500).json({ error: 'Unexpected server error.' });
});

export async function startServer() {
  const configError = runtimeConfigError();
  if (configError) throw new Error(configError);

  const databaseReady = await initDatabase();
  if (databaseReady) initDeadlineScheduler();
  else console.warn('API started in degraded mode; database-backed routes will fail until MySQL is available.');

  return new Promise((resolve, reject) => {
    const server = app.listen(PORT, () => {
      console.log(`TaskPulse API listening on http://localhost:${PORT}`);
      resolve(server);
    });
    server.on('error', reject);
  });
}

export { app };

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  startServer().catch((error) => {
    console.error(`Server startup failed: ${error.message}`);
    process.exitCode = 1;
  });
}

async function shutdown(signal) {
  console.log(`${signal} received; closing database connections.`);
  await closePool().catch(() => {});
  process.exit(0);
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
