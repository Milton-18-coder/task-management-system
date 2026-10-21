-- Create database if it does not exist
CREATE DATABASE IF NOT EXISTS task_management_db;

-- Use the database
USE task_management_db;

-- Create users table
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(191) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('admin', 'user') NOT NULL DEFAULT 'user',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Create tasks table with user_id reference, created_by, priority, due_date, status, and reminder tracking
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
  INDEX idx_tasks_assignee (user_id),
  INDEX idx_tasks_creator (created_by),
  INDEX idx_tasks_type_assignee (task_type, user_id),
  INDEX idx_tasks_reminders (completed, deadline_reminder_sent, due_date),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

-- Create email_notifications log table
CREATE TABLE IF NOT EXISTS email_notifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  task_id INT NULL,
  recipient_id INT NULL,
  recipient_email VARCHAR(191) NOT NULL,
  notification_type ENUM('TASK_ASSIGNED_EMAIL', 'TASK_DEADLINE_REMINDER_EMAIL', 'TEST_EMAIL') NOT NULL,
  status ENUM('SENT', 'FAILED', 'SKIPPED', 'SIMULATED') NOT NULL,
  sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  error_message TEXT NULL,
  INDEX idx_notifications_recipient (recipient_id, sent_at),
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE SET NULL
);
