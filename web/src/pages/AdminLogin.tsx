import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAdminAuth } from "../state/adminAuth";

export default function AdminLogin() {
  const navigate = useNavigate();
  const { login, error } = useAdminAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleCredentials = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setStatus(null);
    try {
      await login(email.trim(), password);
      setStatus("Logged in successfully.");
      navigate("/admin");
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="admin-auth-page">
      <div className="admin-auth-card">
        <div className="label">Admin Access</div>
        <h2>Secure Console</h2>
        <p className="muted">Use your admin email and password to access the console.</p>

        <form className="admin-auth-form" onSubmit={handleCredentials}>
          <label className="field">
            Admin email
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="admin@company.com"
              required
            />
          </label>
          <label className="field">
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="********"
              required
            />
          </label>
          <button className="btn" type="submit" disabled={loading}>
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>

        {(status || error) && <p className={`status ${status === "Logged in successfully." ? "" : "error"}`}>{status ?? error}</p>}
      </div>
    </div>
  );
}
