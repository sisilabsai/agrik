import { Link, NavLink, Outlet } from "react-router-dom";
import { useState } from "react";
import { useAuth } from "../state/auth";
import BrandLogo from "../components/BrandLogo";

export default function AppLayout() {
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const dashboardPath =
    user?.role === "service_provider" || user?.role === "input_supplier"
      ? "/provider"
      : user?.role === "buyer" || user?.role === "offtaker"
      ? "/buyer"
      : "/dashboard";

  return (
    <div className="app-shell">
      <header className={`topbar${menuOpen ? " open" : ""}`}>
        <Link to="/" className="brand" onClick={() => setMenuOpen(false)}>
          <BrandLogo />
        </Link>
        <button
          className="menu-toggle"
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          aria-expanded={menuOpen}
          aria-label="Toggle navigation"
        >
          Menu
        </button>
        <nav className="nav-links" onClick={() => setMenuOpen(false)}>
          <NavLink to="/">Home</NavLink>
          <NavLink to="/marketplace">Marketplace</NavLink>
          {user ? <NavLink to={dashboardPath}>Dashboard</NavLink> : <NavLink to="/auth">Sign in</NavLink>}
          {user?.role === "admin" && <NavLink to="/admin">Admin</NavLink>}
        </nav>
        <div className="topbar-actions">
          {user ? (
            <button className="btn ghost" onClick={logout}>
              Sign out
            </button>
          ) : (
            <Link className="btn" to="/auth" onClick={() => setMenuOpen(false)}>
              Get started
            </Link>
          )}
        </div>
      </header>
      <main className="page">
        <Outlet />
      </main>
      <footer className="footer">
        <div>AGRIK (c) 2026</div>
        <div>Built for smallholder farmers</div>
      </footer>
    </div>
  );
}
