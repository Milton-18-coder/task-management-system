# TaskPulse

TaskPulse is a responsive task-management workspace built with React 19, Vite, Express, and MySQL. It separates private personal to-dos from administrator-assigned work, with list and Kanban views, real-time dashboard metrics, assignment emails, and scheduled deadline reminders.

## What is included

- JWT authentication with bcrypt password hashing and session restoration
- MySQL-backed task creation, editing, status changes, reassignment, and deletion
- Admin-only assignment controls and a private personal to-do space for every account
- Dashboard totals, completion progress, deadline attention, priority distribution, and recent activity
- Combined search, status, priority, due-date filters, and sorting
- Synchronized list and Kanban views with persisted status changes
- CSV export, JSON backup, and validated task import
- Light and dark themes with a mobile navigation drawer
- Nodemailer assignment notifications with a clearly labeled simulation mode when SMTP is absent
- Asia/Kolkata deadline scheduling with duplicate-run locking and retry-safe delivery tracking

## Prerequisites

- Node.js `20.19+` or `22.12+`
- npm
- MySQL 8.x (MySQL Workbench is optional but convenient on Windows)

## Windows setup

1. Install dependencies from PowerShell:

   ```powershell
   npm.cmd ci
   npm.cmd --prefix server ci
   ```

2. Create your local environment file without modifying the example:

   ```powershell
   Copy-Item .env.example .env
   ```

3. Generate a strong JWT secret:

   ```powershell
   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   ```

   Copy the output into `JWT_SECRET` in `.env`. TaskPulse refuses to start with a missing, placeholder, or short secret.

4. Set the MySQL values in `.env`:

   ```dotenv
   DB_HOST=localhost
   DB_PORT=3306
   DB_USER=root
   DB_PASSWORD=your_local_mysql_password
   DB_NAME=task_management_db
   ADMIN_EMAIL=muralisubbu11@gmail.com
   ```

5. Start both applications:

   ```powershell
   npm.cmd run dev:all
   ```

   Open `http://localhost:5173`. The API listens on `http://localhost:5000`, and Vite proxies `/api` requests to it.

To run them separately, use `npm.cmd run dev` in one terminal and `npm.cmd run server:dev` in another.

## Database setup and upgrades

On startup, the backend creates the configured database and missing tables, then applies data-preserving column and index upgrades. The configured MySQL user therefore needs permission to create/alter `DB_NAME`.

If your database account cannot create schemas, create the database manually and run [server/schema.sql](server/schema.sql) in MySQL Workbench. Existing installations can apply the SQL files in [server/migrations](server/migrations) in filename order. Neither path asks you to drop existing data.

The health endpoint is:

```text
GET http://localhost:5000/api/health
```

It returns HTTP `200` when MySQL is reachable and HTTP `503` when the API is running but the database is unavailable.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `JWT_SECRET` | Yes | Random JWT signing secret, at least 32 characters |
| `JWT_EXPIRES_IN` | No | Token lifetime; defaults to `7d` |
| `PORT` | No | API port; defaults to `5000` |
| `CLIENT_ORIGIN` | No | Comma-separated allowed browser origins; defaults to `http://localhost:5173` |
| `ADMIN_EMAIL` | No | Sole account allowed to assign work; defaults to `muralisubbu11@gmail.com` |
| `DB_HOST`, `DB_PORT` | No | MySQL host and port |
| `DB_USER`, `DB_PASSWORD` | Yes for your MySQL setup | MySQL credentials |
| `DB_NAME` | No | Database name; defaults to `task_management_db` |
| `VITE_API_URL` | No | Frontend API base; keep `/api` with the Vite proxy |
| `SMTP_HOST`, `SMTP_PORT` | No | SMTP server and port |
| `SMTP_USER`, `SMTP_PASS` | No | SMTP credentials |
| `SMTP_FROM` | No | Sender name and address |
| `SMTP_SECURE` | No | Use TLS from connection start; normally `true` for port 465 |
| `SMTP_TLS_REJECT_UNAUTHORIZED` | No | Keep `true` outside a controlled local test environment |
| `TASK_REMINDER_HOUR`, `TASK_REMINDER_MINUTE` | No | Daily reminder time |
| `TASK_TIMEZONE` | No | Scheduler timezone; defaults to `Asia/Kolkata` |
| `TASK_REMINDER_TEST_MODE` | No | Forces reminder eligibility checks; keep `false` normally |
| `ENABLE_DEV_TOOLS` | No | Enables manual reminder endpoints in non-production only |

## Email and reminders

For Gmail, use an app password rather than your normal account password:

```dotenv
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=you@gmail.com
SMTP_PASS=your_app_password
SMTP_FROM="TaskPulse" <you@gmail.com>
SMTP_SECURE=false
SMTP_TLS_REJECT_UNAUTHORIZED=true
```

When complete SMTP credentials are absent, TaskPulse uses Nodemailer's JSON transport. The UI and notification log report those messages as `SIMULATED`; they are not marked as delivered reminders. Failed real deliveries remain eligible for a later scheduler retry.

Manual reminder endpoints are hidden unless `ENABLE_DEV_TOOLS=true` and `NODE_ENV` is not `production`. They remain scoped to tasks the signed-in user can access.

## Permission model

- The account matching `ADMIN_EMAIL` is promoted to the sole administrator during server startup.
- Only the administrator can view the user directory and create, edit, reassign, or delete assigned work.
- An assignee can view administrator-assigned work and update its workflow status, but cannot change details, ownership, or assignment.
- Every account, including the administrator, has a separate personal to-do list. Personal tasks are visible and manageable only by their owner.
- Assigned work and personal to-dos are separated in the dashboard, exports, imports, bulk deletion, notifications, and API authorization.

## Verification commands

Run the complete local verification suite:

```powershell
npm.cmd run verify
```

This runs ESLint, a Vite production build, and no-send reminder/date tests. The reminder test reports the active email mode but never sends an email.

For dependency checks:

```powershell
npm.cmd audit --omit=dev
npm.cmd --prefix server audit --omit=dev
```

## Troubleshooting

- **`npm.ps1 cannot be loaded`**: use `npm.cmd` in PowerShell, as shown above.
- **Server refuses to start**: replace the placeholder `JWT_SECRET` with a random value of at least 32 characters.
- **Health endpoint returns 503**: start MySQL and verify `DB_HOST`, `DB_PORT`, credentials, and database permissions.
- **CORS error**: set `CLIENT_ORIGIN` to the exact frontend origin. Multiple origins are comma-separated.
- **Email says simulated**: configure all of `SMTP_HOST`, `SMTP_USER`, and `SMTP_PASS`, then restart the backend.
- **Port already in use**: stop the existing process or change `PORT`; update the Vite proxy or `VITE_API_URL` when changing the API location.
- **Tasks disappear after an API failure**: TaskPulse intentionally does not substitute browser storage for MySQL. Restore the server/database connection and refresh.
