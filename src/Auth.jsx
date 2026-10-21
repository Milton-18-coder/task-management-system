import { useState } from "react";
import { authApi, authStorage } from "./api";

export default function Auth({ onAuthSuccess, dbStatus, sessionMessage = "" }) {
  const [isLogin, setIsLogin] = useState(true);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState(sessionMessage);
  const [loading, setLoading] = useState(false);

  function switchMode(loginMode) {
    setIsLogin(loginMode);
    setError("");
    setPassword("");
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");

    if (!email.trim() || !password || (!isLogin && !name.trim())) {
      setError("Complete all required fields.");
      return;
    }
    if (!isLogin && (password.length < 8 || password.length > 72)) {
      setError("Use a password between 8 and 72 characters.");
      return;
    }

    setLoading(true);
    try {
      const credentials = { email: email.trim(), password, ...(!isLogin ? { name: name.trim() } : {}) };
      const data = isLogin ? await authApi.login(credentials) : await authApi.register(credentials);
      authStorage.setToken(data.token);
      authStorage.setUser(data.user);
      onAuthSuccess(data.user);
    } catch (requestError) {
      setError(requestError.message || "Authentication failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-container">
      <section className="auth-brand-panel">
        <div className="auth-brand-content">
          <div className="auth-brand-logo"><span>TP</span><strong>TaskPulse</strong></div>
          <div className="auth-value-copy">
            <span className="auth-eyebrow">A calmer way to work</span>
            <h1>Turn scattered work into clear progress.</h1>
            <p>Plan personal tasks, coordinate assignments, and keep every deadline visible in one focused workspace.</p>
          </div>
          <div className="auth-feature-list">
            <div><span>01</span><p><strong>One source of truth</strong>Tasks persist securely in your MySQL workspace.</p></div>
            <div><span>02</span><p><strong>Built for momentum</strong>Move work from to do to done in list or board view.</p></div>
            <div><span>03</span><p><strong>Deadline aware</strong>Keep due work visible with reminders and priority signals.</p></div>
          </div>
        </div>
      </section>

      <section className="auth-form-panel">
        <div className="auth-card">
          <div className="auth-mobile-brand"><span>TP</span><strong>TaskPulse</strong></div>
          <div className="auth-header">
            <span className="auth-kicker">{isLogin ? "WELCOME BACK" : "GET STARTED"}</span>
            <h2>{isLogin ? "Sign in to your workspace" : "Create your TaskPulse account"}</h2>
            <p>{isLogin ? "Pick up where you left off." : "Start organizing your work in a few seconds."}</p>
          </div>

          <div className={`auth-db-badge ${dbStatus?.connected ? "connected" : "disconnected"}`}>
            <span className="connection-dot" />
            {dbStatus?.connected ? "TaskPulse services online" : "Server connection unavailable"}
          </div>

          <div className="auth-tabs" role="tablist" aria-label="Authentication mode">
            <button type="button" role="tab" aria-selected={isLogin} className={isLogin ? "auth-tab active" : "auth-tab"} onClick={() => switchMode(true)}>Sign in</button>
            <button type="button" role="tab" aria-selected={!isLogin} className={!isLogin ? "auth-tab active" : "auth-tab"} onClick={() => switchMode(false)}>Create account</button>
          </div>

          {error && <div className="auth-error" role="alert">{error}</div>}

          <form onSubmit={handleSubmit} className="auth-form">
            {!isLogin && <div className="form-group"><label htmlFor="auth-name">Full name</label><input id="auth-name" type="text" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" maxLength="100" placeholder="Your name" disabled={loading} required autoFocus /></div>}
            <div className="form-group"><label htmlFor="auth-email">Email address</label><input id="auth-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" maxLength="191" placeholder="you@example.com" disabled={loading} required autoFocus={isLogin} /></div>
            <div className="form-group"><label htmlFor="auth-password">Password</label><div className="password-input-wrap"><input id="auth-password" type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={isLogin ? "current-password" : "new-password"} minLength={isLogin ? undefined : 8} maxLength="72" placeholder={isLogin ? "Your password" : "8 to 72 characters"} disabled={loading} required /><button type="button" className="toggle-password" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? "Hide" : "Show"}</button></div></div>
            <button type="submit" className="auth-submit-btn" disabled={loading || !dbStatus?.connected}>{loading ? <><span className="auth-spinner" /> Please wait...</> : isLogin ? "Sign in" : "Create account"}</button>
          </form>
          <p className="auth-security-note">Your password is hashed before it is stored. TaskPulse never keeps plaintext passwords.</p>
        </div>
      </section>
    </main>
  );
}
