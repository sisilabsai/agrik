import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../state/auth";
import { Icon } from "../components/Visuals";
import BrandLogo from "../components/BrandLogo";

const navItems = [
  { label: "Overview", path: "/dashboard", subtitle: "Home", icon: "overview" as const },
  { label: "Farm Profile", path: "/dashboard/farm", subtitle: "Registration & updates", icon: "farm" as const },
  { label: "Market Hub", path: "/dashboard/market", subtitle: "Listings & services", icon: "market" as const },
  { label: "Services", path: "/dashboard/services", subtitle: "AGRIK subscriptions", icon: "services" as const },
  { label: "Subscriptions", path: "/dashboard/subscriptions", subtitle: "Plans & billing", icon: "subscriptions" as const },
  { label: "Farmer Brain", path: "/dashboard/brain", subtitle: "Ask GRIK AI", icon: "brain" as const },
  { label: "History", path: "/dashboard/history", subtitle: "Timeline & activity", icon: "history" as const },
];

export default function FarmerLayout() {
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  const current = useMemo(() => {
    return (
      navItems.find((item) => (item.path === "/dashboard" ? location.pathname === "/dashboard" : location.pathname.startsWith(item.path))) || navItems[0]
    );
  }, [location.pathname]);

  return (
    <div className={`farmer-shell ${menuOpen ? "menu-open" : ""}`}>
      <div className="farmer-backdrop" onClick={() => setMenuOpen(false)} aria-hidden="true" />
      <aside className="farmer-sidebar">
        <div className="farmer-brand">
          <BrandLogo subtitle="Farmer Portal" compact />
        </div>
        <nav className="farmer-nav">
          {navItems.map((item) => (
            <NavLink key={item.path} to={item.path} end={item.path === "/dashboard"} className={({ isActive }) => `farmer-link ${isActive ? "active" : ""}`}>
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
          <button className="farmer-menu-toggle" type="button" onClick={() => setMenuOpen((prev) => !prev)}>
            Menu
          </button>
          <div>
            <div className="label">{current.subtitle}</div>
            <div className="farmer-topbar-heading">{current.label}</div>
          </div>
          <div className="farmer-topbar-actions">
            <div className="farmer-quick-links">
              <NavLink to="/dashboard/brain" className="btn ghost tiny">
                Brain
              </NavLink>
              <NavLink to="/dashboard/market" className="btn ghost tiny">
                Market
              </NavLink>
            </div>
            <div className="farmer-account-pill">
              <div className="farmer-account-name">{user?.phone ?? "Farmer"}</div>
              <div className="farmer-account-role">{user?.role?.replace(/_/g, " ") ?? "farmer"}</div>
            </div>
            <button className="btn ghost small" type="button" onClick={logout}>
              Sign out
            </button>
          </div>
        </header>
        <main className="farmer-content">
          <Outlet />
        </main>
      </section>
    </div>
  );
}
