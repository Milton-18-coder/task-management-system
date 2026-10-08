import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { initDatabase, getPool } from './db.js';
import {
  sendTaskAssignedEmail,
  sendTaskDeadlineReminderEmail,
  formatKolkataDate,
} from './emailService.js';
import {
  initDeadlineScheduler,
  checkAndSendDeadlineReminders,
} from './reminderScheduler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '.env') });
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'task_management_jwt_secret_key_2025';

app.use(cors());
app.use(express.json());

// ==========================================
// Authentication Middleware
// ==========================================
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Format: "Bearer <TOKEN>"

  if (!token) {
    return res.status(401).json({ error: 'Access token required. Please log in.' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired session. Please log in again.' });
    }
    req.user = user;
    next();
  });
};

// ==========================================
// Health Check / Connection Test
// ==========================================
app.get('/api/health', async (req, res) => {
  try {
    const pool = getPool();
    await pool.query('SELECT 1');
    res.json({
      status: 'ok',
      message: 'Database connected successfully',
      timezone: process.env.TASK_TIMEZONE || 'Asia/Kolkata',
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: 'Database disconnected', error: err.message });
  }
});

// ==========================================
// User Authentication Endpoints
// ==========================================

// POST /api/auth/register - Register a new user account
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }
    if (!email || !email.trim()) {
      return res.status(400).json({ error: 'Email is required' });
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      return res.status(400).json({ error: 'Please enter a valid email address' });
    }
    if (!password || password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long' });
    }

    const pool = getPool();
    const normalizedEmail = email.trim().toLowerCase();

    // Check if email is already registered
    const [existing] = await pool.query('SELECT id FROM users WHERE email = ?', [normalizedEmail]);
    if (existing.length > 0) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    // Hash password & create user
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    const [result] = await pool.query(
      'INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)',
      [name.trim(), normalizedEmail, passwordHash]
    );

    const user = {
      id: result.insertId,
      name: name.trim(),
      email: normalizedEmail,
    };

    // Generate JWT token (valid for 7 days)
    const token = jwt.sign({ id: user.id, name: user.name, email: user.email }, JWT_SECRET, {
      expiresIn: '7d',
    });

    res.status(201).json({
      message: 'Account registered successfully',
      user,
      token,
    });
  } catch (error) {
    console.error('Error during registration:', error);
    res.status(500).json({ error: 'Failed to register account: ' + error.message });
  }
});

// POST /api/auth/login - Log in with existing credentials
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !email.trim() || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const pool = getPool();
    const normalizedEmail = email.trim().toLowerCase();

    const [rows] = await pool.query(
      'SELECT id, name, email, password_hash FROM users WHERE email = ?',
      [normalizedEmail]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const userRecord = rows[0];
    const isPasswordValid = await bcrypt.compare(password, userRecord.password_hash);

    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = {
      id: userRecord.id,
      name: userRecord.name,
      email: userRecord.email,
    };

    const token = jwt.sign({ id: user.id, name: user.name, email: user.email }, JWT_SECRET, {
      expiresIn: '7d',
    });

    res.json({
      message: 'Login successful',
      user,
      token,
    });
  } catch (error) {
    console.error('Error during login:', error);
    res.status(500).json({ error: 'Failed to login: ' + error.message });
  }
});

// GET /api/auth/me - Verify current token and get current user profile
app.get('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query('SELECT id, name, email, created_at FROM users WHERE id = ?', [
      req.user.id,
    ]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'User profile not found' });
    }

    res.json({ user: rows[0] });
  } catch (error) {
    console.error('Error fetching current user:', error);
    res.status(500).json({ error: 'Failed to fetch user: ' + error.message });
  }
});

// GET /api/users - Get registered users for assignment dropdown
app.get('/api/users', authenticateToken, async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query('SELECT id, name, email FROM users ORDER BY name ASC');
    res.json(rows);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Failed to fetch users: ' + error.message });
  }
});

// ==========================================
// Task Management Endpoints
// ==========================================

// GET all tasks for logged in user
app.get('/api/tasks', authenticateToken, async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT t.*, 
              u.name AS assignee_name, u.email AS assignee_email,
              c.name AS creator_name, c.email AS creator_email
       FROM tasks t
       LEFT JOIN users u ON t.user_id = u.id
       LEFT JOIN users c ON t.created_by = c.id
       WHERE t.user_id = ?
       ORDER BY t.id DESC`,
      [req.user.id]
    );

    const formatted = rows.map((t) => {
      const isCompleted = Boolean(t.completed);
      const taskStatus = t.status || (isCompleted ? 'done' : 'todo');
      return {
        ...t,
        completed: isCompleted,
        status: taskStatus,
        deadline_reminder_sent: Boolean(t.deadline_reminder_sent),
      };
    });
    res.json(formatted);
  } catch (error) {
    console.error('Error fetching tasks:', error);
    res.status(500).json({ error: 'Failed to fetch tasks: ' + error.message });
  }
});

// POST create a new task for logged in user (with Immediate Email Assignment)
app.post('/api/tasks', authenticateToken, async (req, res) => {
  try {
    const { title, description, priority, due_date, status, user_id } = req.body;
    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Task title is required' });
    }

    const validPriorities = ['low', 'medium', 'high', 'urgent'];
    const taskPriority = validPriorities.includes(priority) ? priority : 'medium';
    const taskDueDate = due_date ? due_date : null;

    const validStatuses = ['todo', 'in_progress', 'done'];
    const taskStatus = validStatuses.includes(status) ? status : 'todo';
    const isCompleted = taskStatus === 'done' ? 1 : 0;

    // Assigned user defaults to req.user.id if not specified
    const assignedUserId = user_id ? Number(user_id) : req.user.id;
    const creatorUserId = req.user.id;

    const pool = getPool();

    // 1. Insert task into database
    const [result] = await pool.query(
      `INSERT INTO tasks (user_id, created_by, title, description, completed, status, priority, due_date, deadline_reminder_sent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [
        assignedUserId,
        creatorUserId,
        title.trim(),
        (description || '').trim(),
        isCompleted,
        taskStatus,
        taskPriority,
        taskDueDate,
      ]
    );

    // 2. Fetch the newly created task with creator and assignee info
    const [rows] = await pool.query(
      `SELECT t.*, 
              u.name AS assignee_name, u.email AS assignee_email,
              c.name AS creator_name, c.email AS creator_email
       FROM tasks t
       LEFT JOIN users u ON t.user_id = u.id
       LEFT JOIN users c ON t.created_by = c.id
       WHERE t.id = ?`,
      [result.insertId]
    );

    const rawTask = rows[0];
    const newTask = {
      ...rawTask,
      completed: Boolean(rawTask.completed),
      status: rawTask.status || (rawTask.completed ? 'done' : 'todo'),
      deadline_reminder_sent: Boolean(rawTask.deadline_reminder_sent),
    };

    // 3. Immediately send assignment email to assigned user
    let emailStatus = 'skipped';
    try {
      if (rawTask.assignee_email) {
        const assigneeUser = {
          id: rawTask.user_id,
          name: rawTask.assignee_name || 'Team Member',
          email: rawTask.assignee_email,
        };
        const creatorUser = {
          id: rawTask.created_by,
          name: rawTask.creator_name || req.user.name || 'Administrator',
          email: rawTask.creator_email || req.user.email,
        };

        const emailResult = await sendTaskAssignedEmail(newTask, assigneeUser, creatorUser, pool);
        emailStatus = emailResult.status || (emailResult.success ? 'sent' : 'failed');
      }
    } catch (emailErr) {
      console.error('[TaskEmail] Error in assignment email dispatch:', emailErr.message);
      emailStatus = 'failed';
    }

    // 4. Return response (Email failure does NOT fail task creation)
    res.status(201).json({
      ...newTask,
      success: true,
      emailNotification: {
        status: emailStatus,
      },
    });
  } catch (error) {
    console.error('Error creating task:', error);
    res.status(500).json({ error: 'Failed to create task: ' + error.message });
  }
});

// PUT update a task (user scoped)
app.put('/api/tasks/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, completed, status, priority, due_date, user_id } = req.body;
    const pool = getPool();

    // Check if task exists and user has access
    const [existing] = await pool.query(
      'SELECT * FROM tasks WHERE id = ? AND user_id = ?',
      [id, req.user.id]
    );
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Task not found or access denied' });
    }

    const currentTask = existing[0];
    const updatedTitle = title !== undefined ? title.trim() : currentTask.title;
    const updatedDesc = description !== undefined ? description.trim() : currentTask.description;

    const validStatuses = ['todo', 'in_progress', 'done'];
    let updatedStatus = status !== undefined && validStatuses.includes(status)
      ? status
      : currentTask.status || (currentTask.completed ? 'done' : 'todo');

    let updatedCompleted;
    if (completed !== undefined) {
      updatedCompleted = completed ? 1 : 0;
      if (completed && updatedStatus !== 'done') {
        updatedStatus = 'done';
      } else if (!completed && updatedStatus === 'done') {
        updatedStatus = 'todo';
      }
    } else {
      updatedCompleted = updatedStatus === 'done' ? 1 : 0;
    }

    const validPriorities = ['low', 'medium', 'high', 'urgent'];
    const updatedPriority = priority !== undefined && validPriorities.includes(priority)
      ? priority
      : currentTask.priority || 'medium';

    const updatedDueDate = due_date !== undefined ? (due_date || null) : currentTask.due_date;
    const updatedUserId = user_id !== undefined ? (user_id ? Number(user_id) : null) : currentTask.user_id;

    // Reset deadline_reminder_sent if due_date has changed or reopened
    let resetReminder = false;
    if (due_date !== undefined) {
      const oldDueStr = currentTask.due_date ? new Date(currentTask.due_date).toISOString().split('T')[0] : null;
      const newDueStr = updatedDueDate ? new Date(updatedDueDate).toISOString().split('T')[0] : null;
      if (oldDueStr !== newDueStr) {
        resetReminder = true;
      }
    }

    if (currentTask.completed && !updatedCompleted) {
      // Reopened task: reset reminder so it can be reminded if due in the future
      resetReminder = true;
    }

    if (resetReminder) {
      await pool.query(
        `UPDATE tasks 
         SET title = ?, description = ?, completed = ?, status = ?, priority = ?, due_date = ?, user_id = ?, 
             deadline_reminder_sent = 0, deadline_reminder_sent_at = NULL, updated_at = CURRENT_TIMESTAMP 
         WHERE id = ? AND user_id = ?`,
        [updatedTitle, updatedDesc, updatedCompleted, updatedStatus, updatedPriority, updatedDueDate, updatedUserId, id, req.user.id]
      );
    } else {
      await pool.query(
        `UPDATE tasks 
         SET title = ?, description = ?, completed = ?, status = ?, priority = ?, due_date = ?, user_id = ?, updated_at = CURRENT_TIMESTAMP 
         WHERE id = ? AND user_id = ?`,
        [updatedTitle, updatedDesc, updatedCompleted, updatedStatus, updatedPriority, updatedDueDate, updatedUserId, id, req.user.id]
      );
    }

    const [updatedRows] = await pool.query(
      `SELECT t.*, 
              u.name AS assignee_name, u.email AS assignee_email,
              c.name AS creator_name, c.email AS creator_email
       FROM tasks t
       LEFT JOIN users u ON t.user_id = u.id
       LEFT JOIN users c ON t.created_by = c.id
       WHERE t.id = ? AND t.user_id = ?`,
      [id, req.user.id]
    );

    const task = {
      ...updatedRows[0],
      completed: Boolean(updatedRows[0].completed),
      status: updatedRows[0].status || (updatedRows[0].completed ? 'done' : 'todo'),
      deadline_reminder_sent: Boolean(updatedRows[0].deadline_reminder_sent),
    };
    res.json(task);
  } catch (error) {
    console.error('Error updating task:', error);
    res.status(500).json({ error: 'Failed to update task: ' + error.message });
  }
});

// DELETE a single task (user scoped)
app.delete('/api/tasks/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const pool = getPool();
    const [result] = await pool.query(
      'DELETE FROM tasks WHERE id = ? AND user_id = ?',
      [id, req.user.id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Task not found or access denied' });
    }

    res.json({ message: 'Task deleted successfully', id: Number(id) });
  } catch (error) {
    console.error('Error deleting task:', error);
    res.status(500).json({ error: 'Failed to delete task: ' + error.message });
  }
});

// DELETE all tasks for logged in user
app.delete('/api/tasks', authenticateToken, async (req, res) => {
  try {
    const pool = getPool();
    await pool.query('DELETE FROM tasks WHERE user_id = ?', [req.user.id]);
    res.json({ message: 'All your tasks deleted successfully' });
  } catch (error) {
    console.error('Error clearing tasks:', error);
    res.status(500).json({ error: 'Failed to clear tasks: ' + error.message });
  }
});

// ==========================================
// Deadline Reminder & Notification Endpoints
// ==========================================

// POST /api/tasks/:id/test-reminder - Development & test reminder trigger
app.post('/api/tasks/:id/test-reminder', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const markSent = Boolean(req.body.markSent);
    const pool = getPool();

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

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const task = rows[0];

    if (task.completed || task.status === 'done') {
      return res.status(400).json({
        error: 'Task is already completed. Final reminder cannot be sent for completed tasks.',
      });
    }

    if (!task.assignee_email) {
      return res.status(400).json({ error: 'Task has no assigned user email.' });
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

    const result = await sendTaskDeadlineReminderEmail(task, assigneeUser, creatorUser, pool);

    if (result.success && markSent) {
      await pool.query(
        'UPDATE tasks SET deadline_reminder_sent = 1, deadline_reminder_sent_at = NOW() WHERE id = ?',
        [id]
      );
    }

    res.json({
      success: result.success,
      message: result.success
        ? `Test deadline reminder email sent to ${task.assignee_email}`
        : `Failed to send email: ${result.error}`,
      markSent,
      result,
    });
  } catch (error) {
    console.error('Error sending test reminder:', error);
    res.status(500).json({ error: 'Failed to send test reminder: ' + error.message });
  }
});

// POST /api/reminder/trigger-check - Manually trigger the daily deadline reminder cycle
app.post('/api/reminder/trigger-check', authenticateToken, async (req, res) => {
  try {
    const forceAll = Boolean(req.body.forceAll);
    const summary = await checkAndSendDeadlineReminders({ forceAll });
    res.json({
      success: true,
      message: 'Deadline reminder check executed',
      summary,
    });
  } catch (error) {
    console.error('Error triggering reminder check:', error);
    res.status(500).json({ error: 'Failed to run reminder check: ' + error.message });
  }
});

// GET /api/notifications - View email notification logs
app.get('/api/notifications', authenticateToken, async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT n.*, t.title AS task_title 
       FROM email_notifications n
       LEFT JOIN tasks t ON n.task_id = t.id
       ORDER BY n.id DESC LIMIT 50`
    );
    res.json(rows);
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({ error: 'Failed to fetch notifications: ' + error.message });
  }
});

// Start the server
async function start() {
  const dbInitialized = await initDatabase();
  if (dbInitialized) {
    // Start automated backend deadline reminder scheduler
    initDeadlineScheduler();
  }

  const server = app.listen(PORT, () => {
    console.log(`🚀 Task Management API server running on http://localhost:${PORT}`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`❌ Port ${PORT} is already in use. Please close the running instance or terminate the process on port ${PORT}.`);
    } else {
      console.error('❌ Server startup error:', err);
    }
  });
}

start();
