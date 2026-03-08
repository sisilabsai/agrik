type IconName =
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

type IconProps = {
  name: IconName;
  size?: number;
  className?: string;
  title?: string;
};

const strokeProps = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function iconPaths(name: IconName) {
  switch (name) {
    case "overview":
      return (
        <>
          <rect x="3.5" y="3.5" width="7" height="7" rx="1.8" {...strokeProps} />
          <rect x="13.5" y="3.5" width="7" height="4.6" rx="1.8" {...strokeProps} />
          <rect x="13.5" y="10.5" width="7" height="10" rx="1.8" {...strokeProps} />
          <rect x="3.5" y="13.5" width="7" height="7" rx="1.8" {...strokeProps} />
        </>
      );
    case "farm":
      return (
        <>
          <path d="M3.5 11.5 12 4.5l8.5 7" {...strokeProps} />
          <path d="M6 10.7v8.8h12v-8.8" {...strokeProps} />
          <path d="M10.2 19.5v-5.2h3.6v5.2" {...strokeProps} />
          <path d="M6.5 6.8h2.8" {...strokeProps} />
        </>
      );
    case "services":
      return (
        <>
          <circle cx="12" cy="12" r="3.5" {...strokeProps} />
          <path d="m12 2.8 1.3 2.8 3-.1.6 2.9 2.7 1.1-1.1 2.7 1.9 2.2-2.1 2.1.7 2.8-2.8.8-1.3 2.7-2.9-1-2.9 1-1.3-2.7-2.8-.8.7-2.8-2.1-2.1 1.9-2.2-1.1-2.7 2.7-1.1.6-2.9 3 .1L12 2.8Z" {...strokeProps} />
        </>
      );
    case "subscriptions":
      return (
        <>
          <rect x="3.5" y="6" width="17" height="12.5" rx="2.5" {...strokeProps} />
          <path d="M3.5 10.5h17" {...strokeProps} />
          <path d="M7.5 14.2h4.4" {...strokeProps} />
          <path d="M15.1 14.2h1.4" {...strokeProps} />
        </>
      );
    case "brain":
      return (
        <>
          <path d="M8.2 8.4a3.2 3.2 0 1 1 6.4 0v7.2H8.2V8.4Z" {...strokeProps} />
          <path d="M8.2 12H5.8a2.3 2.3 0 0 1 0-4.6h1" {...strokeProps} />
          <path d="M14.6 12H18a2.3 2.3 0 0 0 0-4.6h-1" {...strokeProps} />
          <path d="M9.5 20h5" {...strokeProps} />
          <path d="M8.8 16.4h6.4" {...strokeProps} />
        </>
      );
    case "history":
      return (
        <>
          <circle cx="12" cy="12" r="8.6" {...strokeProps} />
          <path d="M12 7.2v5.2l3.3 2.2" {...strokeProps} />
          <path d="M7.4 3.8 5.8 2.5M18.6 3.8l1.6-1.3" {...strokeProps} />
        </>
      );
    case "users":
      return (
        <>
          <circle cx="9.2" cy="9" r="2.8" {...strokeProps} />
          <path d="M4.8 18a4.4 4.4 0 0 1 8.8 0" {...strokeProps} />
          <circle cx="16.8" cy="9.6" r="2.2" {...strokeProps} />
          <path d="M14.3 17.8a3.9 3.9 0 0 1 5 0" {...strokeProps} />
        </>
      );
    case "listings":
      return (
        <>
          <rect x="4" y="4.5" width="16" height="15" rx="2.2" {...strokeProps} />
          <path d="M7.5 8.2h9M7.5 11.8h9M7.5 15.4h6.2" {...strokeProps} />
          <circle cx="17.8" cy="15.4" r="1.8" {...strokeProps} />
        </>
      );
    case "prices":
      return (
        <>
          <path d="M6.5 17.8 10 13l2.6 2.3 4.9-6.2" {...strokeProps} />
          <path d="M17.5 10.5V6.6h-3.8" {...strokeProps} />
          <path d="M4.2 20.5h15.6" {...strokeProps} />
        </>
      );
    case "alerts":
      return (
        <>
          <path d="M12 3.3a5.2 5.2 0 0 0-5.2 5.2v2.8l-1.8 4h14l-1.8-4V8.5A5.2 5.2 0 0 0 12 3.3Z" {...strokeProps} />
          <path d="M9.6 18a2.4 2.4 0 0 0 4.8 0" {...strokeProps} />
        </>
      );
    case "activity":
      return (
        <>
          <path d="M3.5 12h4l2.2-4.2 3.2 8.4 2.4-4.2h5.2" {...strokeProps} />
          <path d="M3.5 20.5h17" {...strokeProps} />
        </>
      );
    case "weather":
      return (
        <>
          <path d="M8.2 15.5h9a3 3 0 0 0 .2-6 4.8 4.8 0 0 0-9.1-1.2A3.6 3.6 0 0 0 8.2 15.5Z" {...strokeProps} />
          <path d="m9 17.8-.8 2m3-2-.8 2m3-2-.8 2" {...strokeProps} />
        </>
      );
    case "market":
      return (
        <>
          <path d="M3.5 8.2 12 3.5l8.5 4.7v10.1L12 22l-8.5-3.7z" {...strokeProps} />
          <path d="M12 10.4v11.5M3.8 8.4 12 13l8.2-4.6" {...strokeProps} />
        </>
      );
    case "finance":
      return (
        <>
          <path d="M12 3.5v17" {...strokeProps} />
          <path d="M15.9 7.6a4 4 0 0 0-7.8 1c0 2.1 1.8 3.1 3.9 3.7s3.9 1.5 3.9 3.6a4 4 0 0 1-7.8 1" {...strokeProps} />
        </>
      );
    case "sms":
      return (
        <>
          <rect x="3.5" y="5" width="17" height="13.5" rx="2.2" {...strokeProps} />
          <path d="m4.8 7.3 7.2 5 7.2-5" {...strokeProps} />
        </>
      );
    case "voice":
      return (
        <>
          <rect x="9.2" y="4.2" width="5.6" height="9.8" rx="2.8" {...strokeProps} />
          <path d="M6.7 10.8a5.3 5.3 0 0 0 10.6 0M12 16.2v3.3M9.5 19.5h5" {...strokeProps} />
        </>
      );
    case "app":
      return (
        <>
          <rect x="7.2" y="3.2" width="9.6" height="17.6" rx="2.2" {...strokeProps} />
          <path d="M10.4 6.1h3.2M11.2 17.4h1.6" {...strokeProps} />
        </>
      );
    case "dash":
      return (
        <>
          <path d="M4 18.5a8 8 0 1 1 16 0" {...strokeProps} />
          <path d="M12 10.5 16 14" {...strokeProps} />
          <path d="M12 6.8v1.4M6.9 9.2 8 10.2M17.1 9.2 16 10.2" {...strokeProps} />
        </>
      );
    case "ai":
      return (
        <>
          <path d="M8.2 8.5 12 3.8l3.8 4.7v7L12 20.2l-3.8-4.7z" {...strokeProps} />
          <path d="M12 8.6v6.8M9.3 11.5h5.4" {...strokeProps} />
        </>
      );
    case "climate":
      return (
        <>
          <path d="M12 3.2c4.9 2.6 6.9 6.2 6.9 9.4 0 4.2-3.1 7.2-6.9 8.2-3.8-1-6.9-4-6.9-8.2 0-3.2 2-6.8 6.9-9.4Z" {...strokeProps} />
          <path d="M12 7.8c1.9 1.1 2.8 2.6 2.8 4 0 1.9-1.3 3.2-2.8 3.7-1.5-.5-2.8-1.8-2.8-3.7 0-1.4.9-2.9 2.8-4Z" {...strokeProps} />
        </>
      );
    case "shield":
      return (
        <>
          <path d="M12 3.3 18.8 6v5.9c0 4.4-2.9 7.7-6.8 8.8-3.9-1.1-6.8-4.4-6.8-8.8V6Z" {...strokeProps} />
          <path d="m9 12 2 2.2 4-4.4" {...strokeProps} />
        </>
      );
    case "spark":
      return (
        <>
          <path d="m12 3.2 1.8 4.2 4.2 1.8-4.2 1.8-1.8 4.2-1.8-4.2-4.2-1.8 4.2-1.8z" {...strokeProps} />
          <circle cx="18.3" cy="17.8" r="1.8" {...strokeProps} />
          <circle cx="6" cy="18.4" r="1.2" {...strokeProps} />
        </>
      );
    case "copy":
      return (
        <>
          <rect x="8" y="7.5" width="11.5" height="13" rx="2.1" {...strokeProps} />
          <path d="M6.5 16.6H5.8a2.3 2.3 0 0 1-2.3-2.3V5.8a2.3 2.3 0 0 1 2.3-2.3h8.5a2.3 2.3 0 0 1 2.3 2.3v.7" {...strokeProps} />
        </>
      );
    case "download":
      return (
        <>
          <path d="M12 3.5v11.2" {...strokeProps} />
          <path d="m7.8 10.8 4.2 4.2 4.2-4.2" {...strokeProps} />
          <path d="M4 19.5h16" {...strokeProps} />
        </>
      );
    case "plus":
      return (
        <>
          <circle cx="12" cy="12" r="8.6" {...strokeProps} />
          <path d="M12 8v8M8 12h8" {...strokeProps} />
        </>
      );
    case "upload":
      return (
        <>
          <path d="M12 20.5V9.3" {...strokeProps} />
          <path d="m7.8 13 4.2-4.2 4.2 4.2" {...strokeProps} />
          <path d="M4 4.5h16v3.6H4z" {...strokeProps} />
        </>
      );
    case "camera":
      return (
        <>
          <rect x="3.5" y="7.2" width="17" height="11.8" rx="2.2" {...strokeProps} />
          <path d="M8.2 7.2 9.8 4.8h4.4L15.8 7.2" {...strokeProps} />
          <circle cx="12" cy="13" r="3.2" {...strokeProps} />
        </>
      );
    case "video":
      return (
        <>
          <rect x="3.5" y="6.2" width="12.5" height="11.6" rx="2" {...strokeProps} />
          <path d="m16 10.2 4.6-2.4v8.4L16 13.8" {...strokeProps} />
          <path d="M8.2 9.5v5M10.7 12H5.7" {...strokeProps} />
        </>
      );
    case "trash":
      return (
        <>
          <path d="M4.5 6.5h15" {...strokeProps} />
          <path d="M9.2 3.8h5.6l.6 2.7H8.6z" {...strokeProps} />
          <rect x="6.2" y="6.5" width="11.6" height="13.7" rx="2" {...strokeProps} />
          <path d="M10 10.2v6M14 10.2v6" {...strokeProps} />
        </>
      );
    case "send":
      return (
        <>
          <path d="m3.8 11.8 16.8-7-4.5 15.1-4-5-4.8-3.1Z" {...strokeProps} />
        </>
      );
    case "play":
      return (
        <>
          <circle cx="12" cy="12" r="8.6" {...strokeProps} />
          <path d="m10.3 8.8 5 3.2-5 3.2Z" {...strokeProps} />
        </>
      );
    case "pause":
      return (
        <>
          <circle cx="12" cy="12" r="8.6" {...strokeProps} />
          <path d="M10.1 8.6v6.8M13.9 8.6v6.8" {...strokeProps} />
        </>
      );
    case "stop":
      return (
        <>
          <circle cx="12" cy="12" r="8.6" {...strokeProps} />
          <rect x="9.2" y="9.2" width="5.6" height="5.6" rx="1.2" {...strokeProps} />
        </>
      );
    case "wave":
      return (
        <>
          <path d="M3.8 12h2.4l1.3-3.1 2.2 8 2.1-6 2 3.2 1.7-4.1 1.9 2.9h2.8" {...strokeProps} />
          <path d="M3.8 18.8h16.4" {...strokeProps} />
        </>
      );
    default:
      return <circle cx="12" cy="12" r="8" {...strokeProps} />;
  }
}

export function Icon({ name, size = 20, className, title }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
    >
      {title ? <title>{title}</title> : null}
      {iconPaths(name)}
    </svg>
  );
}

type GraphicProps = {
  className?: string;
};

export function HeroFarmGraphic({ className }: GraphicProps) {
  return (
    <svg viewBox="0 0 560 320" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="agrik-hero-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#e8f5eb" />
          <stop offset="100%" stopColor="#d4ebdd" />
        </linearGradient>
        <linearGradient id="agrik-hero-field" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#7fc08f" />
          <stop offset="100%" stopColor="#1f6f3d" />
        </linearGradient>
      </defs>

      <rect x="0" y="0" width="560" height="320" rx="32" fill="url(#agrik-hero-bg)" />
      <circle cx="455" cy="74" r="42" fill="#f2d3a6" />
      <path d="M0 208c82-38 160-52 239-44 60 6 114 27 171 38 53 11 98 10 150-4v122H0V208Z" fill="url(#agrik-hero-field)" />
      <path d="M46 205c66-28 124-38 182-31 44 5 84 20 126 30 59 14 121 15 182 3" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="6" strokeLinecap="round" />

      <rect x="296" y="86" width="155" height="196" rx="24" fill="#ffffff" stroke="rgba(11,11,11,0.1)" strokeWidth="2" />
      <rect x="320" y="112" width="107" height="101" rx="14" fill="#e9f4ec" />
      <path d="M340 189c16-22 28-34 42-34 17 0 20 17 32 17 10 0 17-10 20-19" fill="none" stroke="#1f6f3d" strokeWidth="4" strokeLinecap="round" />
      <path d="M335 229h86" stroke="#96b7a0" strokeWidth="6" strokeLinecap="round" />
      <path d="M335 248h61" stroke="#96b7a0" strokeWidth="6" strokeLinecap="round" />
      <circle cx="374" cy="99" r="5" fill="#95b4a0" />

      <path d="M126 212c0-48 28-88 66-108 38 20 66 60 66 108" fill="#0f5731" />
      <path d="M192 104v108" stroke="#c8e2cf" strokeWidth="6" strokeLinecap="round" />
      <path d="M148 158c16-5 29-5 44 0M192 164c15-5 28-5 43 0" stroke="#c8e2cf" strokeWidth="5" strokeLinecap="round" />

      <circle cx="472" cy="144" r="19" fill="#ffffff" />
      <path d="M467 143h10M472 138v10" stroke="#1f6f3d" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function SignalMeshGraphic({ className }: GraphicProps) {
  return (
    <svg viewBox="0 0 500 250" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="agrik-mesh-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f5efe3" />
          <stop offset="100%" stopColor="#e5f1e7" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="500" height="250" rx="28" fill="url(#agrik-mesh-bg)" />
      <circle cx="92" cy="125" r="12" fill="#1f6f3d" />
      <circle cx="191" cy="75" r="12" fill="#1f6f3d" />
      <circle cx="297" cy="125" r="12" fill="#1f6f3d" />
      <circle cx="402" cy="86" r="12" fill="#1f6f3d" />
      <circle cx="402" cy="170" r="12" fill="#c59f63" />
      <circle cx="260" cy="195" r="12" fill="#c59f63" />

      <path d="M92 125 191 75 297 125 402 86" stroke="#1f6f3d" strokeWidth="4" fill="none" strokeLinecap="round" />
      <path d="M297 125 402 170 260 195 92 125" stroke="#c59f63" strokeWidth="4" fill="none" strokeLinecap="round" />

      <rect x="173" y="58" width="36" height="36" rx="10" fill="#fff" />
      <path d="M184 79h14M191 72v14" stroke="#1f6f3d" strokeWidth="3" strokeLinecap="round" />
      <rect x="385" y="152" width="34" height="34" rx="9" fill="#fff" />
      <path d="M393 173h18" stroke="#1f6f3d" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
