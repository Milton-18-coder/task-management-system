-- Safe, data-preserving migration for existing TaskPulse databases.
-- The server applies these changes automatically during startup; this file is
-- provided for environments where a DBA applies schema changes manually.

USE task_management_db;

ALTER TABLE email_notifications
  MODIFY COLUMN status ENUM('SENT', 'FAILED', 'SKIPPED', 'SIMULATED') NOT NULL;

UPDATE tasks
SET created_by = user_id
WHERE created_by IS NULL AND user_id IS NOT NULL;

SET @statement = IF(
  (SELECT COUNT(*) FROM information_schema.statistics
   WHERE table_schema = DATABASE() AND table_name = 'tasks' AND index_name = 'idx_tasks_assignee') = 0,
  'CREATE INDEX idx_tasks_assignee ON tasks (user_id)',
  'SELECT 1'
);
PREPARE migration_statement FROM @statement;
EXECUTE migration_statement;
DEALLOCATE PREPARE migration_statement;

SET @statement = IF(
  (SELECT COUNT(*) FROM information_schema.statistics
   WHERE table_schema = DATABASE() AND table_name = 'tasks' AND index_name = 'idx_tasks_creator') = 0,
  'CREATE INDEX idx_tasks_creator ON tasks (created_by)',
  'SELECT 1'
);
PREPARE migration_statement FROM @statement;
EXECUTE migration_statement;
DEALLOCATE PREPARE migration_statement;

SET @statement = IF(
  (SELECT COUNT(*) FROM information_schema.statistics
   WHERE table_schema = DATABASE() AND table_name = 'tasks' AND index_name = 'idx_tasks_reminders') = 0,
  'CREATE INDEX idx_tasks_reminders ON tasks (completed, deadline_reminder_sent, due_date)',
  'SELECT 1'
);
PREPARE migration_statement FROM @statement;
EXECUTE migration_statement;
DEALLOCATE PREPARE migration_statement;

SET @statement = IF(
  (SELECT COUNT(*) FROM information_schema.statistics
   WHERE table_schema = DATABASE() AND table_name = 'email_notifications' AND index_name = 'idx_notifications_recipient') = 0,
  'CREATE INDEX idx_notifications_recipient ON email_notifications (recipient_id, sent_at)',
  'SELECT 1'
);
PREPARE migration_statement FROM @statement;
EXECUTE migration_statement;
DEALLOCATE PREPARE migration_statement;
