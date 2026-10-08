const API_BASE_URL = 'http://localhost:5000/api';

const TOKEN_STORAGE_KEY = 'task_mgmt_token';
const USER_STORAGE_KEY = 'task_mgmt_user';

export const authStorage = {
  getToken: () => localStorage.getItem(TOKEN_STORAGE_KEY),
  setToken: (token) => {
    if (token) {
      localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  },
  getUser: () => {
    try {
      const user = localStorage.getItem(USER_STORAGE_KEY);
      return user ? JSON.parse(user) : null;
    } catch {
      return null;
    }
  },
  setUser: (user) => {
    if (user) {
      localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(USER_STORAGE_KEY);
    }
  },
  clearAuth: () => {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    localStorage.removeItem(USER_STORAGE_KEY);
  },
};

const getAuthHeaders = () => {
  const token = authStorage.getToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
};

export const authApi = {
  // Register a new user
  async register({ name, email, password }) {
    const res = await fetch(`${API_BASE_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Registration failed (${res.status})`);
    }
    return data;
  },

  // Log in user
  async login({ email, password }) {
    const res = await fetch(`${API_BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Login failed (${res.status})`);
    }
    return data;
  },

  // Get current user profile
  async getMe() {
    const res = await fetch(`${API_BASE_URL}/auth/me`, {
      headers: getAuthHeaders(),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Session check failed (${res.status})`);
    }
    return data;
  },
};

export const userApi = {
  async getUsers() {
    const res = await fetch(`${API_BASE_URL}/users`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP error ${res.status}`);
    }
    return await res.json();
  },
};

export const taskApi = {
  // Check health / connection
  async checkHealth() {
    try {
      const res = await fetch(`${API_BASE_URL}/health`);
      return await res.json();
    } catch (err) {
      return { status: 'offline', message: err.message };
    }
  },

  // Get all tasks for authenticated user
  async getTasks() {
    const res = await fetch(`${API_BASE_URL}/tasks`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP error ${res.status}`);
    }
    return await res.json();
  },

  // Create a new task
  async createTask(task) {
    const res = await fetch(`${API_BASE_URL}/tasks`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(task),
    });
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP error ${res.status}`);
    }
    return await res.json();
  },

  // Update a task
  async updateTask(id, updates) {
    const res = await fetch(`${API_BASE_URL}/tasks/${id}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(updates),
    });
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP error ${res.status}`);
    }
    return await res.json();
  },

  // Delete a single task
  async deleteTask(id) {
    const res = await fetch(`${API_BASE_URL}/tasks/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP error ${res.status}`);
    }
    return await res.json();
  },

  // Clear all tasks
  async clearAllTasks() {
    const res = await fetch(`${API_BASE_URL}/tasks`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP error ${res.status}`);
    }
    return await res.json();
  },

  // Send a test reminder email for a specific task (Dev / Admin test)
  async sendTestReminder(id, markSent = false) {
    const res = await fetch(`${API_BASE_URL}/tasks/${id}/test-reminder`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ markSent }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Failed to trigger test reminder (${res.status})`);
    }
    return data;
  },

  // Trigger deadline reminder check cycle manually
  async triggerReminderCheck(forceAll = false) {
    const res = await fetch(`${API_BASE_URL}/reminder/trigger-check`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ forceAll }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Failed to trigger reminder check (${res.status})`);
    }
    return data;
  },

  // Get email notification logs
  async getNotifications() {
    const res = await fetch(`${API_BASE_URL}/notifications`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP error ${res.status}`);
    }
    return await res.json();
  },
};
