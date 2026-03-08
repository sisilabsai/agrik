import { Link, useLocation } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { Icon } from "./Visuals";

type FabIconName =
  | "overview"
  | "farm"
  | "services"
  | "subscriptions"
  | "brain"
  | "history"
  | "users"
  | "listings"
  | "prices"
  | "alerts"
  | "activity"
  | "weather"
  | "market"
  | "finance"
  | "sms"
  | "voice"
  | "app"
  | "dash"
  | "ai"
  | "climate"
  | "shield"
  | "spark"
  | "copy"
  | "download"
  | "plus"
  | "upload"
  | "camera"
  | "video"
  | "trash"
  | "send"
  | "play"
  | "pause"
  | "stop"
  | "wave";

type FabAction = {
  label: string;
  icon: FabIconName;
  to?: string;
  onClick?: () => void;
};

type MobileFabMenuProps = {
  title: string;
  actions: FabAction[];
};

export default function MobileFabMenu({ title, actions }: MobileFabMenuProps) {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    let lastY = window.scrollY;
    let ticking = false;

    const update = () => {
      const currentY = window.scrollY;
      const delta = currentY - lastY;
      if (currentY < 120 || delta < -14) {
        setVisible(true);
      } else if (delta > 18) {
        setVisible(false);
        setOpen(false);
      }
      lastY = currentY;
      ticking = false;
    };

    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(update);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const classes = useMemo(
    () => `mobile-fab${open ? " open" : ""}${visible ? "" : " hidden"}`,
    [open, visible]
  );

  return (
    <div className={classes}>
      <div className="mobile-fab-actions" aria-hidden={!open}>
        {actions.map((action) =>
          action.to ? (
            <Link key={`${title}-${action.label}`} to={action.to} className="mobile-fab-action" onClick={() => setOpen(false)}>
              <span className="mobile-fab-action-label">{action.label}</span>
              <span className="mobile-fab-action-icon">
                <Icon name={action.icon} size={16} />
              </span>
            </Link>
          ) : (
            <button
              key={`${title}-${action.label}`}
              type="button"
              className="mobile-fab-action"
              onClick={() => {
                setOpen(false);
                action.onClick?.();
              }}
            >
              <span className="mobile-fab-action-label">{action.label}</span>
              <span className="mobile-fab-action-icon">
                <Icon name={action.icon} size={16} />
              </span>
            </button>
          )
        )}
      </div>
      <button
        type="button"
        className="mobile-fab-trigger"
        aria-expanded={open}
        aria-label={open ? `Close ${title} actions` : `Open ${title} actions`}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="mobile-fab-trigger-icon">
          <Icon name={open ? "stop" : "spark"} size={18} />
        </span>
        <span>{open ? "Close" : title}</span>
      </button>
    </div>
  );
}
