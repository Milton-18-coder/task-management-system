import { useEffect, useMemo, useRef, useState } from "react";
import { taskApi, authApi, authStorage, userApi } from "./api";
import Auth from "./Auth";
import "./App.css";

const PRIORITY_CONFIG = {
  urgent: { label: "Urgent", color: "#ef4444", bg: "rgba(239, 68, 68, 0.12)", border: "rgba(239, 68, 68, 0.3)", order: 4, icon: "🔴" },
  high: { label: "High", color: "#f97316", bg: "rgba(249, 115, 22, 0.12)", border: "rgba(249, 115, 22, 0.3)", order: 3, icon: "🟠" },
  medium: { label: "Medium", color: "#eab308", bg: "rgba(234, 179, 8, 0.12)", border: "rgba(234, 179, 8, 0.3)", order: 2, icon: "🟡" },
  low: { label: "Low", color: "#3b82f6", bg: "rgba(59, 130, 246, 0.12)", border: "rgba(59, 130, 246, 0.3)", order: 1, icon: "🔵" },
};

const KANBAN_COLUMNS = [
  { id: "todo", title: "To Do", icon: "📝", color: "#6366f1" },
  { id: "in_progress", title: "In Progress", icon: "⏳", color: "#f59e0b" },
  { id: "done", title: "Done", icon: "✅", color: "#10b981" },
];

function getDueDateStatus(dueDateStr, completed) {
  if (!dueDateStr) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const due = new Date(dueDateStr);
  due.setHours(0, 0, 0, 0);

  const diffTime = due.getTime() - today.getTime();
  const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

  const formattedDate = due.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: due.getFullYear() !== today.getFullYear() ? "numeric" : undefined,
  });

  if (completed) {
    return { label: formattedDate, state: "completed", tag: "Done" };
  }

  if (diffDays < 0) {
    const overdueDays = Math.abs(diffDays);
    return {
      label: `${formattedDate} (${overdueDays}d overdue)`,
      state: "overdue",
      tag: "Overdue",
    };
  } else if (diffDays === 0) {
    return { label: "Due Today", state: "today", tag: "Today" };
  } else if (diffDays === 1) {
    return { label: "Due Tomorrow", state: "tomorrow", tag: "Tomorrow" };
  } else {
    return { label: formattedDate, state: "upcoming", tag: `${diffDays}d left` };
  }
}

function App() {
  const [currentUser, setCurrentUser] = useState(authStorage.getUser());
  const [tasks, setTasks] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dbStatus, setDbStatus] = useState({ connected: false, message: "Checking..." });
  const [toast, setToast] = useState(null);

  const showToast = (message, type = "info") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4500);
  };

  // UI Theme & View Mode
  const [theme, setTheme] = useState(() => localStorage.getItem("taskflow_theme") || "light");
  const [viewMode, setViewMode] = useState("list"); // "list" | "kanban"

  // Task form state
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("medium");
  const [status, setStatus] = useState("todo");
  const [dueDate, setDueDate] = useState("");
  const [assignedUserId, setAssignedUserId] = useState("");
  const [editId, setEditId] = useState(null);

  // Filters & Sorting state
  const [filter, setFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [sortBy, setSortBy] = useState("default");
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [draggedTask, setDraggedTask] = useState(null);

  const fileInputRef = useRef(null);

  // Toggle Theme
  const toggleTheme = () => {
    const nextTheme = theme === "light" ? "dark" : "light";
    setTheme(nextTheme);
    localStorage.setItem("taskflow_theme", nextTheme);
  };

  // Check health and session
  const checkHealthStatus = async () => {
    try {
      const health = await taskApi.checkHealth();
      const isOk = health.status === "ok";
      const msg = isOk ? "MySQL Connected" : (health.message || "MySQL Offline");
      
      setDbStatus((prev) => {
        if (prev.connected === isOk && prev.message === msg) return prev;
        return { connected: isOk, message: msg };
      });
      return isOk;
    } catch {
      setDbStatus((prev) => {
        if (!prev.connected && prev.message === "Server Offline") return prev;
        return { connected: false, message: "Server Offline" };
      });
      return false;
    }
  };

  const checkInitialStatus = async () => {
    const isOnline = await checkHealthStatus();

    // Verify existing token session if user is logged in
    const token = authStorage.getToken();
    if (token) {
      try {
        const me = await authApi.getMe();
        if (me.user) {
          setCurrentUser(me.user);
          authStorage.setUser(me.user);
        }
      } catch {
        if (isOnline) {
          authStorage.clearAuth();
          setCurrentUser(null);
        }
      }
    }
  };

  const loadTasks = async (showLoadingSpinner = false) => {
    if (!currentUser) {
      setLoading(false);
      return;
    }

    if (showLoadingSpinner) {
      setLoading(true);
    }

    try {
      const token = authStorage.getToken();
      if (token) {
        const fetchedTasks = await taskApi.getTasks();
        setTasks(fetchedTasks);
        setDbStatus((prev) => (prev.connected ? prev : { connected: true, message: "MySQL Connected" }));
      } else {
        const userStorageKey = `tasks_${currentUser.id || currentUser.email}`;
        const saved = localStorage.getItem(userStorageKey);
        if (saved) setTasks(JSON.parse(saved));
      }
    } catch (err) {
      console.warn("Failed to fetch tasks from server, checking local backup:", err.message);
      const userStorageKey = `tasks_${currentUser.id || currentUser.email}`;
      const saved = localStorage.getItem(userStorageKey);
      if (saved) setTasks(JSON.parse(saved));
    } finally {
      if (showLoadingSpinner) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    checkInitialStatus();
  }, []);

  useEffect(() => {
    if (currentUser) {
      loadTasks(true);
      userApi.getUsers().then(setUsers).catch(() => {});
    } else {
      setTasks([]);
      setUsers([]);
      setLoading(false);
    }
  }, [currentUser]);

  // Background heartbeat (every 6 seconds, silent check)
  useEffect(() => {
    if (!currentUser) return;

    const interval = setInterval(async () => {
      const isOnline = await checkHealthStatus();
      if (isOnline) {
        loadTasks(false);
      }
    }, 6000);

    return () => clearInterval(interval);
  }, [currentUser]);

  // Sync tasks locally per user as fallback
  useEffect(() => {
    if (currentUser && !loading) {
      const userStorageKey = `tasks_${currentUser.id || currentUser.email}`;
      localStorage.setItem(userStorageKey, JSON.stringify(tasks));
    }
  }, [tasks, currentUser, loading]);

  const handleLogout = () => {
    authStorage.clearAuth();
    setCurrentUser(null);
    setTasks([]);
    setUsers([]);
    resetForm();
  };

  const completedCount = tasks.filter((task) => task.completed || task.status === "done").length;
  const inProgressCount = tasks.filter((task) => !task.completed && task.status === "in_progress").length;
  const pendingCount = tasks.length - completedCount;

  const overdueCount = tasks.filter((task) => {
    if (task.completed || task.status === "done" || !task.due_date) return false;
    const due = new Date(task.due_date);
    due.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return due < today;
  }).length;

  const completionRate =
    tasks.length === 0
      ? 0
      : Math.round((completedCount / tasks.length) * 100);

  const filteredTasks = useMemo(() => {
    let result = tasks.filter((task) => {
      const matchesSearch =
        (task.title || "").toLowerCase().includes(search.toLowerCase()) ||
        (task.description || "").toLowerCase().includes(search.toLowerCase());

      const taskIsDone = task.completed || task.status === "done";

      const matchesStatusFilter =
        filter === "all"
          ? true
          : filter === "completed"
          ? taskIsDone
          : filter === "pending"
          ? !taskIsDone
          : filter === "in_progress"
          ? task.status === "in_progress"
          : filter === "overdue"
          ? !taskIsDone && task.due_date && new Date(task.due_date) < new Date(new Date().setHours(0, 0, 0, 0))
          : true;

      const matchesPriorityFilter =
        priorityFilter === "all" ? true : (task.priority || "medium") === priorityFilter;

      return matchesSearch && matchesStatusFilter && matchesPriorityFilter;
    });

    // Apply Sorting
    result = [...result].sort((a, b) => {
      if (sortBy === "priorityDesc") {
        const orderA = PRIORITY_CONFIG[a.priority || "medium"]?.order || 2;
        const orderB = PRIORITY_CONFIG[b.priority || "medium"]?.order || 2;
        return orderB - orderA;
      }
      if (sortBy === "priorityAsc") {
        const orderA = PRIORITY_CONFIG[a.priority || "medium"]?.order || 2;
        const orderB = PRIORITY_CONFIG[b.priority || "medium"]?.order || 2;
        return orderA - orderB;
      }
      if (sortBy === "dueDate") {
        if (!a.due_date) return 1;
        if (!b.due_date) return -1;
        return new Date(a.due_date) - new Date(b.due_date);
      }
      if (sortBy === "title") {
        return (a.title || "").localeCompare(b.title || "");
      }
      return 0;
    });

    return result;
  }, [tasks, filter, priorityFilter, sortBy, search]);

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!title.trim()) {
      alert("Please enter a task title.");
      return;
    }

    const taskStatus = status || "todo";
    const isCompleted = taskStatus === "done";

    const payload = {
      title: title.trim(),
      description: description.trim(),
      priority: priority || "medium",
      status: taskStatus,
      completed: isCompleted,
      due_date: dueDate || null,
      user_id: assignedUserId ? Number(assignedUserId) : currentUser.id,
    };

    if (editId) {
      try {
        if (dbStatus.connected && authStorage.getToken()) {
          const updated = await taskApi.updateTask(editId, payload);
          setTasks((prev) =>
            prev.map((t) => (t.id === editId ? updated : t))
          );
          showToast("Task updated successfully", "success");
        } else {
          setTasks((prev) =>
            prev.map((task) =>
              task.id === editId
                ? { ...task, ...payload }
                : task
            )
          );
          showToast("Task updated locally", "info");
        }
      } catch (err) {
        alert("Error updating task: " + err.message);
      }
    } else {
      try {
        if (dbStatus.connected && authStorage.getToken()) {
          const created = await taskApi.createTask(payload);
          setTasks((prev) => [created, ...prev]);

          if (created.emailNotification?.status === 'sent') {
            showToast("Task created & immediate assignment email sent!", "success");
          } else if (created.emailNotification?.status === 'failed') {
            showToast("Task created. (Email notification could not be delivered)", "warning");
          } else {
            showToast("Task created successfully.", "success");
          }
        } else {
          const newTask = {
            id: Date.now(),
            ...payload,
          };
          setTasks((prev) => [newTask, ...prev]);
          showToast("Task created locally", "info");
        }
      } catch (err) {
        alert("Error creating task: " + err.message);
      }
    }

    resetForm();
  };

  const resetForm = () => {
    setTitle("");
    setDescription("");
    setPriority("medium");
    setStatus("todo");
    setDueDate("");
    setAssignedUserId("");
    setEditId(null);
    setShowForm(false);
  };

  const handleEdit = (task) => {
    setTitle(task.title);
    setDescription(task.description || "");
    setPriority(task.priority || "medium");
    setStatus(task.status || (task.completed ? "done" : "todo"));
    const formattedDate = task.due_date
      ? new Date(task.due_date).toISOString().split("T")[0]
      : "";
    setDueDate(formattedDate);
    setAssignedUserId(task.user_id ? String(task.user_id) : "");
    setEditId(task.id);
    setShowForm(true);
  };

  const handleTestReminder = async (e, task) => {
    e.stopPropagation();
    if (task.completed || task.status === "done") {
      showToast("Reminder cannot be sent for completed tasks.", "warning");
      return;
    }
    try {
      showToast("Sending test deadline reminder email...", "info");
      const res = await taskApi.sendTestReminder(task.id);
      if (res.success) {
        showToast(`Deadline reminder email sent to ${task.assignee_email || currentUser.email}!`, "success");
      } else {
        showToast(res.message || "Failed to send reminder email", "error");
      }
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  const handleDelete = async (id) => {
    const confirmDelete = window.confirm(
      "Are you sure you want to delete this task?"
    );

    if (confirmDelete) {
      try {
        if (dbStatus.connected && authStorage.getToken()) {
          await taskApi.deleteTask(id);
        }
        setTasks((prev) => prev.filter((task) => task.id !== id));
      } catch (err) {
        alert("Error deleting task: " + err.message);
      }
    }
  };

  const handleComplete = async (id) => {
    const taskToUpdate = tasks.find((task) => task.id === id);
    if (!taskToUpdate) return;

    const nextCompleted = !(taskToUpdate.completed || taskToUpdate.status === "done");
    const nextStatus = nextCompleted ? "done" : "todo";

    try {
      if (dbStatus.connected && authStorage.getToken()) {
        await taskApi.updateTask(id, {
          completed: nextCompleted,
          status: nextStatus,
        });
      }

      setTasks((prev) =>
        prev.map((task) =>
          task.id === id
            ? { ...task, completed: nextCompleted, status: nextStatus }
            : task
        )
      );
    } catch (err) {
      alert("Error updating status: " + err.message);
    }
  };

  // Move task to a specific Kanban column
  const handleUpdateStatus = async (id, nextStatus) => {
    const isCompleted = nextStatus === "done";

    try {
      if (dbStatus.connected && authStorage.getToken()) {
        await taskApi.updateTask(id, {
          status: nextStatus,
          completed: isCompleted,
        });
      }

      setTasks((prev) =>
        prev.map((task) =>
          task.id === id
            ? { ...task, status: nextStatus, completed: isCompleted }
            : task
        )
      );
    } catch (err) {
      alert("Error updating task column: " + err.message);
    }
  };

  const handleDragStart = (task) => {
    setDraggedTask(task);
  };

  // Reordering in List view
  const handleListDrop = (targetTask) => {
    if (!draggedTask || draggedTask.id === targetTask.id) return;

    const updatedTasks = [...tasks];
    const draggedIndex = updatedTasks.findIndex(
      (task) => task.id === draggedTask.id
    );
    const targetIndex = updatedTasks.findIndex(
      (task) => task.id === targetTask.id
    );

    const [removedTask] = updatedTasks.splice(draggedIndex, 1);
    updatedTasks.splice(targetIndex, 0, removedTask);

    setTasks(updatedTasks);
    setDraggedTask(null);
  };

  // Moving across columns in Kanban view
  const handleColumnDrop = (columnId) => {
    if (!draggedTask) return;
    if (draggedTask.status !== columnId) {
      handleUpdateStatus(draggedTask.id, columnId);
    }
    setDraggedTask(null);
  };

  const clearAllTasks = async () => {
    if (tasks.length === 0) return;

    const confirmClear = window.confirm(
      "Delete all tasks for your account from the database?"
    );

    if (confirmClear) {
      try {
        if (dbStatus.connected && authStorage.getToken()) {
          await taskApi.clearAllTasks();
        }
        setTasks([]);
      } catch (err) {
        alert("Error clearing tasks: " + err.message);
      }
    }
  };

  // ==========================================
  // CSV & JSON Data Export & Import Handlers
  // ==========================================
  const exportToCSV = () => {
    if (tasks.length === 0) {
      alert("No tasks available to export.");
      return;
    }

    const headers = ["ID", "Title", "Description", "Status", "Priority", "Due Date", "Created At"];
    const rows = tasks.map((t) => [
      t.id,
      `"${(t.title || "").replace(/"/g, '""')}"`,
      `"${(t.description || "").replace(/"/g, '""')}"`,
      t.status || (t.completed ? "done" : "todo"),
      t.priority || "medium",
      t.due_date || "",
      t.created_at || "",
    ]);

    const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const userNameClean = (currentUser.name || "user").toLowerCase().replace(/\s+/g, "_");
    link.setAttribute("href", url);
    link.setAttribute("download", `TaskFlow_${userNameClean}_${new Date().toISOString().split("T")[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const exportToJSON = () => {
    if (tasks.length === 0) {
      alert("No tasks available to export.");
      return;
    }

    const dataStr = JSON.stringify(tasks, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const userNameClean = (currentUser.name || "user").toLowerCase().replace(/\s+/g, "_");
    link.setAttribute("href", url);
    link.setAttribute("download", `TaskFlow_Backup_${userNameClean}_${new Date().toISOString().split("T")[0]}.json`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleImportFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const content = event.target.result;
        let importedList = [];

        if (file.name.endsWith(".json")) {
          importedList = JSON.parse(content);
        } else if (file.name.endsWith(".csv")) {
          const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
          if (lines.length > 1) {
            importedList = lines.slice(1).map((line) => {
              const parts = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
              return {
                title: (parts[1] || "").replace(/^"|"$/g, "").replace(/""/g, '"').trim(),
                description: (parts[2] || "").replace(/^"|"$/g, "").replace(/""/g, '"').trim(),
                status: (parts[3] || "todo").replace(/^"|"$/g, "").trim(),
                priority: (parts[4] || "medium").replace(/^"|"$/g, "").trim(),
                due_date: (parts[5] || "").replace(/^"|"$/g, "").trim() || null,
              };
            });
          }
        }

        if (!Array.isArray(importedList) || importedList.length === 0) {
          alert("No valid tasks found in the imported file.");
          return;
        }

        // Add imported tasks
        for (const item of importedList) {
          if (!item.title) continue;
          const payload = {
            title: item.title,
            description: item.description || "",
            status: item.status || "todo",
            priority: item.priority || "medium",
            due_date: item.due_date || null,
          };
          if (dbStatus.connected && authStorage.getToken()) {
            await taskApi.createTask(payload);
          }
        }

        await loadTasks(false);
        alert(`Successfully imported ${importedList.length} tasks!`);
      } catch (err) {
        alert("Error importing file: " + err.message);
      } finally {
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    };
    reader.readAsText(file);
  };

  // Helper for setting quick dates
  const setQuickDueDate = (daysOffset) => {
    const target = new Date();
    target.setDate(target.getDate() + daysOffset);
    setDueDate(target.toISOString().split("T")[0]);
  };

  // If user is not authenticated, show Auth Page
  if (!currentUser) {
    return (
      <Auth
        onAuthSuccess={(user) => {
          setCurrentUser(user);
          loadTasks(true);
        }}
        dbStatus={dbStatus}
      />
    );
  }

  // Generate User Initials for Avatar
  const userInitials = (currentUser.name || currentUser.email || "U")
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .substring(0, 2);

  return (
    <div className="app" data-theme={theme}>
      {/* Hidden File Input for Import */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleImportFile}
        accept=".json,.csv"
        style={{ display: "none" }}
      />

      {/* SIDEBAR */}
      <aside className="sidebar">
        <div className="logo">
          <div className="logo-icon">✓</div>
          <div>
            <h2>TaskFlow</h2>
            <span>Task Manager</span>
          </div>
        </div>

        {/* Database Status Indicator */}
        <div
          onClick={async () => {
            const ok = await checkHealthStatus();
            if (ok) loadTasks(false);
          }}
          title="Click to refresh / reconnect"
          className="sidebar-status-pill"
          style={{
            background: dbStatus.connected
              ? "rgba(34, 197, 94, 0.15)"
              : "rgba(239, 68, 68, 0.15)",
            color: dbStatus.connected ? "#4ade80" : "#f87171",
            border: `1px solid ${
              dbStatus.connected
                ? "rgba(74, 222, 128, 0.3)"
                : "rgba(248, 113, 113, 0.3)"
            }`,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                backgroundColor: dbStatus.connected ? "#4ade80" : "#f87171",
                boxShadow: dbStatus.connected ? "0 0 8px #4ade80" : "none",
              }}
            />
            {dbStatus.connected ? "MySQL Connected" : "Offline / Retry"}
          </div>
          <span style={{ fontSize: "13px", opacity: 0.8, marginLeft: "4px" }}>⟳</span>
        </div>

        {/* Navigation Filters */}
        <nav>
          <button
            className={filter === "all" ? "nav-item active" : "nav-item"}
            onClick={() => setFilter("all")}
          >
            <span>▦</span>
            All Tasks
            <b>{tasks.length}</b>
          </button>

          <button
            className={filter === "pending" ? "nav-item active" : "nav-item"}
            onClick={() => setFilter("pending")}
          >
            <span>◷</span>
            To Do
            <b>{pendingCount - inProgressCount}</b>
          </button>

          <button
            className={filter === "in_progress" ? "nav-item active" : "nav-item"}
            onClick={() => setFilter("in_progress")}
          >
            <span>⏳</span>
            In Progress
            <b>{inProgressCount}</b>
          </button>

          <button
            className={filter === "completed" ? "nav-item active" : "nav-item"}
            onClick={() => setFilter("completed")}
          >
            <span>✓</span>
            Completed
            <b>{completedCount}</b>
          </button>

          {overdueCount > 0 && (
            <button
              className={filter === "overdue" ? "nav-item active overdue-nav" : "nav-item overdue-nav"}
              onClick={() => setFilter("overdue")}
            >
              <span>⚠</span>
              Overdue
              <b className="overdue-nav-badge">{overdueCount}</b>
            </button>
          )}
        </nav>

        {/* Priority Quick Filter in Sidebar */}
        <div className="sidebar-filter-section">
          <span className="sidebar-section-title">Priority Filter</span>
          <div className="priority-pills-wrap">
            {["all", "urgent", "high", "medium", "low"].map((p) => (
              <button
                key={p}
                className={`priority-chip ${priorityFilter === p ? "active" : ""}`}
                onClick={() => setPriorityFilter(p)}
              >
                {p === "all" ? "All" : PRIORITY_CONFIG[p].label}
              </button>
            ))}
          </div>
        </div>

        {/* Data Tools in Sidebar */}
        <div className="sidebar-filter-section">
          <span className="sidebar-section-title">Data Backup & Tools</span>
          <div className="sidebar-tools-grid">
            <button
              className="tool-btn"
              onClick={exportToCSV}
              title="Download CSV spreadsheet"
            >
              📊 Export CSV
            </button>
            <button
              className="tool-btn"
              onClick={exportToJSON}
              title="Download JSON backup"
            >
              💾 Backup JSON
            </button>
            <button
              className="tool-btn"
              onClick={() => fileInputRef.current?.click()}
              title="Import JSON or CSV file"
            >
              📥 Import Tasks
            </button>
          </div>
        </div>

        <div className="sidebar-bottom">
          {/* Productivity progress */}
          <div className="productivity-box">
            <span>Productivity</span>
            <strong>{completionRate}%</strong>
            <div className="mini-progress">
              <div style={{ width: `${completionRate}%` }}></div>
            </div>
            <small>Keep going! You're doing great.</small>
          </div>

          {/* User Profile in Sidebar */}
          <div className="sidebar-user-card">
            <div className="user-avatar">{userInitials}</div>
            <div className="user-info">
              <div className="user-name" title={currentUser.name}>
                {currentUser.name}
              </div>
              <div className="user-email" title={currentUser.email}>
                {currentUser.email}
              </div>
            </div>
            <button
              className="logout-icon-btn"
              onClick={handleLogout}
              title="Sign Out"
            >
              ⎋
            </button>
          </div>
        </div>
      </aside>

      {/* MAIN CONTENT */}
      <main className="main">
        {/* HEADER */}
        <header className="topbar">
          <div>
            <p className="welcome">
              Welcome back, <b>{currentUser.name.split(" ")[0]}</b> 👋
            </p>
            <h1>My Tasks</h1>
          </div>

          <div className="top-actions">
            {/* View Switcher */}
            <div className="view-toggle">
              <button
                className={`view-btn ${viewMode === "list" ? "active" : ""}`}
                onClick={() => setViewMode("list")}
                title="List View"
              >
                ☰ List
              </button>
              <button
                className={`view-btn ${viewMode === "kanban" ? "active" : ""}`}
                onClick={() => setViewMode("kanban")}
                title="Kanban Board View"
              >
                ☷ Board
              </button>
            </div>

            {/* Dark Mode Toggle */}
            <button
              className="theme-toggle-btn"
              onClick={toggleTheme}
              title={theme === "light" ? "Switch to Dark Mode" : "Switch to Light Mode"}
            >
              {theme === "light" ? "🌙 Dark" : "☀️ Light"}
            </button>

            {/* Search */}
            <div className="search-box">
              <span>⌕</span>
              <input
                type="text"
                placeholder="Search tasks..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            {/* Sort Selector */}
            <div className="sort-box">
              <span className="sort-label">Sort:</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="sort-select"
              >
                <option value="default">Default</option>
                <option value="dueDate">Due Date</option>
                <option value="priorityDesc">Priority (High-Low)</option>
                <option value="priorityAsc">Priority (Low-High)</option>
                <option value="title">A-Z</option>
              </select>
            </div>

            <button
              className="add-button"
              onClick={() => {
                resetForm();
                setShowForm(true);
              }}
            >
              + Add Task
            </button>

            <button
              className="user-pill-btn"
              onClick={handleLogout}
              title="Click to sign out"
            >
              <span className="user-pill-avatar">{userInitials}</span>
              <span className="user-pill-name">{currentUser.name.split(" ")[0]}</span>
              <span className="user-pill-logout">Sign Out</span>
            </button>
          </div>
        </header>

        {/* STATISTICS */}
        <section className="stats">
          <div className="stat-card">
            <div className="stat-icon purple">▦</div>
            <div>
              <span>Total Tasks</span>
              <strong>{tasks.length}</strong>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-icon orange">⏳</div>
            <div>
              <span>In Progress</span>
              <strong>{inProgressCount}</strong>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-icon green">✓</div>
            <div>
              <span>Completed</span>
              <strong>{completedCount}</strong>
            </div>
          </div>

          {overdueCount > 0 ? (
            <div className="stat-card overdue-card">
              <div className="stat-icon red">⚠</div>
              <div>
                <span>Overdue</span>
                <strong style={{ color: "#ef4444" }}>{overdueCount}</strong>
              </div>
            </div>
          ) : (
            <div className="stat-card">
              <div className="stat-icon blue">%</div>
              <div>
                <span>Completion</span>
                <strong>{completionRate}%</strong>
              </div>
            </div>
          )}
        </section>

        {/* PROGRESS BAR */}
        <section className="progress-section">
          <div className="progress-header">
            <div>
              <h3>Workspace Completion</h3>
              <p>
                {completedCount} of {tasks.length} tasks completed
              </p>
            </div>
            <strong>{completionRate}%</strong>
          </div>

          <div className="progress-bar">
            <div style={{ width: `${completionRate}%` }}></div>
          </div>
        </section>

        {/* TASK HEADER & VIEW CONTAINER */}
        <div className="task-heading">
          <div>
            <h2>
              {filter === "all"
                ? "All Tasks"
                : filter === "pending"
                ? "To Do Tasks"
                : filter === "in_progress"
                ? "In Progress"
                : filter === "completed"
                ? "Completed Tasks"
                : "Overdue Tasks"}
              {priorityFilter !== "all" && (
                <span className="active-priority-badge">
                  • {PRIORITY_CONFIG[priorityFilter]?.label} Priority
                </span>
              )}
            </h2>
            <p>
              {viewMode === "kanban"
                ? "Drag cards across columns to update their workflow status"
                : "Drag and drop tasks to rearrange or prioritize them"}
            </p>
          </div>

          <div className="task-heading-actions">
            {tasks.length > 0 && (
              <button className="clear-button" onClick={clearAllTasks}>
                Clear All
              </button>
            )}
          </div>
        </div>

        {/* ==========================================
            VIEW MODE: KANBAN BOARD
        ========================================== */}
        {viewMode === "kanban" ? (
          <section className="kanban-board">
            {KANBAN_COLUMNS.map((col) => {
              const columnTasks = filteredTasks.filter((task) => {
                const taskStatus = task.status || (task.completed ? "done" : "todo");
                return taskStatus === col.id;
              });

              return (
                <div
                  key={col.id}
                  className="kanban-column"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => handleColumnDrop(col.id)}
                >
                  <div className="kanban-column-header">
                    <div className="kanban-header-title">
                      <span>{col.icon}</span>
                      <h3>{col.title}</h3>
                    </div>
                    <span className="kanban-column-count">{columnTasks.length}</span>
                  </div>

                  <div className="kanban-card-list">
                    {columnTasks.length === 0 ? (
                      <div className="kanban-empty-drop">
                        Drop tasks here to set status to <b>{col.title}</b>
                      </div>
                    ) : (
                      columnTasks.map((task) => {
                        const taskPriority = PRIORITY_CONFIG[task.priority || "medium"] || PRIORITY_CONFIG.medium;
                        const dueStatus = getDueDateStatus(task.due_date, task.completed || task.status === "done");

                        return (
                          <div
                            key={task.id}
                            className={`kanban-card ${task.completed || task.status === "done" ? "completed" : ""} ${
                              dueStatus?.state === "overdue" && !task.completed ? "task-overdue-border" : ""
                            }`}
                            draggable
                            onDragStart={() => handleDragStart(task)}
                          >
                            <div className="kanban-card-top">
                              <span
                                className="priority-pill"
                                style={{
                                  backgroundColor: taskPriority.bg,
                                  color: taskPriority.color,
                                  borderColor: taskPriority.border,
                                }}
                              >
                                {taskPriority.icon} {taskPriority.label}
                              </span>

                              <div className="kanban-card-menu">
                                <button
                                  className="mini-action-btn"
                                  onClick={() => handleEdit(task)}
                                  title="Edit Task"
                                >
                                  ✎
                                </button>
                                <button
                                  className="mini-action-btn delete"
                                  onClick={() => handleDelete(task.id)}
                                  title="Delete Task"
                                >
                                  ×
                                </button>
                              </div>
                            </div>

                            <h4 className="kanban-card-title">{task.title}</h4>
                            {task.description && (
                              <p className="kanban-card-desc">{task.description}</p>
                            )}

                            <div className="kanban-card-footer">
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                {dueStatus && (
                                  <span className={`due-pill due-${dueStatus.state}`}>
                                    📅 {dueStatus.label}
                                  </span>
                                )}
                                <span className="assignee-tag" title={task.assignee_email ? `Assigned to ${task.assignee_name || task.assignee_email}` : undefined}>
                                  👤 {task.assignee_name ? task.assignee_name.split(" ")[0] : (task.user_id === currentUser.id ? "You" : "Member")}
                                </span>
                                {task.deadline_reminder_sent && (
                                  <span className="reminder-pill" title="Final deadline reminder sent">
                                    🔔 Sent
                                  </span>
                                )}
                                {!task.completed && task.status !== "done" && task.due_date && (
                                  <button
                                    type="button"
                                    className="test-reminder-btn"
                                    onClick={(e) => handleTestReminder(e, task)}
                                    title="Send Test Deadline Reminder Email"
                                  >
                                    🔔 Test
                                  </button>
                                )}
                              </div>

                              {/* Quick Move Selector */}
                              <select
                                className="kanban-quick-move"
                                value={task.status || (task.completed ? "done" : "todo")}
                                onChange={(e) => handleUpdateStatus(task.id, e.target.value)}
                              >
                                <option value="todo">📝 To Do</option>
                                <option value="in_progress">⏳ In Progress</option>
                                <option value="done">✅ Done</option>
                              </select>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>

                  <button
                    className="kanban-add-column-btn"
                    onClick={() => {
                      resetForm();
                      setStatus(col.id);
                      setShowForm(true);
                    }}
                  >
                    + Add to {col.title}
                  </button>
                </div>
              );
            })}
          </section>
        ) : (
          /* ==========================================
              VIEW MODE: LIST VIEW
          ========================================== */
          <section className="task-list">
            {loading ? (
              <div className="empty-state">
                <h3>Loading tasks...</h3>
              </div>
            ) : filteredTasks.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">✓</div>
                <h3>
                  {search || priorityFilter !== "all"
                    ? "No matching tasks"
                    : "No tasks yet"}
                </h3>
                <p>
                  {search || priorityFilter !== "all"
                    ? "Try adjusting your search or priority filter."
                    : "Create your first task with priority and deadline."}
                </p>
                {!search && priorityFilter === "all" && (
                  <button
                    className="add-button"
                    onClick={() => setShowForm(true)}
                  >
                    + Create Task
                  </button>
                )}
              </div>
            ) : (
              filteredTasks.map((task) => {
                const taskPriority = PRIORITY_CONFIG[task.priority || "medium"] || PRIORITY_CONFIG.medium;
                const isTaskDone = task.completed || task.status === "done";
                const dueStatus = getDueDateStatus(task.due_date, isTaskDone);

                return (
                  <div
                    key={task.id}
                    className={`task-card ${isTaskDone ? "completed" : ""} ${
                      dueStatus?.state === "overdue" && !isTaskDone ? "task-overdue-border" : ""
                    }`}
                    draggable
                    onDragStart={() => handleDragStart(task)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => handleListDrop(task)}
                  >
                    <div className="drag-handle">⋮⋮</div>

                    <button
                      className={
                        isTaskDone
                          ? "check completed-check"
                          : "check"
                      }
                      onClick={() => handleComplete(task.id)}
                    >
                      {isTaskDone ? "✓" : ""}
                    </button>

                    <div className="task-content">
                      <div className="task-title-row">
                        <div className="task-title-wrap">
                          <h3>{task.title}</h3>
                          {/* Priority Pill */}
                          <span
                            className="priority-pill"
                            style={{
                              backgroundColor: taskPriority.bg,
                              color: taskPriority.color,
                              borderColor: taskPriority.border,
                            }}
                          >
                            {taskPriority.icon} {taskPriority.label}
                          </span>

                          {/* Status Pill */}
                          <span className={`status-tag status-tag-${task.status || (task.completed ? "done" : "todo")}`}>
                            {task.status === "in_progress"
                              ? "⏳ In Progress"
                              : isTaskDone
                              ? "✅ Done"
                              : "📝 To Do"}
                          </span>

                          {/* Assignee Pill */}
                          <span className="assignee-tag" title={task.assignee_email ? `Assigned to ${task.assignee_name || task.assignee_email}` : undefined}>
                            👤 {task.assignee_name ? task.assignee_name.split(" ")[0] : (task.user_id === currentUser.id ? "You" : "Member")}
                          </span>

                          {/* Due Date Pill */}
                          {dueStatus && (
                            <span
                              className={`due-pill due-${dueStatus.state}`}
                              title={`Deadline: ${task.due_date}`}
                            >
                              📅 {dueStatus.label}
                            </span>
                          )}

                          {/* Reminder Status Pill */}
                          {task.deadline_reminder_sent && (
                            <span className="reminder-pill" title="Final deadline reminder sent">
                              🔔 Reminder Sent
                            </span>
                          )}
                        </div>

                        <span
                          className={
                            isTaskDone
                              ? "status completed-status"
                              : "status pending-status"
                          }
                        >
                          {isTaskDone ? "Completed" : task.status === "in_progress" ? "In Progress" : "Pending"}
                        </span>
                      </div>

                      {task.description && <p>{task.description}</p>}
                    </div>

                    <div className="task-actions">
                      {!isTaskDone && task.due_date && (
                        <button
                          type="button"
                          className="test-reminder-btn"
                          onClick={(e) => handleTestReminder(e, task)}
                          title="Send Test Deadline Reminder Email"
                        >
                          🔔 Test Reminder
                        </button>
                      )}

                      <button
                        className="icon-button edit"
                        onClick={() => handleEdit(task)}
                        title="Edit"
                      >
                        ✎
                      </button>

                      <button
                        className="icon-button delete"
                        onClick={() => handleDelete(task.id)}
                        title="Delete"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </section>
        )}

        {/* FOOTER */}
        <footer>
          <span>TaskFlow</span>
          <span>•</span>
          <span>Personal Workspace for {currentUser.name}</span>
          <span>•</span>
          <span>Task Manager</span>
        </footer>
      </main>

      {/* ADD / EDIT MODAL */}
      {showForm && (
        <div
          className="modal-overlay"
          onClick={(e) => {
            if (e.target.className === "modal-overlay") {
              resetForm();
            }
          }}
        >
          <div className="modal">
            <div className="modal-header">
              <div>
                <span className="modal-label">
                  {editId ? "EDIT TASK" : "NEW TASK"}
                </span>
                <h2>{editId ? "Update your task" : "Create a new task"}</h2>
              </div>
              <button className="close-button" onClick={resetForm}>
                ×
              </button>
            </div>

            <form onSubmit={handleSubmit}>
              <div className="form-group-modal">
                <label>Task Title *</label>
                <input
                  type="text"
                  placeholder="e.g. Complete quarterly project report"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  autoFocus
                  required
                />
              </div>

              {/* Status Selector in Modal */}
              <div className="form-group-modal">
                <label>Status / Workflow Column</label>
                <div className="status-select-grid">
                  {KANBAN_COLUMNS.map((col) => (
                    <button
                      type="button"
                      key={col.id}
                      className={`status-select-btn ${status === col.id ? "selected" : ""}`}
                      onClick={() => setStatus(col.id)}
                    >
                      <span>{col.icon}</span>
                      <b>{col.title}</b>
                    </button>
                  ))}
                </div>
              </div>

              <div className="form-group-modal">
                <label>Priority Level</label>
                <div className="priority-select-grid">
                  {Object.entries(PRIORITY_CONFIG).map(([key, config]) => (
                    <button
                      type="button"
                      key={key}
                      className={`priority-select-btn ${priority === key ? "selected" : ""}`}
                      style={{
                        borderColor: priority === key ? config.color : undefined,
                        backgroundColor: priority === key ? config.bg : undefined,
                        color: priority === key ? config.color : undefined,
                      }}
                      onClick={() => setPriority(key)}
                    >
                      <span>{config.icon}</span>
                      <b>{config.label}</b>
                    </button>
                  ))}
                </div>
              </div>

              <div className="form-group-modal">
                <div className="label-row">
                  <label>Due Date</label>
                  {dueDate && (
                    <button
                      type="button"
                      className="clear-date-btn"
                      onClick={() => setDueDate("")}
                    >
                      Clear Date
                    </button>
                  )}
                </div>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
                <div className="quick-date-pills">
                  <button type="button" onClick={() => setQuickDueDate(0)}>
                    Today
                  </button>
                  <button type="button" onClick={() => setQuickDueDate(1)}>
                    Tomorrow
                  </button>
                  <button type="button" onClick={() => setQuickDueDate(7)}>
                    In 1 Week
                  </button>
                </div>
              </div>

              {users && users.length > 0 && (
                <div className="form-group-modal">
                  <label>Assign To</label>
                  <select
                    value={assignedUserId || currentUser.id}
                    onChange={(e) => setAssignedUserId(e.target.value)}
                  >
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} ({u.email}) {u.id === currentUser.id ? "— (You)" : ""}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="form-group-modal">
                <label>Description</label>
                <textarea
                  placeholder="Add some details about your task..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows="4"
                />
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  className="cancel-button"
                  onClick={resetForm}
                >
                  Cancel
                </button>
                <button type="submit" className="save-button">
                  {editId ? "Save Changes" : "Create Task"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Toast Notification Container */}
      {toast && (
        <div className="toast-container">
          <div className={`toast-item ${toast.type}`}>
            <span>{toast.message}</span>
            <button className="toast-close" onClick={() => setToast(null)}>
              ×
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;