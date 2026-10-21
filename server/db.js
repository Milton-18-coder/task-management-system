import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '.env') });

const databaseName = process.env.DB_NAME || 'task_management_db';
const adminEmail = (process.env.ADMIN_EMAIL || 'muralisubbu11@gmail.com').trim().toLowerCase();
if (!/^[a-zA-Z0-9_]+$/.test(databaseName)) {
  throw new Error('DB_NAME may contain only letters, numbers, and underscores.');
}

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  port: Number(process.env.DB_PORT) || 3306,
  database: databaseName,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  dateStrings: ['DATE'],
};

let pool = null;

async function ensureColumn(dbPool, table, column, definition) {
  const [columns] = await dbPool.query(`SHOW COLUMNS FROM \`${table}\` LIKE ?`, [column]);
  if (columns.length === 0) {
    await dbPool.query(`ALTER TABLE \`${table}\` ADD COLUMN ${definition}`);
  }
}

async function ensureIndex(dbPool, table, indexName, columns) {
  const [rows] = await dbPool.query(
    `SELECT 1 FROM information_schema.statistics
     WHERE table_schema = ? AND table_name = ? AND index_name = ? LIMIT 1`,
    [databaseName, table, indexName]
  );
  if (rows.length === 0) {
    await dbPool.query(`CREATE INDEX \`${indexName}\` ON \`${table}\` (${columns})`);
  }
}

async function ensureForeignKey(dbPool, table, column, constraintName, referencedTable, onDelete) {
  const [rows] = await dbPool.query(
    `SELECT 1 FROM information_schema.key_column_usage
     WHERE table_schema = ? AND table_name = ? AND column_name = ?
       AND referenced_table_name = ? LIMIT 1`,
    [databaseName, table, column, referencedTable]
  );
  if (rows.length === 0) {
    await dbPool.query(
      `ALTER TABLE \`${table}\` ADD CONSTRAINT \`${constraintName}\`
       FOREIGN KEY (\`${column}\`) REFERENCES \`${referencedTable}\`(id) ON DELETE ${onDelete}`
    );
  }
}

export async function initDatabase() {
  let bootstrapConnection;
  try {
    bootstrapConnection = await mysql.createConnection({
      host: dbConfig.host,
      user: dbConfig.user,
      password: dbConfig.password,
      port: dbConfig.port,
      connectTimeout: 10000,
    });
    await bootstrapConnection.query(`CREATE DATABASE IF NOT EXISTS \`${databaseName}\``);
    await bootstrapConnection.end();
    bootstrapConnection = null;

    pool = mysql.createPool(dbConfig);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(191) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        role ENUM('admin', 'user') NOT NULL DEFAULT 'user',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS tasks (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NULL,
        created_by INT NULL,
        task_type ENUM('personal', 'assigned') NOT NULL DEFAULT 'personal',
        title VARCHAR(255) NOT NULL,
        description TEXT,
        completed BOOLEAN DEFAULT FALSE,
        status ENUM('todo', 'in_progress', 'done') DEFAULT 'todo',
        priority ENUM('low', 'medium', 'high', 'urgent') DEFAULT 'medium',
        due_date DATE NULL,
        deadline_reminder_sent BOOLEAN DEFAULT FALSE,
        deadline_reminder_sent_at DATETIME NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_tasks_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_tasks_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS email_notifications (
        id INT AUTO_INCREMENT PRIMARY KEY,
        task_id INT NULL,
        recipient_id INT NULL,
        recipient_email VARCHAR(191) NOT NULL,
        notification_type ENUM('TASK_ASSIGNED_EMAIL', 'TASK_DEADLINE_REMINDER_EMAIL', 'TEST_EMAIL') NOT NULL,
        status ENUM('SENT', 'FAILED', 'SKIPPED', 'SIMULATED') NOT NULL,
        sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        error_message TEXT NULL,
        CONSTRAINT fk_notifications_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
        CONSTRAINT fk_notifications_recipient FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE SET NULL
      )
    `);

    await ensureColumn(pool, 'users', 'role', "`role` ENUM('admin', 'user') NOT NULL DEFAULT 'user' AFTER `password_hash`");
    await ensureColumn(pool, 'tasks', 'user_id', '`user_id` INT NULL AFTER `id`');
    await ensureColumn(pool, 'tasks', 'created_by', '`created_by` INT NULL AFTER `user_id`');
    await ensureColumn(pool, 'tasks', 'task_type', "`task_type` ENUM('personal', 'assigned') NOT NULL DEFAULT 'personal' AFTER `created_by`");
    await ensureColumn(pool, 'tasks', 'completed', '`completed` BOOLEAN DEFAULT FALSE AFTER `description`');
    await ensureColumn(pool, 'tasks', 'status', "`status` ENUM('todo', 'in_progress', 'done') DEFAULT 'todo' AFTER `completed`");
    await ensureColumn(pool, 'tasks', 'priority', "`priority` ENUM('low', 'medium', 'high', 'urgent') DEFAULT 'medium' AFTER `status`");
    await ensureColumn(pool, 'tasks', 'due_date', '`due_date` DATE NULL AFTER `priority`');
    await ensureColumn(pool, 'tasks', 'deadline_reminder_sent', '`deadline_reminder_sent` BOOLEAN DEFAULT FALSE AFTER `due_date`');
    await ensureColumn(pool, 'tasks', 'deadline_reminder_sent_at', '`deadline_reminder_sent_at` DATETIME NULL AFTER `deadline_reminder_sent`');

    await pool.query("ALTER TABLE tasks MODIFY COLUMN status ENUM('todo', 'in_progress', 'done') DEFAULT 'todo'");
    await pool.query("ALTER TABLE tasks MODIFY COLUMN priority ENUM('low', 'medium', 'high', 'urgent') DEFAULT 'medium'");
    await pool.query("ALTER TABLE tasks MODIFY COLUMN task_type ENUM('personal', 'assigned') NOT NULL DEFAULT 'personal'");
    await pool.query("ALTER TABLE users MODIFY COLUMN role ENUM('admin', 'user') NOT NULL DEFAULT 'user'");
    await pool.query("ALTER TABLE email_notifications MODIFY COLUMN status ENUM('SENT', 'FAILED', 'SKIPPED', 'SIMULATED') NOT NULL");
    await pool.query("UPDATE users SET role = IF(LOWER(email) = ?, 'admin', 'user')", [adminEmail]);
    await pool.query('UPDATE tasks SET created_by = user_id WHERE created_by IS NULL AND user_id IS NOT NULL');
    await pool.query(
      `UPDATE tasks t
       JOIN users c ON t.created_by = c.id
       SET t.task_type = 'assigned'
       WHERE t.task_type = 'personal' AND LOWER(c.email) = ? AND t.user_id <> t.created_by`,
      [adminEmail]
    );
    await pool.query("UPDATE tasks SET status = IF(completed = 1, 'done', 'todo') WHERE status IS NULL");
    await pool.query("UPDATE tasks SET completed = (status = 'done') WHERE completed != (status = 'done')");
    await pool.query(`
      ALTER TABLE tasks
      MODIFY COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    `);

    await ensureForeignKey(pool, 'tasks', 'user_id', 'fk_tasks_user', 'users', 'CASCADE');
    await ensureForeignKey(pool, 'tasks', 'created_by', 'fk_tasks_creator', 'users', 'SET NULL');
    await ensureForeignKey(pool, 'email_notifications', 'task_id', 'fk_notifications_task', 'tasks', 'CASCADE');
    await ensureForeignKey(pool, 'email_notifications', 'recipient_id', 'fk_notifications_recipient', 'users', 'SET NULL');

    await ensureIndex(pool, 'tasks', 'idx_tasks_assignee', '`user_id`');
    await ensureIndex(pool, 'tasks', 'idx_tasks_creator', '`created_by`');
    await ensureIndex(pool, 'tasks', 'idx_tasks_type_assignee', '`task_type`, `user_id`');
    await ensureIndex(pool, 'tasks', 'idx_tasks_reminders', '`completed`, `deadline_reminder_sent`, `due_date`');
    await ensureIndex(pool, 'email_notifications', 'idx_notifications_recipient', '`recipient_id`, `sent_at`');

    console.log(`Connected to MySQL database "${databaseName}" at ${dbConfig.host}:${dbConfig.port}`);
    return true;
  } catch (error) {
    if (bootstrapConnection) await bootstrapConnection.end().catch(() => {});
    console.error('Failed to initialize MySQL:', error.message);
    return false;
  }
}

export function getPool() {
  if (!pool) pool = mysql.createPool(dbConfig);
  return pool;
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
