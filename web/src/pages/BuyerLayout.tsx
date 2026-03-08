import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../state/auth";
import { Icon } from "../components/Visuals";
import BrandLogo from "../components/BrandLogo";
import MobileFabMenu from "../components/MobileFabMenu";

const navItems = [
  { label: "Buyer Dashboard", path: "/buyer", subtitle: "Demand overview", icon: "overview" as const },
  { label: "Marketplace", path: "/buyer/market", subtitle: "Find produce", icon: "market" as const },
];

export default function BuyerLayout() {
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  const current = useMemo(() => {
    return (
      navItems.find((item) => (item.path === "/buyer" ? location.pathname === "/buyer" : location.pathname.startsWith(item.path))) || navItems[0]
    );
  }, [location.pathname]);

  return (
    <div className={`farmer-shell ${menuOpen ? "menu-open" : ""}`}>
      <div className="farmer-backdrop" onClick={() => setMenuOpen(false)} aria-hidden="true" />
      <aside className="farmer-sidebar">
        <div className="farmer-brand">
          <BrandLogo subtitle="Buyer Portal" compact />
        </div>
        <nav className="farmer-nav">
          {navItems.map((item) => (
            <NavLink key={item.path} to={item.path} end={item.path === "/buyer"} className={({ isActive }) => `farmer-link ${isActive ? "active" : ""}`}>
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
              <div className="farmer-account-name">{user?.phone ?? "Buyer"}</div>
              <div className="farmer-account-role">{user?.role?.replace(/_/g, " ") ?? "buyer"}</div>
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
            { label: "Marketplace", to: "/buyer/market", icon: "market" },
            { label: "Overview", to: "/buyer", icon: "overview" },
            { label: "Sign out", icon: "shield", onClick: logout },
          ]}
        />
      </section>
    </div>
  );
}
