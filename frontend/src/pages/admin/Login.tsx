import { useState } from "react";
import type { FormEvent } from "react";
import { api, ApiError } from "../../api/client";
import "./AdminApp.css";

interface LoginProps {
  onSuccess: () => void;
}

export function Login({ onSuccess }: LoginProps) {
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.adminLogin(user, password);
      onSuccess();
    } catch (err) {
      if (err instanceof ApiError) {
        setError("Invalid credentials");
      } else {
        setError("Something went wrong. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="admin-login">
      <form className="admin-login-card" onSubmit={handleSubmit}>
        <h1 className="admin-login-title">Studio Admin</h1>
        <p className="admin-login-sub">Sign in to manage your portfolio</p>

        <label className="admin-field">
          <span className="admin-label">Username</span>
          <input
            className="admin-input"
            type="text"
            name="username"
            autoComplete="username"
            autoFocus
            value={user}
            onChange={(e) => setUser(e.target.value)}
            required
          />
        </label>

        <label className="admin-field">
          <span className="admin-label">Password</span>
          <input
            className="admin-input"
            type="password"
            name="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>

        {error && <div className="admin-login-error">{error}</div>}

        <button type="submit" className="admin-btn admin-btn-primary" disabled={submitting}>
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
