-- Separates private personal to-dos from work assigned by the TaskPulse admin.
-- The server applies the same migration automatically during startup.

USE task_management_db;

SET @statement = IF(
  (SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'role') = 0,
  "ALTER TABLE users ADD COLUMN role ENUM('admin', 'user') NOT NULL DEFAULT 'user' AFTER password_hash",
  'SELECT 1'
);
PREPARE migration_statement FROM @statement;
EXECUTE migration_statement;
DEALLOCATE PREPARE migration_statement;

SET @statement = IF(
  (SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema = DATABASE() AND table_name = 'tasks' AND column_name = 'task_type') = 0,
  "ALTER TABLE tasks ADD COLUMN task_type ENUM('personal', 'assigned') NOT NULL DEFAULT 'personal' AFTER created_by",
  'SELECT 1'
);
PREPARE migration_statement FROM @statement;
EXECUTE migration_statement;
DEALLOCATE PREPARE migration_statement;

UPDATE users
SET role = IF(LOWER(email) = 'muralisubbu11@gmail.com', 'admin', 'user');

UPDATE tasks t
JOIN users c ON t.created_by = c.id
SET t.task_type = 'assigned'
WHERE t.task_type = 'personal'
  AND LOWER(c.email) = 'muralisubbu11@gmail.com'
  AND t.user_id <> t.created_by;

SET @statement = IF(
  (SELECT COUNT(*) FROM information_schema.statistics
   WHERE table_schema = DATABASE() AND table_name = 'tasks' AND index_name = 'idx_tasks_type_assignee') = 0,
  'CREATE INDEX idx_tasks_type_assignee ON tasks (task_type, user_id)',
  'SELECT 1'
);
PREPARE migration_statement FROM @statement;
EXECUTE migration_statement;
DEALLOCATE PREPARE migration_statement;
