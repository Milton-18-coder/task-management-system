import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '.env') });
dotenv.config();

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  port: Number(process.env.DB_PORT) || 3306,
  database: process.env.DB_NAME || 'task_management_db',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
};

let pool = null;

// Initialize database and tables automatically
export async function initDatabase() {
  try {
    // 1. First connect without specifying the database to ensure database exists
    const rootConnection = await mysql.createConnection({
      host: dbConfig.host,
      user: dbConfig.user,
      password: dbConfig.password,
      port: dbConfig.port,
    });

    await rootConnection.query(
      `CREATE DATABASE IF NOT EXISTS \`${dbConfig.database}\`;`
    );
    await rootConnection.end();

    // 2. Create connection pool for the target database
    pool = mysql.createPool(dbConfig);

    // 3. Ensure users table exists
    const createUsersTableQuery = `
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(191) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      );
    `;
    await pool.query(createUsersTableQuery);

    // 4. Ensure tasks table exists
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS tasks (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NULL,
        created_by INT NULL,
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
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
      );
    `;
    await pool.query(createTableQuery);

    // 5. Ensure email_notifications table exists for notification logging & history
    const createNotificationsTableQuery = `
      CREATE TABLE IF NOT EXISTS email_notifications (
        id INT AUTO_INCREMENT PRIMARY KEY,
        task_id INT NULL,
        recipient_id INT NULL,
        recipient_email VARCHAR(191) NOT NULL,
        notification_type ENUM('TASK_ASSIGNED_EMAIL', 'TASK_DEADLINE_REMINDER_EMAIL', 'TEST_EMAIL') NOT NULL,
        status ENUM('SENT', 'FAILED', 'SKIPPED') NOT NULL,
        sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        error_message TEXT NULL,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
        FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE SET NULL
      );
    `;
    await pool.query(createNotificationsTableQuery);
    
    // Auto-migrate: Add user_id column if missing
    try {
      const [columns] = await pool.query(`SHOW COLUMNS FROM tasks LIKE 'user_id'`);
      if (columns.length === 0) {
        await pool.query(`ALTER TABLE tasks ADD COLUMN user_id INT NULL AFTER id`);
        await pool.query(`
          ALTER TABLE tasks 
          ADD CONSTRAINT fk_tasks_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        `);
      }
    } catch (e) {
      // Column might already exist or FK already present
    }

    // Auto-migrate: Add created_by column if missing
    try {
      const [columns] = await pool.query(`SHOW COLUMNS FROM tasks LIKE 'created_by'`);
      if (columns.length === 0) {
        await pool.query(`ALTER TABLE tasks ADD COLUMN created_by INT NULL AFTER user_id`);
        await pool.query(`
          ALTER TABLE tasks 
          ADD CONSTRAINT fk_tasks_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
        `);
      }
    } catch (e) {
      // Column might already exist or FK already present
    }

    // Auto-migrate: Add status column if missing
    try {
      const [columns] = await pool.query(`SHOW COLUMNS FROM tasks LIKE 'status'`);
      if (columns.length === 0) {
        await pool.query(`ALTER TABLE tasks ADD COLUMN status ENUM('todo', 'in_progress', 'done') DEFAULT 'todo' AFTER completed`);
        await pool.query(`UPDATE tasks SET status = 'done' WHERE completed = 1`);
        await pool.query(`UPDATE tasks SET status = 'todo' WHERE completed = 0 OR status IS NULL`);
      }
    } catch (e) {
      // Column already exists
    }

    // Auto-migrate: Add priority column if missing
    try {
      const [columns] = await pool.query(`SHOW COLUMNS FROM tasks LIKE 'priority'`);
      if (columns.length === 0) {
        await pool.query(`ALTER TABLE tasks ADD COLUMN priority ENUM('low', 'medium', 'high', 'urgent') DEFAULT 'medium' AFTER completed`);
      }
    } catch (e) {
      // Column already exists
    }

    // Auto-migrate: Add due_date column if missing
    try {
      const [columns] = await pool.query(`SHOW COLUMNS FROM tasks LIKE 'due_date'`);
      if (columns.length === 0) {
        await pool.query(`ALTER TABLE tasks ADD COLUMN due_date DATE NULL AFTER priority`);
      }
    } catch (e) {
      // Column already exists
    }

    // Auto-migrate: Add deadline_reminder_sent column if missing
    try {
      const [columns] = await pool.query(`SHOW COLUMNS FROM tasks LIKE 'deadline_reminder_sent'`);
      if (columns.length === 0) {
        await pool.query(`ALTER TABLE tasks ADD COLUMN deadline_reminder_sent BOOLEAN DEFAULT FALSE AFTER due_date`);
      }
    } catch (e) {
      // Column already exists
    }

    // Auto-migrate: Add deadline_reminder_sent_at column if missing
    try {
      const [columns] = await pool.query(`SHOW COLUMNS FROM tasks LIKE 'deadline_reminder_sent_at'`);
      if (columns.length === 0) {
        await pool.query(`ALTER TABLE tasks ADD COLUMN deadline_reminder_sent_at DATETIME NULL AFTER deadline_reminder_sent`);
      }
    } catch (e) {
      // Column already exists
    }

    // Ensure updated_at auto-updates on existing tables as well
    try {
      await pool.query(`
        ALTER TABLE tasks 
        MODIFY COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;
      `);
    } catch (e) {
      // Ignore if already configured or alter not permitted
    }

    console.log(`✅ Connected to MySQL database "${dbConfig.database}" at ${dbConfig.host}:${dbConfig.port}`);
    return true;
  } catch (error) {
    console.error('❌ Failed to connect to MySQL:', error.message);
    return false;
  }
}

export function getPool() {
  if (!pool) {
    pool = mysql.createPool(dbConfig);
  }
  return pool;
}
