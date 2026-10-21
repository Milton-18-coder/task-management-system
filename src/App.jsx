import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { authApi, authStorage, taskApi, userApi } from "./api";
import Auth from "./Auth";
import "./App.css";

const PRIORITY_CONFIG = {
  urgent: { label: "Urgent", color: "#dc2626", bg: "#fef2f2", order: 4 },
  high: { label: "High", color: "#ea580c", bg: "#fff7ed", order: 3 },
  medium: { label: "Medium", color: "#a16207", bg: "#fefce8", order: 2 },
  low: { label: "Low", color: "#2563eb", bg: "#eff6ff", order: 1 },
};

const KANBAN_COLUMNS = [
  { id: "todo", title: "To Do", color: "#6366f1" },
  { id: "in_progress", title: "In Progress", color: "#f59e0b" },
  { id: "done", title: "Done", color: "#10b981" },
];

function Icon({ name, size = 18 }) {
  const paths = {
    check: <path d="m5 12 4 4L19 6" />,
    grid: <><rect x="3" y="3" width="7" height="7" rx="2" /><rect x="14" y="3" width="7" height="7" rx="2" /><rect x="3" y="14" width="7" height="7" rx="2" /><rect x="14" y="14" width="7" height="7" rx="2" /></>,
    circle: <circle cx="12" cy="12" r="8" />,
    progress: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    alert: <><path d="M10.3 3.6 2.4 18a2 2 0 0 0 1.8 3h15.6a2 2 0 0 0 1.8-3L13.7 3.6a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4M12 17h.01" /></>,
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
    moon: <path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5 8.5 8.5 0 1 0 20.5 14.2Z" />,
    plus: <path d="M12 5v14M5 12h14" />,
    menu: <path d="M4 7h16M4 12h16M4 17h16" />,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    list: <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />,
    board: <><rect x="3" y="4" width="7" height="16" rx="2" /><rect x="14" y="4" width="7" height="10" rx="2" /></>,
    edit: <><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" /></>,
    trash: <><path d="M3 6h18M8 6V4h8v2M19 6l-1 15H6L5 6M10 11v5M14 11v5" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></>,
    user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M10 21h4" /></>,
    logout: <><path d="M10 17l5-5-5-5M15 12H3" /><path d="M15 3h5v18h-5" /></>,
    download: <><path d="M12 3v12M7 10l5 5 5-5" /><path d="M5 21h14" /></>,
    upload: <><path d="M12 15V3M7 8l5-5 5 5" /><path d="M5 21h14" /></>,
    refresh: <><path d="M20 7h-5V2" /><path d="M20 7a9 9 0 1 0 1 8" /></>,
    briefcase: <><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18M10 12v2h4v-2" /></>,
    personal: <><path d="M12 3 4 7v5c0 5 3.4 8 8 9 4.6-1 8-4 8-9V7Z" /><path d="m9 12 2 2 4-4" /></>,
  };
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name] || paths.circle}
    </svg>
  );
}

function dateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeDateKey(value) {
  if (!value) return null;
  const match = String(value).match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] || null;
}

function formatDate(value) {
  const key = normalizeDateKey(value);
  if (!key) return "No deadline";
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    ...(year !== new Date().getFullYear() ? { year: "numeric" } : {}),
  });
}

function getDueDateStatus(dueDate, completed) {
  const dueKey = normalizeDateKey(dueDate);
  if (!dueKey) return null;
  const todayKey = dateKey();
  if (completed) return { label: formatDate(dueKey), state: "completed" };
  if (dueKey < todayKey) return { label: `${formatDate(dueKey)} - overdue`, state: "overdue" };
  if (dueKey === todayKey) return { label: "Due today", state: "today" };
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (dueKey === dateKey(tomorrow)) return { label: "Due tomorrow", state: "tomorrow" };
  return { label: formatDate(dueKey), state: "upcoming" };
}

function taskTimestamp(task) {
  return new Date(task.updated_at || task.created_at || 0).getTime() || 0;
}

function App() {
  const tokenAtLoad = authStorage.getToken();
  const [currentUser, setCurrentUser] = useState(() => tokenAtLoad ? authStorage.getUser() : null);
  const [sessionChecking, setSessionChecking] = useState(Boolean(tokenAtLoad));
  const [authMessage, setAuthMessage] = useState("");
  const [tasks, setTasks] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(Boolean(tokenAtLoad));
  const [workspaceError, setWorkspaceError] = useState("");
  const [dbStatus, setDbStatus] = useState({ connected: false, message: "Checking connection", emailMode: "simulated", devToolsEnabled: false });
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

  const [theme, setTheme] = useState(() => localStorage.getItem("taskpulse_theme") || localStorage.getItem("taskflow_theme") || "light");
  const [viewMode, setViewMode] = useState(() => localStorage.getItem("taskpulse_view") || localStorage.getItem("taskflow_view") || "list");
  const [taskSection, setTaskSection] = useState(() => localStorage.getItem("taskpulse_section") || localStorage.getItem("taskflow_section") || "assigned");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [dueFilter, setDueFilter] = useState("all");
  const [sortBy, setSortBy] = useState("updated");
  const [search, setSearch] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [editTask, setEditTask] = useState(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("medium");
  const [status, setStatus] = useState("todo");
  const [dueDate, setDueDate] = useState("");
  const [assignedUserId, setAssignedUserId] = useState("");
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [taskActionId, setTaskActionId] = useState(null);
  const [draggedTask, setDraggedTask] = useState(null);
  const [confirmation, setConfirmation] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef(null);

  const showToast = useCallback((message, type = "info") => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setToast({ message, type });
    toastTimer.current = window.setTimeout(() => setToast(null), 4500);
  }, []);

  const checkHealthStatus = useCallback(async () => {
    const health = await taskApi.checkHealth();
    const connected = health.status === "ok";
    setDbStatus({
      connected,
      message: health.message || (connected ? "Database connected" : "Server unavailable"),
      emailMode: health.emailMode || "simulated",
      devToolsEnabled: Boolean(health.devToolsEnabled),
    });
    return connected;
  }, []);

  const loadWorkspace = useCallback(async ({ showSpinner = false } = {}) => {
    if (!currentUser || !authStorage.getToken()) return;
    if (showSpinner) setLoading(true);
    setWorkspaceError("");
    try {
      const [fetchedTasks, fetchedUsers] = await Promise.all([
        taskApi.getTasks(),
        currentUser.role === "admin" ? userApi.getUsers() : Promise.resolve([currentUser]),
      ]);
      setTasks(fetchedTasks);
      setUsers(fetchedUsers);
      setDbStatus((previous) => ({ ...previous, connected: true, message: "Database connected" }));
    } catch (error) {
      if (error.status !== 401 && error.status !== 403) setWorkspaceError(error.message);
    } finally {
      if (showSpinner) setLoading(false);
    }
  }, [currentUser]);

  useEffect(() => {
    let active = true;
    async function initialize() {
      const health = await taskApi.checkHealth();
      if (!active) return;
      setDbStatus({
        connected: health.status === "ok",
        message: health.message || "Server unavailable",
        emailMode: health.emailMode || "simulated",
        devToolsEnabled: Boolean(health.devToolsEnabled),
      });

      const token = authStorage.getToken();
      if (!token) {
        setSessionChecking(false);
        return;
      }
      try {
        const response = await authApi.getMe();
        if (!active) return;
        authStorage.setUser(response.user);
        setCurrentUser(response.user);
      } catch {
        if (!active) return;
        authStorage.clearAuth();
        setCurrentUser(null);
        setAuthMessage("Your session expired. Please sign in again.");
      } finally {
        if (active) setSessionChecking(false);
      }
    }
    void initialize();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    async function refresh() {
      await Promise.resolve();
      if (active) await loadWorkspace({ showSpinner: true });
    }
    if (currentUser && !sessionChecking) void refresh();
    else if (!currentUser && !sessionChecking) {
      queueMicrotask(() => {
        if (active) {
          setTasks([]);
          setUsers([]);
          setLoading(false);
        }
      });
    }
    return () => { active = false; };
  }, [currentUser, loadWorkspace, sessionChecking]);

  useEffect(() => {
    if (!currentUser) return undefined;
    const interval = window.setInterval(() => {
      void checkHealthStatus().then((online) => {
        if (online) void loadWorkspace();
      });
    }, 30000);
    return () => window.clearInterval(interval);
  }, [checkHealthStatus, currentUser, loadWorkspace]);

  useEffect(() => {
    function expireSession() {
      setCurrentUser(null);
      setAuthMessage("Your session expired. Please sign in again.");
    }
    window.addEventListener("taskpulse:auth-expired", expireSession);
    window.addEventListener("taskflow:auth-expired", expireSession);
    return () => {
      window.removeEventListener("taskpulse:auth-expired", expireSession);
      window.removeEventListener("taskflow:auth-expired", expireSession);
    };
  }, []);

  useEffect(() => () => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
  }, []);

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key !== "Escape") return;
      if (confirmation) setConfirmation(null);
      else if (showForm && !saving) setShowForm(false);
      else setMobileNavOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [confirmation, saving, showForm]);

  const isAdmin = currentUser?.role === "admin";
  const assignedTasks = useMemo(() => tasks.filter((task) => task.task_type === "assigned"), [tasks]);
  const personalTasks = useMemo(() => tasks.filter((task) => task.task_type !== "assigned"), [tasks]);
  const sectionTasks = taskSection === "assigned" ? assignedTasks : personalTasks;
  const canCreateInSection = taskSection === "personal" || isAdmin;

  const analytics = useMemo(() => {
    const today = dateKey();
    const active = sectionTasks.filter((task) => !(task.completed || task.status === "done"));
    const todo = sectionTasks.filter((task) => !(task.completed || task.status === "done") && task.status !== "in_progress");
    const inProgress = sectionTasks.filter((task) => !task.completed && task.status === "in_progress");
    const completed = sectionTasks.filter((task) => task.completed || task.status === "done");
    const overdue = active.filter((task) => normalizeDateKey(task.due_date) && normalizeDateKey(task.due_date) < today);
    const dueToday = active.filter((task) => normalizeDateKey(task.due_date) === today);
    const upcoming = active
      .filter((task) => normalizeDateKey(task.due_date) > today)
      .sort((a, b) => normalizeDateKey(a.due_date).localeCompare(normalizeDateKey(b.due_date)));
    const recent = [...sectionTasks].sort((a, b) => taskTimestamp(b) - taskTimestamp(a)).slice(0, 4);
    const priorityCounts = Object.fromEntries(Object.keys(PRIORITY_CONFIG).map((key) => [key, sectionTasks.filter((task) => (task.priority || "medium") === key).length]));
    return {
      todo,
      inProgress,
      completed,
      overdue,
      dueToday,
      upcoming,
      recent,
      priorityCounts,
      completionRate: sectionTasks.length ? Math.round((completed.length / sectionTasks.length) * 100) : 0,
    };
  }, [sectionTasks]);

  const filteredTasks = useMemo(() => {
    const query = search.trim().toLowerCase();
    const today = dateKey();
    return sectionTasks
      .filter((task) => {
        const done = task.completed || task.status === "done";
        const due = normalizeDateKey(task.due_date);
        const matchesSearch = !query || [task.title, task.description, task.assignee_name, task.creator_name]
          .some((value) => String(value || "").toLowerCase().includes(query));
        const matchesStatus = statusFilter === "all"
          || (statusFilter === "todo" && !done && task.status !== "in_progress")
          || (statusFilter === "in_progress" && !done && task.status === "in_progress")
          || (statusFilter === "done" && done)
          || (statusFilter === "overdue" && !done && due && due < today);
        const matchesPriority = priorityFilter === "all" || (task.priority || "medium") === priorityFilter;
        const matchesDue = dueFilter === "all"
          || (dueFilter === "today" && due === today)
          || (dueFilter === "upcoming" && due > today)
          || (dueFilter === "no_date" && !due);
        return matchesSearch && matchesStatus && matchesPriority && matchesDue;
      })
      .sort((a, b) => {
        if (sortBy === "priority") return (PRIORITY_CONFIG[b.priority || "medium"]?.order || 2) - (PRIORITY_CONFIG[a.priority || "medium"]?.order || 2);
        if (sortBy === "due") return (normalizeDateKey(a.due_date) || "9999-12-31").localeCompare(normalizeDateKey(b.due_date) || "9999-12-31");
        if (sortBy === "title") return String(a.title).localeCompare(String(b.title));
        if (sortBy === "created") return new Date(b.created_at || 0) - new Date(a.created_at || 0);
        return taskTimestamp(b) - taskTimestamp(a);
      });
  }, [dueFilter, priorityFilter, search, sortBy, statusFilter, sectionTasks]);

  const resetForm = useCallback(() => {
    setEditTask(null);
    setTitle("");
    setDescription("");
    setPriority("medium");
    setStatus("todo");
    setDueDate("");
    setAssignedUserId(currentUser ? String(currentUser.id) : "");
    setFormError("");
    setShowForm(false);
  }, [currentUser]);

  function openCreate(initialStatus = "todo") {
    if (!canCreateInSection) return;
    resetForm();
    setStatus(initialStatus);
    setAssignedUserId(String(currentUser.id));
    setShowForm(true);
  }

  function openEdit(task) {
    if (!task.can_manage) return;
    setEditTask(task);
    setTitle(task.title || "");
    setDescription(task.description || "");
    setPriority(task.priority || "medium");
    setStatus(task.status || (task.completed ? "done" : "todo"));
    setDueDate(normalizeDateKey(task.due_date) || "");
    setAssignedUserId(String(task.user_id || currentUser.id));
    setFormError("");
    setShowForm(true);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!title.trim()) {
      setFormError("Enter a task title.");
      return;
    }
    setSaving(true);
    setFormError("");
    const payload = {
      title: title.trim(),
      description: description.trim(),
      priority,
      status,
      due_date: dueDate || null,
      task_type: editTask?.task_type || taskSection,
      user_id: taskSection === "assigned" ? Number(assignedUserId || currentUser.id) : currentUser.id,
    };
    try {
      if (editTask) {
        const updated = await taskApi.updateTask(editTask.id, payload);
        setTasks((previous) => previous.map((task) => task.id === updated.id ? updated : task));
        showToast(updated.emailNotification?.simulated ? "Task updated. Assignment email was simulated." : "Task updated.", "success");
      } else {
        const created = await taskApi.createTask(payload);
        setTasks((previous) => [created, ...previous]);
        if (created.emailNotification?.status === "sent") showToast("Task created and assignment email sent.", "success");
        else if (created.emailNotification?.status === "simulated") showToast("Task created. Email was simulated because SMTP is not configured.", "info");
        else if (created.emailNotification?.status === "failed") showToast("Task created, but email delivery failed.", "warning");
        else showToast("Task created.", "success");
      }
      resetForm();
    } catch (error) {
      setFormError(error.message);
    } finally {
      setSaving(false);
    }
  }

  async function updateStatus(task, nextStatus) {
    if (!task.can_update_status || taskActionId) return;
    setTaskActionId(task.id);
    try {
      const updated = await taskApi.updateTask(task.id, { status: nextStatus, completed: nextStatus === "done" });
      setTasks((previous) => previous.map((item) => item.id === task.id ? updated : item));
      showToast(nextStatus === "done" ? "Task completed." : "Task status updated.", "success");
    } catch (error) {
      showToast(error.message, "error");
    } finally {
      setTaskActionId(null);
    }
  }

  async function sendTestReminder(event, task) {
    event.stopPropagation();
    setTaskActionId(task.id);
    try {
      const result = await taskApi.sendTestReminder(task.id);
      showToast(result.message, result.simulated ? "info" : result.success ? "success" : "error");
    } catch (error) {
      showToast(error.message, "error");
    } finally {
      setTaskActionId(null);
    }
  }

  async function runConfirmedAction() {
    if (!confirmation) return;
    setConfirming(true);
    try {
      if (confirmation.type === "delete") {
        await taskApi.deleteTask(confirmation.task.id);
        setTasks((previous) => previous.filter((task) => task.id !== confirmation.task.id));
        showToast("Task deleted.", "success");
      } else {
        const result = await taskApi.clearAllTasks(taskSection);
        setTasks((previous) => previous.filter((task) => !(task.task_type === taskSection && task.can_manage)));
        showToast(`${result.deletedCount || 0} ${taskSection === "personal" ? "personal" : "assigned"} task${result.deletedCount === 1 ? "" : "s"} deleted.`, "success");
      }
      setConfirmation(null);
    } catch (error) {
      showToast(error.message, "error");
    } finally {
      setConfirming(false);
    }
  }

  function handleLogout() {
    authStorage.clearAuth();
    setCurrentUser(null);
    setTasks([]);
    setUsers([]);
    setMobileNavOpen(false);
  }

  function switchView(nextView) {
    setViewMode(nextView);
    localStorage.setItem("taskpulse_view", nextView);
  }

  function toggleTheme() {
    const nextTheme = theme === "light" ? "dark" : "light";
    setTheme(nextTheme);
    localStorage.setItem("taskpulse_theme", nextTheme);
  }

  function selectStatusFilter(nextFilter) {
    setStatusFilter(nextFilter);
    setMobileNavOpen(false);
  }

  function selectTaskSection(nextSection) {
    setTaskSection(nextSection);
    localStorage.setItem("taskpulse_section", nextSection);
    resetFilters();
    setMobileNavOpen(false);
  }

  function resetFilters() {
    setStatusFilter("all");
    setPriorityFilter("all");
    setDueFilter("all");
    setSortBy("updated");
    setSearch("");
  }

  function downloadFile(contents, type, filename) {
    const url = URL.createObjectURL(new Blob([contents], { type }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function csvCell(value) {
    let text = String(value ?? "");
    if (/^[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  }

  function exportCsv() {
    if (!sectionTasks.length) return showToast("There are no tasks to export in this section.", "warning");
    const rows = sectionTasks.map((task) => [task.title, task.description, task.status, task.priority, normalizeDateKey(task.due_date) || "", task.assignee_name || ""]);
    const csv = [["Title", "Description", "Status", "Priority", "Due Date", "Assignee"], ...rows]
      .map((row) => row.map(csvCell).join(","))
      .join("\r\n");
    downloadFile(csv, "text/csv;charset=utf-8", `taskpulse-${dateKey()}.csv`);
  }

  function exportJson() {
    if (!sectionTasks.length) return showToast("There are no tasks to export in this section.", "warning");
    const backup = sectionTasks.map(({ title: taskTitle, description: taskDescription, status: taskStatus, priority: taskPriority, due_date, user_id, task_type }) => ({
      title: taskTitle,
      description: taskDescription,
      status: taskStatus,
      priority: taskPriority,
      due_date: normalizeDateKey(due_date),
      user_id,
      task_type,
    }));
    downloadFile(JSON.stringify(backup, null, 2), "application/json", `taskpulse-backup-${dateKey()}.json`);
  }

  async function importTasks(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!canCreateInSection) {
      showToast("Only the admin can import assigned work.", "error");
      event.target.value = "";
      return;
    }
    setImporting(true);
    try {
      const content = await file.text();
      let imported = [];
      if (file.name.toLowerCase().endsWith(".json")) imported = JSON.parse(content);
      else {
        const lines = content.split(/\r?\n/).filter(Boolean);
        imported = lines.slice(1).map((line) => {
          const fields = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map((value) => value.replace(/^"|"$/g, "").replaceAll('""', '"'));
          return { title: fields[0], description: fields[1], status: fields[2], priority: fields[3], due_date: fields[4] || null };
        });
      }
      if (!Array.isArray(imported) || !imported.length) throw new Error("No tasks were found in this file.");
      if (imported.length > 200) throw new Error("A maximum of 200 tasks can be imported at once.");

      let createdCount = 0;
      for (const item of imported) {
        if (!item?.title) continue;
        await taskApi.createTask({
          title: String(item.title).slice(0, 255),
          description: String(item.description || "").slice(0, 5000),
          status: ["todo", "in_progress", "done"].includes(item.status) ? item.status : "todo",
          priority: Object.hasOwn(PRIORITY_CONFIG, item.priority) ? item.priority : "medium",
          due_date: normalizeDateKey(item.due_date),
          task_type: taskSection,
          user_id: taskSection === "assigned" ? (parseInt(item.user_id, 10) || currentUser.id) : currentUser.id,
        });
        createdCount += 1;
      }
      await loadWorkspace();
      showToast(`${createdCount} task${createdCount === 1 ? "" : "s"} imported.`, "success");
    } catch (error) {
      showToast(error.message || "The selected file could not be imported.", "error");
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  if (sessionChecking) {
    return <div className="startup-screen"><div className="brand-mark"><Icon name="check" size={24} /></div><p>Restoring your TaskPulse workspace...</p></div>;
  }

  if (!currentUser) {
    return <div className="auth-shell" data-theme={theme}><Auth onAuthSuccess={(user) => { setAuthMessage(""); setCurrentUser(user); }} dbStatus={dbStatus} sessionMessage={authMessage} /></div>;
  }

  const userInitials = (currentUser.name || currentUser.email || "U").split(/\s+/).map((part) => part[0]).join("").toUpperCase().slice(0, 2);
  const hasActiveFilters = statusFilter !== "all" || priorityFilter !== "all" || dueFilter !== "all" || search;
  const managedTaskCount = sectionTasks.filter((task) => task.can_manage).length;
  const formTaskType = editTask?.task_type || taskSection;
  const sectionName = taskSection === "assigned" ? "Assigned work" : "Personal to-dos";
  const sectionDescription = taskSection === "assigned"
    ? (isAdmin ? "Assign work, monitor progress, and manage team deadlines." : "Complete the work assigned to you by the administrator.")
    : "Your private task list is visible only to you.";

  return (
    <div className="app" data-theme={theme}>
      <input ref={fileInputRef} type="file" accept=".json,.csv" hidden onChange={importTasks} />
      {mobileNavOpen && <button className="sidebar-backdrop" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)} />}

      <aside className={`sidebar ${mobileNavOpen ? "mobile-open" : ""}`}>
        <div className="logo">
          <div className="logo-icon"><Icon name="check" size={22} /></div>
          <div><h2>TaskPulse</h2><span>Focused work, clearly organized</span></div>
          <button className="mobile-sidebar-close" onClick={() => setMobileNavOpen(false)} aria-label="Close navigation"><Icon name="close" /></button>
        </div>

        <button className={`connection-pill ${dbStatus.connected ? "online" : "offline"}`} onClick={() => void checkHealthStatus()} title="Refresh server connection">
          <span className="connection-dot" />
          <span><strong>{dbStatus.connected ? "System online" : "Connection issue"}</strong><small>{dbStatus.connected ? `${dbStatus.emailMode === "smtp" ? "Email delivery active" : "Email simulation mode"}` : "Click to retry"}</small></span>
          <Icon name="refresh" size={15} />
        </button>

        <span className="sidebar-kicker">Spaces</span>
        <nav aria-label="Task spaces">
          <button className={`nav-item ${taskSection === "assigned" ? "active" : ""}`} onClick={() => selectTaskSection("assigned")}>
            <Icon name="briefcase" size={18} /><span>Assigned work</span><b>{assignedTasks.length}</b>
          </button>
          <button className={`nav-item ${taskSection === "personal" ? "active" : ""}`} onClick={() => selectTaskSection("personal")}>
            <Icon name="personal" size={18} /><span>Personal to-dos</span><b>{personalTasks.length}</b>
          </button>
        </nav>

        <div className="sidebar-filter-section">
          <span className="sidebar-section-title">Status</span>
          <nav aria-label="Task filters">
          {[
            ["all", "grid", "All tasks", sectionTasks.length],
            ["todo", "circle", "To do", analytics.todo.length],
            ["in_progress", "progress", "In progress", analytics.inProgress.length],
            ["done", "check", "Completed", analytics.completed.length],
            ["overdue", "alert", "Overdue", analytics.overdue.length],
          ].map(([key, icon, label, count]) => (
            <button key={key} className={`nav-item ${statusFilter === key ? "active" : ""}`} onClick={() => selectStatusFilter(key)}>
              <Icon name={icon} size={18} /><span>{label}</span><b>{count}</b>
            </button>
          ))}
          </nav>
        </div>

        <div className="sidebar-filter-section">
          <span className="sidebar-section-title">Priority</span>
          <div className="priority-pills-wrap">
            {["all", "urgent", "high", "medium", "low"].map((key) => (
              <button key={key} className={`priority-chip ${priorityFilter === key ? "active" : ""}`} onClick={() => setPriorityFilter(key)}>
                {key === "all" ? "All" : PRIORITY_CONFIG[key].label}
              </button>
            ))}
          </div>
        </div>

        <div className="sidebar-filter-section sidebar-tools">
          <span className="sidebar-section-title">Data tools</span>
          <button className="tool-btn" onClick={exportCsv}><Icon name="download" size={15} /> Export CSV</button>
          <button className="tool-btn" onClick={exportJson}><Icon name="download" size={15} /> Backup JSON</button>
          {canCreateInSection && <button className="tool-btn" disabled={importing} onClick={() => fileInputRef.current?.click()}><Icon name="upload" size={15} /> {importing ? "Importing..." : "Import tasks"}</button>}
        </div>

        <div className="sidebar-bottom">
          <div className="productivity-box">
            <div><span>Completion</span><strong>{analytics.completionRate}%</strong></div>
            <div className="mini-progress"><div style={{ width: `${analytics.completionRate}%` }} /></div>
            <small>{analytics.completed.length} of {sectionTasks.length} tasks finished</small>
          </div>
          <div className="sidebar-user-card">
            <div className="user-avatar">{userInitials}</div>
            <div className="user-info"><div className="user-name">{currentUser.name}{isAdmin && <span className="role-badge">Admin</span>}</div><div className="user-email">{currentUser.email}</div></div>
            <button className="logout-icon-btn" onClick={handleLogout} aria-label="Sign out"><Icon name="logout" size={17} /></button>
          </div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="topbar-title-row">
            <button className="mobile-menu-btn" onClick={() => setMobileNavOpen(true)} aria-label="Open navigation"><Icon name="menu" /></button>
            <div><p className="welcome">Welcome back, {currentUser.name.split(" ")[0]}</p><h1>{sectionName}</h1><p className="page-description">{sectionDescription}</p></div>
          </div>
          <div className="top-actions">
            <label className="search-box"><Icon name="search" size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={taskSection === "assigned" ? "Search work or people" : "Search personal tasks"} aria-label="Search tasks" /></label>
            <button className="theme-toggle-btn" onClick={toggleTheme} aria-label={`Switch to ${theme === "light" ? "dark" : "light"} theme`}><Icon name={theme === "light" ? "moon" : "sun"} /><span>{theme === "light" ? "Dark" : "Light"}</span></button>
            {canCreateInSection && <button className="add-button" onClick={() => openCreate()}><Icon name="plus" size={17} /> {taskSection === "assigned" ? "Assign task" : "New to-do"}</button>}
          </div>
        </header>

        {workspaceError && <div className="workspace-alert" role="alert"><Icon name="alert" /><span>{workspaceError}</span><button onClick={() => void loadWorkspace({ showSpinner: true })}>Try again</button></div>}

        <section className="stats" aria-label="Task summary">
          {[
            ["Total", sectionTasks.length, "grid", "purple"],
            ["To do", analytics.todo.length, "circle", "blue"],
            ["In progress", analytics.inProgress.length, "progress", "orange"],
            ["Completed", analytics.completed.length, "check", "green"],
            ["Overdue", analytics.overdue.length, "alert", "red"],
          ].map(([label, value, icon, tone]) => (
            <button key={label} className={`stat-card ${label === "Overdue" && value ? "overdue-card" : ""}`} onClick={() => label === "Total" ? selectStatusFilter("all") : label === "To do" ? selectStatusFilter("todo") : label === "In progress" ? selectStatusFilter("in_progress") : label === "Completed" ? selectStatusFilter("done") : selectStatusFilter("overdue")}>
              <div className={`stat-icon ${tone}`}><Icon name={icon} /></div><div><span>{label}</span><strong>{value}</strong></div>
            </button>
          ))}
        </section>

        <section className="dashboard-grid">
          <article className="insight-card progress-card">
            <div className="insight-card-header"><div><span className="eyebrow">Progress</span><h2>{taskSection === "assigned" ? "Work completion" : "Personal completion"}</h2></div><strong>{analytics.completionRate}%</strong></div>
            <div className="progress-bar" role="progressbar" aria-valuenow={analytics.completionRate} aria-valuemin="0" aria-valuemax="100"><div style={{ width: `${analytics.completionRate}%` }} /></div>
            <p>{analytics.completed.length} complete, {analytics.todo.length + analytics.inProgress.length} still active.</p>
          </article>
          <article className="insight-card deadline-card">
            <div className="insight-card-header"><div><span className="eyebrow">Deadlines</span><h2>What needs attention</h2></div><Icon name="calendar" /></div>
            <div className="deadline-metrics"><button onClick={() => setDueFilter("today")}><strong>{analytics.dueToday.length}</strong><span>Due today</span></button><button onClick={() => selectStatusFilter("overdue")}><strong>{analytics.overdue.length}</strong><span>Overdue</span></button><button onClick={() => setDueFilter("upcoming")}><strong>{analytics.upcoming.length}</strong><span>Upcoming</span></button></div>
          </article>
          <article className="insight-card priority-card">
            <div className="insight-card-header"><div><span className="eyebrow">Workload</span><h2>Priority distribution</h2></div></div>
            <div className="priority-bars">
              {Object.entries(PRIORITY_CONFIG).map(([key, config]) => (
                <button key={key} onClick={() => setPriorityFilter(key)}><span>{config.label}</span><div><i style={{ width: `${sectionTasks.length ? Math.max(5, (analytics.priorityCounts[key] / sectionTasks.length) * 100) : 0}%`, background: config.color }} /></div><b>{analytics.priorityCounts[key]}</b></button>
              ))}
            </div>
          </article>
          <article className="insight-card recent-card">
            <div className="insight-card-header"><div><span className="eyebrow">Activity</span><h2>Recently updated</h2></div></div>
            <div className="recent-list">
              {analytics.recent.length ? analytics.recent.map((task) => <button key={task.id} onClick={() => task.can_manage && openEdit(task)}><span className={`recent-dot status-${task.status}`} /><span><strong>{task.title}</strong><small>{task.status === "in_progress" ? "In progress" : task.status === "done" ? "Completed" : "To do"}</small></span></button>) : <p>No activity yet.</p>}
            </div>
          </article>
        </section>

        <section className="workspace-section">
          <div className="task-heading">
            <div><span className="eyebrow">{sectionName}</span><h2>{statusFilter === "all" ? "All tasks" : statusFilter === "todo" ? "To do" : statusFilter === "in_progress" ? "In progress" : statusFilter === "done" ? "Completed" : "Overdue"}</h2><p>{filteredTasks.length} task{filteredTasks.length === 1 ? "" : "s"} in this private view</p></div>
            <div className="task-heading-actions">
              <div className="view-toggle" role="group" aria-label="Task view"><button className={viewMode === "list" ? "active" : ""} onClick={() => switchView("list")}><Icon name="list" size={16} /> List</button><button className={viewMode === "kanban" ? "active" : ""} onClick={() => switchView("kanban")}><Icon name="board" size={16} /> Board</button></div>
              {managedTaskCount > 0 && <button className="clear-button" onClick={() => setConfirmation({ type: "clear" })}>Clear managed tasks</button>}
            </div>
          </div>

          <div className="filter-toolbar">
            <label>Status<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">All statuses</option><option value="todo">To do</option><option value="in_progress">In progress</option><option value="done">Completed</option><option value="overdue">Overdue</option></select></label>
            <label>Due<select value={dueFilter} onChange={(event) => setDueFilter(event.target.value)}><option value="all">Any date</option><option value="today">Due today</option><option value="upcoming">Upcoming</option><option value="no_date">No deadline</option></select></label>
            <label>Sort<select value={sortBy} onChange={(event) => setSortBy(event.target.value)}><option value="updated">Recently updated</option><option value="created">Newest created</option><option value="due">Due date</option><option value="priority">Priority</option><option value="title">Title A-Z</option></select></label>
            {hasActiveFilters && <button className="reset-filter-btn" onClick={resetFilters}><Icon name="refresh" size={14} /> Reset filters</button>}
          </div>

          {loading ? <div className="loading-grid">{[1, 2, 3].map((item) => <div className="task-skeleton" key={item} />)}</div> : viewMode === "kanban" ? (
            <div className="kanban-board">
              {KANBAN_COLUMNS.map((column) => {
                const columnTasks = filteredTasks.filter((task) => (task.status || (task.completed ? "done" : "todo")) === column.id);
                return <section className="kanban-column" key={column.id} onDragOver={(event) => event.preventDefault()} onDrop={() => { if (draggedTask && draggedTask.status !== column.id) void updateStatus(draggedTask, column.id); setDraggedTask(null); }}>
                  <header className="kanban-column-header"><div className="kanban-header-title"><span className="column-color" style={{ background: column.color }} /><h3>{column.title}</h3></div><span className="kanban-column-count">{columnTasks.length}</span></header>
                  <div className="kanban-card-list">
                    {columnTasks.length ? columnTasks.map((task) => {
                      const priorityConfig = PRIORITY_CONFIG[task.priority || "medium"];
                      const due = getDueDateStatus(task.due_date, task.completed || task.status === "done");
                      return <article key={task.id} className={`kanban-card ${task.status === "done" ? "completed" : ""} ${due?.state === "overdue" ? "task-overdue-border" : ""}`} draggable={task.can_update_status} onDragStart={() => setDraggedTask(task)}>
                        <div className="kanban-card-top"><span className="priority-pill" style={{ color: priorityConfig.color, background: priorityConfig.bg }}><i style={{ background: priorityConfig.color }} />{priorityConfig.label}</span><div className="kanban-card-menu">{task.can_manage && <><button className="mini-action-btn" onClick={() => openEdit(task)} aria-label={`Edit ${task.title}`}><Icon name="edit" size={15} /></button><button className="mini-action-btn delete" onClick={() => setConfirmation({ type: "delete", task })} aria-label={`Delete ${task.title}`}><Icon name="trash" size={15} /></button></>}</div></div>
                        <h4>{task.title}</h4>{task.description && <p>{task.description}</p>}
                        <div className="task-meta">{due && <span className={`due-pill due-${due.state}`}><Icon name="calendar" size={13} />{due.label}</span>}{task.task_type === "assigned" ? <span className="assignee-tag"><Icon name="user" size={13} />{task.assignee_name || "Unassigned"}</span> : <span className="personal-tag"><Icon name="personal" size={13} /> Private</span>}</div>
                        <div className="kanban-card-footer"><small>{task.task_type === "personal" ? "Personal to-do" : task.can_manage ? "Assigned by you" : `From ${task.creator_name || "admin"}`}</small>{task.can_update_status && <select value={task.status} disabled={taskActionId === task.id} onChange={(event) => void updateStatus(task, event.target.value)} aria-label={`Update status for ${task.title}`}><option value="todo">To do</option><option value="in_progress">In progress</option><option value="done">Done</option></select>}</div>
                      </article>;
                    }) : <div className="kanban-empty-drop">No matching tasks</div>}
                  </div>
                  {canCreateInSection && <button className="kanban-add-column-btn" onClick={() => openCreate(column.id)}><Icon name="plus" size={15} /> {taskSection === "assigned" ? "Assign task" : "Add to-do"}</button>}
                </section>;
              })}
            </div>
          ) : filteredTasks.length ? (
            <div className="task-list">
              {filteredTasks.map((task) => {
                const done = task.completed || task.status === "done";
                const priorityConfig = PRIORITY_CONFIG[task.priority || "medium"];
                const due = getDueDateStatus(task.due_date, done);
                return <article className={`task-card ${done ? "completed" : ""} ${due?.state === "overdue" ? "task-overdue-border" : ""}`} key={task.id}>
                  <button className={`check ${done ? "completed-check" : ""}`} disabled={!task.can_update_status || taskActionId === task.id} onClick={() => void updateStatus(task, done ? "todo" : "done")} aria-label={done ? `Reopen ${task.title}` : `Complete ${task.title}`}>{done && <Icon name="check" size={14} />}</button>
                  <div className="task-content"><div className="task-title-wrap"><h3>{task.title}</h3><span className="priority-pill" style={{ color: priorityConfig.color, background: priorityConfig.bg }}><i style={{ background: priorityConfig.color }} />{priorityConfig.label}</span><span className={`status-tag status-tag-${task.status}`}>{task.status === "in_progress" ? "In progress" : done ? "Done" : "To do"}</span></div>{task.description && <p>{task.description}</p>}<div className="task-meta">{task.task_type === "assigned" ? <span className="assignee-tag"><Icon name="user" size={13} />{task.assignee_name || "Unassigned"}</span> : <span className="personal-tag"><Icon name="personal" size={13} /> Private</span>}{due && <span className={`due-pill due-${due.state}`}><Icon name="calendar" size={13} />{due.label}</span>}{task.task_type === "assigned" && <span className="creator-tag">{task.can_manage ? "Assigned by you" : `Assigned by ${task.creator_name || "admin"}`}</span>}{task.deadline_reminder_sent && <span className="reminder-pill"><Icon name="bell" size={13} /> Reminder sent</span>}</div></div>
                  <div className="task-actions">{task.task_type === "assigned" && !task.can_manage && task.can_update_status && <label className="status-only-control"><span>Status only</span><select value={task.status} disabled={taskActionId === task.id} onChange={(event) => void updateStatus(task, event.target.value)} aria-label={`Update status for ${task.title}`}><option value="todo">To do</option><option value="in_progress">In progress</option><option value="done">Done</option></select></label>}{dbStatus.devToolsEnabled && task.can_manage && !done && task.due_date && <button className="text-action-btn" disabled={taskActionId === task.id} onClick={(event) => void sendTestReminder(event, task)}><Icon name="bell" size={14} /> Test</button>}{task.can_manage && <><button className="icon-button edit" onClick={() => openEdit(task)} aria-label={`Edit ${task.title}`}><Icon name="edit" size={16} /></button><button className="icon-button delete" onClick={() => setConfirmation({ type: "delete", task })} aria-label={`Delete ${task.title}`}><Icon name="trash" size={16} /></button></>}</div>
                </article>;
              })}
            </div>
          ) : <div className="empty-state"><div className="empty-icon"><Icon name={hasActiveFilters ? "search" : taskSection === "assigned" ? "briefcase" : "personal"} size={25} /></div><h3>{hasActiveFilters ? "No tasks match these filters" : taskSection === "assigned" ? "No assigned work yet" : "Your personal list is ready"}</h3><p>{hasActiveFilters ? "Reset the filters or try a different search." : taskSection === "assigned" ? (isAdmin ? "Assign the first work task to a registered user." : "New work will appear here when the administrator assigns it to you.") : "Create a private to-do that only you can see."}</p>{hasActiveFilters ? <button className="secondary-button" onClick={resetFilters}>Reset filters</button> : canCreateInSection && <button className="add-button" onClick={() => openCreate()}><Icon name="plus" size={16} /> {taskSection === "assigned" ? "Assign task" : "Create to-do"}</button>}</div>}
        </section>
      </main>

      {showForm && <div className="modal-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) resetForm(); }}>
        <div className="modal" role="dialog" aria-modal="true" aria-labelledby="task-modal-title">
          <div className="modal-header"><div><span className="modal-label">{formTaskType === "assigned" ? "ADMIN ASSIGNMENT" : "PERSONAL TO-DO"}</span><h2 id="task-modal-title">{editTask ? "Update task details" : formTaskType === "assigned" ? "Assign work to a user" : "Create a private to-do"}</h2><p>{formTaskType === "assigned" ? "The assignee can update progress while you retain management control." : "This task stays separate from administrator-assigned work."}</p></div><button className="close-button" disabled={saving} onClick={resetForm} aria-label="Close"><Icon name="close" /></button></div>
          {formError && <div className="form-error" role="alert"><Icon name="alert" size={17} />{formError}</div>}
          <form onSubmit={handleSubmit}>
            <div className="form-group-modal"><label htmlFor="task-title">Task title *</label><input id="task-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength="255" placeholder="What needs to be done?" autoFocus required disabled={saving} /></div>
            <div className={`modal-two-column ${formTaskType === "personal" ? "single" : ""}`}><div className="form-group-modal"><label>Status</label><div className="status-select-grid">{KANBAN_COLUMNS.map((column) => <button type="button" key={column.id} className={status === column.id ? "selected" : ""} onClick={() => setStatus(column.id)} disabled={saving}><span className="column-color" style={{ background: column.color }} />{column.title}</button>)}</div></div>{formTaskType === "assigned" && <div className="form-group-modal"><label htmlFor="task-assignee">Assign to</label><select id="task-assignee" value={assignedUserId || currentUser.id} onChange={(event) => setAssignedUserId(event.target.value)} disabled={saving}>{users.map((user) => <option key={user.id} value={user.id}>{user.name}{user.id === currentUser.id ? " (You)" : ""} — {user.email}</option>)}</select></div>}</div>
            <div className="form-group-modal"><label>Priority</label><div className="priority-select-grid">{Object.entries(PRIORITY_CONFIG).map(([key, config]) => <button type="button" key={key} className={priority === key ? "selected" : ""} style={priority === key ? { borderColor: config.color, color: config.color, background: config.bg } : undefined} onClick={() => setPriority(key)} disabled={saving}><i style={{ background: config.color }} />{config.label}</button>)}</div></div>
            <div className="form-group-modal"><div className="label-row"><label htmlFor="task-date">Due date</label>{dueDate && <button type="button" className="clear-date-btn" onClick={() => setDueDate("")}>Clear</button>}</div><input id="task-date" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} disabled={saving} /><div className="quick-date-pills">{[[0, "Today"], [1, "Tomorrow"], [7, "In one week"]].map(([offset, label]) => <button type="button" key={label} onClick={() => { const target = new Date(); target.setDate(target.getDate() + offset); setDueDate(dateKey(target)); }}>{label}</button>)}</div></div>
            <div className="form-group-modal"><label htmlFor="task-description">Description</label><textarea id="task-description" value={description} onChange={(event) => setDescription(event.target.value)} maxLength="5000" rows="4" placeholder="Add context, a useful outcome, or next steps..." disabled={saving} /></div>
            <div className="modal-actions"><button type="button" className="cancel-button" onClick={resetForm} disabled={saving}>Cancel</button><button type="submit" className="save-button" disabled={saving}>{saving ? "Saving..." : editTask ? "Save changes" : "Create task"}</button></div>
          </form>
        </div>
      </div>}

      {confirmation && <div className="modal-overlay"><div className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title"><div className="confirm-icon"><Icon name="trash" size={22} /></div><h2 id="confirm-title">{confirmation.type === "delete" ? "Delete this task?" : `Clear ${taskSection === "personal" ? "personal to-dos" : "assigned work"}?`}</h2><p>{confirmation.type === "delete" ? `"${confirmation.task.title}" will be permanently removed.` : `This will permanently delete ${managedTaskCount} task${managedTaskCount === 1 ? "" : "s"} from this section. The other section will not be affected.`}</p><div className="modal-actions"><button className="cancel-button" onClick={() => setConfirmation(null)} disabled={confirming}>Cancel</button><button className="danger-button" onClick={() => void runConfirmedAction()} disabled={confirming}>{confirming ? "Deleting..." : "Delete"}</button></div></div></div>}

      {toast && <div className="toast-container" aria-live="polite"><div className={`toast-item ${toast.type}`}><span>{toast.message}</span><button className="toast-close" onClick={() => setToast(null)} aria-label="Dismiss"><Icon name="close" size={16} /></button></div></div>}
    </div>
  );
}

export default App;
