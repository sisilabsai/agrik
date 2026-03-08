import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../state/auth";
import { Icon } from "../components/Visuals";
import BrandLogo from "../components/BrandLogo";
import MobileFabMenu from "../components/MobileFabMenu";

const navItems = [
  { label: "Overview", path: "/provider", subtitle: "Command center", icon: "overview" as const },
  { label: "Services", path: "/provider/services", subtitle: "Catalog ops", icon: "services" as const },
  { label: "Leads", path: "/provider/leads", subtitle: "Demand pipeline", icon: "market" as const },
  { label: "Marketing", path: "/provider/marketing", subtitle: "Growth studio", icon: "spark" as const },
];

export default function ProviderLayout() {
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  const current = useMemo(() => {
    return (
      navItems.find((item) => (item.path === "/provider" ? location.pathname === "/provider" : location.pathname.startsWith(item.path))) || navItems[0]
    );
  }, [location.pathname]);

  return (
    <div className={`farmer-shell ${menuOpen ? "menu-open" : ""}`}>
      <div className="farmer-backdrop" onClick={() => setMenuOpen(false)} aria-hidden="true" />
      <aside className="farmer-sidebar">
        <div className="farmer-brand">
          <BrandLogo subtitle="Provider Portal" compact />
        </div>
        <nav className="farmer-nav">
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === "/provider"}
              className={({ isActive }) => `farmer-link ${isActive ? "active" : ""}`}
            >
              <span className="farmer-link-main">
                <span className="nav-icon">
                  <Icon name={item.icon} size={16} />
                </span>
                <span className="farmer-link-label">{item.label}</span>
              </span>
              <span className="farmer-link-sub">{item.subtitle}</span>
            </NavLink>
          ))}
        </nav>
      </aside>

      <section className="farmer-main">
        <header className="farmer-topbar">
          <div className="dashboard-topbar-main">
            <button className="farmer-menu-toggle" type="button" onClick={() => setMenuOpen((prev) => !prev)}>
              Menu
            </button>
            <div className="dashboard-topbar-copy">
              <div className="label">{current.subtitle}</div>
              <div className="farmer-topbar-heading">{current.label}</div>
            </div>
          </div>
          <div className="farmer-topbar-actions">
            <div className="farmer-account-pill">
              <div className="farmer-account-name">{user?.phone ?? "Provider"}</div>
              <div className="farmer-account-role">{user?.role?.replace(/_/g, " ") ?? "service provider"}</div>
            </div>
            <button className="btn ghost small" type="button" onClick={logout}>
              Sign out
            </button>
          </div>
        </header>
        <main className="farmer-content">
          <Outlet />
        </main>
        <MobileFabMenu
          title="Actions"
          actions={[
            { label: "Services", to: "/provider/services", icon: "services" },
            { label: "Leads", to: "/provider/leads", icon: "market" },
            { label: "Marketing", to: "/provider/marketing", icon: "spark" },
            { label: "Overview", to: "/provider", icon: "overview" },
            { label: "Sign out", icon: "shield", onClick: logout },
          ]}
        />
      </section>
    </div>
  );
}
