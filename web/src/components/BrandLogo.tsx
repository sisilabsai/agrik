import logo from "../assets/logo_header.webp";

type BrandLogoProps = {
  subtitle?: string;
  className?: string;
  compact?: boolean;
};

export default function BrandLogo({ subtitle, className = "", compact = false }: BrandLogoProps) {
  const classes = ["brand-logo", compact ? "compact" : "", className].filter(Boolean).join(" ");
  return (
    <span className={classes}>
      <img className="brand-logo-image" src={logo} alt="AGRIK" />
      {subtitle ? <span className="brand-logo-subtitle">{subtitle}</span> : null}
    </span>
  );
}
