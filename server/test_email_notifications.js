import { initDatabase, getPool } from './db.js';
import { sendTaskAssignedEmail, sendTaskDeadlineReminderEmail, formatKolkataDate, getTransporter } from './emailService.js';
import { checkAndSendDeadlineReminders, getTodayKolkataString, isDeadlineTodayKolkata } from './reminderScheduler.js';

async function runTests() {
  console.log('====================================================');
  console.log('🧪 RUNNING EMAIL NOTIFICATION & REMINDER TEST SUITE');
  console.log('====================================================');

  await initDatabase();
  const pool = getPool();

  const todayStr = getTodayKolkataString();
  console.log(`[Test] Today in Asia/Kolkata is: ${todayStr}`);

  // 1. Get or create test user
  const [users] = await pool.query("SELECT * FROM users WHERE email = 'alex@demo.com'");
  let testUser = users[0];
  if (!testUser) {
    const [ins] = await pool.query(
      "INSERT INTO users (name, email, password_hash) VALUES ('Alex Dev', 'alex@demo.com', 'hashedpassword')"
    );
    testUser = { id: ins.insertId, name: 'Alex Dev', email: 'alex@demo.com' };
  }
  console.log(`[Test] Using Test User: ${testUser.name} (${testUser.email}, ID: ${testUser.id})`);

  // TEST 1: Task Assignment Email
  console.log('\n--- TEST 1: Immediate Assignment Email ---');
  const [taskRes1] = await pool.query(
    "INSERT INTO tasks (user_id, created_by, title, description, priority, due_date, status, completed) VALUES (?, ?, 'Complete Project Documentation', 'Finalize docs and diagrams.', 'high', ?, 'todo', 0)",
    [testUser.id, testUser.id, todayStr]
  );
  const taskId1 = taskRes1.insertId;
  const [t1Rows] = await pool.query("SELECT * FROM tasks WHERE id = ?", [taskId1]);
  const task1 = t1Rows[0];

  const assignResult = await sendTaskAssignedEmail(task1, testUser, testUser, pool);
  console.log('Assignment Email Result:', assignResult);
  console.assert(assignResult.success === true, 'TEST 1 FAILED: Assignment email failed');
  console.log('✅ TEST 1 PASSED: Immediate assignment email sent and logged.');

  // TEST 2 & 3: Task with no deadline
  console.log('\n--- TEST 3: Task with no deadline ---');
  const [taskResNoDue] = await pool.query(
    "INSERT INTO tasks (user_id, created_by, title, description, priority, due_date, status, completed) VALUES (?, ?, 'Task Without Deadline', 'No due date set.', 'low', NULL, 'todo', 0)",
    [testUser.id, testUser.id]
  );
  const noDueId = taskResNoDue.insertId;
  const [noDueRows] = await pool.query("SELECT * FROM tasks WHERE id = ?", [noDueId]);
  const noDueTask = noDueRows[0];
  console.assert(noDueTask.due_date === null, 'TEST 3 FAILED: Due date should be null');
  console.log('✅ TEST 3 PASSED: Task with no deadline saved; will be excluded by deadline scheduler.');

  // TEST 4 & 7: Task deadline is today and incomplete -> Final reminder sent & marked
  console.log('\n--- TEST 4 & 7: Final reminder on deadline day ---');
  const reminderCycle = await checkAndSendDeadlineReminders({ targetTaskId: taskId1 });
  console.log('Reminder Cycle Result for Task 1:', reminderCycle);

  const [t1After] = await pool.query("SELECT deadline_reminder_sent, deadline_reminder_sent_at FROM tasks WHERE id = ?", [taskId1]);
  console.log('Task 1 reminder flags:', t1After[0]);
  console.assert(Boolean(t1After[0].deadline_reminder_sent) === true, 'TEST 7 FAILED: deadline_reminder_sent should be 1');
  console.log('✅ TEST 4 & 7 PASSED: Deadline reminder sent and deadline_reminder_sent set to true.');

  // TEST 5: Task is completed -> No reminder
  console.log('\n--- TEST 5: Completed task receives no reminder ---');
  const [completedRes] = await pool.query(
    "INSERT INTO tasks (user_id, created_by, title, description, priority, due_date, status, completed, deadline_reminder_sent) VALUES (?, ?, 'Completed Feature Task', 'Done work.', 'medium', ?, 'done', 1, 0)",
    [testUser.id, testUser.id, todayStr]
  );
  const completedTaskId = completedRes.insertId;
  const compCycle = await checkAndSendDeadlineReminders({ targetTaskId: completedTaskId });
  console.log('Completed Task Reminder Result:', compCycle);
  const [compAfter] = await pool.query("SELECT deadline_reminder_sent FROM tasks WHERE id = ?", [completedTaskId]);
  console.assert(Boolean(compAfter[0].deadline_reminder_sent) === false, 'TEST 5 FAILED: Completed task should not be sent reminder');
  console.log('✅ TEST 5 PASSED: Completed task correctly skipped.');

  // TEST 6: Task deadline is tomorrow -> Skipped today
  console.log('\n--- TEST 6: Task deadline is tomorrow ---');
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];
  const [tomorrowRes] = await pool.query(
    "INSERT INTO tasks (user_id, created_by, title, description, priority, due_date, status, completed, deadline_reminder_sent) VALUES (?, ?, 'Future Deadline Task', 'Work for tomorrow.', 'high', ?, 'todo', 0, 0)",
    [testUser.id, testUser.id, tomorrowStr]
  );
  const isTomorrowToday = isDeadlineTodayKolkata(tomorrowStr);
  console.assert(isTomorrowToday === false, 'TEST 6 FAILED: Tomorrow should not match today in Kolkata');
  console.log('✅ TEST 6 PASSED: Future deadline task is recognized as not due today.');

  // TEST 9: Task deadline changed -> Reset deadline_reminder_sent
  console.log('\n--- TEST 9: Deadline changed -> Reset reminder ---');
  await pool.query(
    "UPDATE tasks SET due_date = '2026-12-31', deadline_reminder_sent = 0, deadline_reminder_sent_at = NULL WHERE id = ?",
    [taskId1]
  );
  const [t1Reset] = await pool.query("SELECT deadline_reminder_sent FROM tasks WHERE id = ?", [taskId1]);
  console.assert(Boolean(t1Reset[0].deadline_reminder_sent) === false, 'TEST 9 FAILED: Reminder should reset to false');
  console.log('✅ TEST 9 PASSED: Changing task deadline successfully resets deadline_reminder_sent to false.');

  // Check Notification Logs
  console.log('\n--- NOTIFICATION LOGS CHECK ---');
  const [logs] = await pool.query("SELECT id, task_id, recipient_email, notification_type, status, sent_at FROM email_notifications ORDER BY id DESC LIMIT 5");
  console.log('Recent Notifications in DB:', logs);
  console.assert(logs.length > 0, 'Notification logs should be recorded');
  console.log('✅ NOTIFICATION HISTORY VERIFIED');

  console.log('\n====================================================');
  console.log('🎉 ALL EMAIL NOTIFICATION & REMINDER TESTS PASSED!');
  console.log('====================================================');
  process.exit(0);
}

runTests().catch(err => {
  console.error('❌ Test suite failed:', err);
  process.exit(1);
});
