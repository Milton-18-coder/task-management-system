import { useState } from "react";
import { authApi, authStorage } from "./api";

export default function Auth({ onAuthSuccess, dbStatus }) {
  const [isLogin, setIsLogin] = useState(true);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (!email.trim() || !password) {
      setError("Please fill in all required fields.");
      return;
    }

    if (!isLogin && !name.trim()) {
      setError("Please enter your name.");
      return;
    }

    if (password.length < 6) {
      setError("Password must be at least 6 characters long.");
      return;
    }

    setLoading(true);
    try {
      let data;
      if (isLogin) {
        data = await authApi.login({
          email: email.trim(),
          password: password,
        });
      } else {
        data = await authApi.register({
          name: name.trim(),
          email: email.trim(),
          password: password,
        });
      }

      authStorage.setToken(data.token);
      authStorage.setUser(data.user);
      onAuthSuccess(data.user);
    } catch (err) {
      setError(err.message || "Authentication failed. Please check your credentials.");
    } finally {
      setLoading(false);
    }
  };

  const fillDemoAccount = (demoEmail, demoPassword, demoName) => {
    setIsLogin(true);
    setEmail(demoEmail);
    setPassword(demoPassword);
    if (demoName) setName(demoName);
    setError("");
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        {/* Header / Brand */}
        <div className="auth-header">
          <div className="logo-icon auth-logo">✓</div>
          <h2>TaskFlow</h2>
          <p className="auth-subtitle">
            {isLogin
              ? "Welcome back! Sign in to access your personal tasks."
              : "Create an account to start organizing your tasks."}
          </p>
        </div>

        {/* DB Status Badge */}
        <div
          className="auth-db-badge"
          style={{
            background: dbStatus?.connected
              ? "rgba(34, 197, 94, 0.12)"
              : "rgba(239, 68, 68, 0.12)",
            color: dbStatus?.connected ? "#22c55e" : "#ef4444",
            border: `1px solid ${
              dbStatus?.connected
                ? "rgba(34, 197, 94, 0.3)"
                : "rgba(239, 68, 68, 0.3)"
            }`,
          }}
        >
          <span
            style={{
              width: "8px",
              height: "8px",
              borderRadius: "50%",
              backgroundColor: dbStatus?.connected ? "#22c55e" : "#ef4444",
              boxShadow: dbStatus?.connected ? "0 0 8px #22c55e" : "none",
            }}
          />
          {dbStatus?.connected ? "MySQL Database Online" : "Server Disconnected"}
        </div>

        {/* Tab Switcher */}
        <div className="auth-tabs">
          <button
            type="button"
            className={isLogin ? "auth-tab active" : "auth-tab"}
            onClick={() => {
              setIsLogin(true);
              setError("");
            }}
          >
            Sign In
          </button>
          <button
            type="button"
            className={!isLogin ? "auth-tab active" : "auth-tab"}
            onClick={() => {
              setIsLogin(false);
              setError("");
            }}
          >
            Create Account
          </button>
        </div>

        {/* Error Notification */}
        {error && (
          <div className="auth-error">
            <span>⚠</span> {error}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="auth-form">
          {!isLogin && (
            <div className="form-group">
              <label>Full Name</label>
              <input
                type="text"
                placeholder="e.g. Sarah Connor"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={loading}
                autoFocus
              />
            </div>
          )}

          <div className="form-group">
            <label>Email Address</label>
            <input
              type="email"
              placeholder="name@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
              autoFocus={isLogin}
            />
          </div>

          <div className="form-group">
            <label>Password</label>
            <div className="password-input-wrap">
              <input
                type={showPassword ? "text" : "password"}
                placeholder="At least 6 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
              />
              <button
                type="button"
                className="toggle-password"
                onClick={() => setShowPassword(!showPassword)}
                tabIndex="-1"
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
          </div>

          <button
            type="submit"
            className="auth-submit-btn"
            disabled={loading}
          >
            {loading ? (
              <span className="auth-spinner"></span>
            ) : isLogin ? (
              "Sign In"
            ) : (
              "Create Account"
            )}
          </button>
        </form>

        {/* Quick Demo Test Buttons */}
        <div className="demo-accounts">
          <span className="demo-title">Quick Demo Login:</span>
          <div className="demo-buttons">
            <button
              type="button"
              className="demo-btn"
              onClick={() => fillDemoAccount("alex@demo.com", "password123", "Alex Dev")}
            >
              👤 Alex (alex@demo.com)
            </button>
            <button
              type="button"
              className="demo-btn"
              onClick={() => fillDemoAccount("sarah@demo.com", "password123", "Sarah Manager")}
            >
              👤 Sarah (sarah@demo.com)
            </button>
          </div>
          <small className="demo-note">
            Tip: If it's your first time, switch to "Create Account" or click sign in if already registered.
          </small>
        </div>
      </div>
    </div>
  );
}
