const API_BASE_URL = (import.meta.env.VITE_API_URL || "/api").replace(/\/$/, "");

const TOKEN_STORAGE_KEY = "task_mgmt_token";
const USER_STORAGE_KEY = "task_mgmt_user";

export const authStorage = {
  getToken: () => localStorage.getItem(TOKEN_STORAGE_KEY),
  setToken: (token) => {
    if (token) localStorage.setItem(TOKEN_STORAGE_KEY, token);
    else localStorage.removeItem(TOKEN_STORAGE_KEY);
  },
  getUser: () => {
    try {
      const user = localStorage.getItem(USER_STORAGE_KEY);
      return user ? JSON.parse(user) : null;
    } catch {
      localStorage.removeItem(USER_STORAGE_KEY);
      return null;
    }
  },
  setUser: (user) => {
    if (user) localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
    else localStorage.removeItem(USER_STORAGE_KEY);
  },
  clearAuth: () => {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    localStorage.removeItem(USER_STORAGE_KEY);
  },
};

export class ApiError extends Error {
  constructor(message, status = 0, details = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

async function apiRequest(path, { auth = true, body, headers, ...options } = {}) {
  const token = authStorage.getToken();
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(auth && token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }).catch((error) => {
    throw new ApiError("Unable to reach the TaskPulse server. Check that the backend is running.", 0, error);
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (auth && response.status === 401) {
      authStorage.clearAuth();
      window.dispatchEvent(new CustomEvent("taskpulse:auth-expired"));
    }
    throw new ApiError(data.error || `Request failed (${response.status})`, response.status, data);
  }

  return data;
}

export const authApi = {
  register: (credentials) => apiRequest("/auth/register", { method: "POST", auth: false, body: credentials }),
  login: (credentials) => apiRequest("/auth/login", { method: "POST", auth: false, body: credentials }),
  getMe: () => apiRequest("/auth/me"),
};

export const userApi = {
  getUsers: () => apiRequest("/users"),
};

export const taskApi = {
  async checkHealth() {
    try {
      return await apiRequest("/health", { auth: false });
    } catch (error) {
      return { status: "offline", message: error.message, devToolsEnabled: false };
    }
  },
  getTasks: () => apiRequest("/tasks"),
  createTask: (task) => apiRequest("/tasks", { method: "POST", body: task }),
  updateTask: (id, updates) => apiRequest(`/tasks/${id}`, { method: "PUT", body: updates }),
  deleteTask: (id) => apiRequest(`/tasks/${id}`, { method: "DELETE" }),
  clearAllTasks: (taskType) => apiRequest(`/tasks?task_type=${encodeURIComponent(taskType)}`, { method: "DELETE" }),
  sendTestReminder: (id, markSent = false) =>
    apiRequest(`/tasks/${id}/test-reminder`, { method: "POST", body: { markSent } }),
  triggerReminderCheck: (forceAll = false) =>
    apiRequest("/reminder/trigger-check", { method: "POST", body: { forceAll } }),
  getNotifications: () => apiRequest("/notifications"),
};
