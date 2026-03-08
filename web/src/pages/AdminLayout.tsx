import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useMemo, useState, useEffect } from "react";
import { useAdminAuth } from "../state/adminAuth";
import { Icon } from "../components/Visuals";
import BrandLogo from "../components/BrandLogo";

const navItems = [
  { label: "Overview", path: "/admin", subtitle: "Ops snapshot", icon: "overview" as const },
  { label: "Users", path: "/admin/users", subtitle: "Roles & verification", icon: "users" as const },
  { label: "Listings", path: "/admin/listings", subtitle: "Moderation queue", icon: "listings" as const },
  { label: "Prices", path: "/admin/prices", subtitle: "Market pricing", icon: "prices" as const },
  { label: "Alerts", path: "/admin/alerts", subtitle: "Weather & price alerts", icon: "alerts" as const },
  { label: "Services", path: "/admin/services", subtitle: "Platform services", icon: "services" as const },
  { label: "Activity", path: "/admin/activity", subtitle: "Audit log", icon: "activity" as const },
];

export default function AdminLayout() {
  const { admin, logout } = useAdminAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  const current = useMemo(() => {
    return (
      navItems.find((item) =>
        item.path === "/admin" ? location.pathname === "/admin" : location.pathname.startsWith(item.path)
      ) || navItems[0]
    );
  }, [location.pathname]);

  return (
    <div className={`admin-shell ${sidebarOpen ? "sidebar-open" : ""}`}>
      <div className="admin-backdrop" onClick={() => setSidebarOpen(false)} aria-hidden="true" />
      <aside className="admin-sidebar">
        <div className="admin-brand">
          <BrandLogo subtitle="Admin Control" compact />
        </div>
        <nav className="admin-nav">
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === "/admin"}
              className={({ isActive }) => `admin-link ${isActive ? "active" : ""}`}
            >
              <span className="admin-link-main">
                <span className="nav-icon">
                  <Icon name={item.icon} size={16} />
                </span>
                <span className="admin-link-label">{item.label}</span>
              </span>
              <span className="admin-link-sub">{item.subtitle}</span>
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="admin-main">
        <header className="admin-topbar">
          <button className="admin-menu-toggle" type="button" onClick={() => setSidebarOpen((prev) => !prev)}>
            Menu
          </button>
          <div>
            <div className="label">{current.subtitle}</div>
            <div className="admin-topbar-heading">{current.label}</div>
          </div>
          <div className="admin-topbar-actions">
            <NavLink className="btn ghost small" to="/admin/prices">
              Publish price
            </NavLink>
            <NavLink className="btn ghost small" to="/admin/listings">
              Review listings
            </NavLink>
            <div className="admin-profile">
              <div className="admin-avatar">{admin?.email?.charAt(0).toUpperCase() || "A"}</div>
              <div className="admin-profile-text">
                <div className="admin-profile-name">{admin?.email || "Admin"}</div>
                <div className="admin-profile-meta">Admin</div>
              </div>
            </div>
            <button className="btn ghost small" type="button" onClick={logout}>
              Sign out
            </button>
          </div>
        </header>

        <main className="admin-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
