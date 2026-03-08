type AdminActiveDateChipsProps = {
  from?: string;
  to?: string;
  label?: string;
};

function formatChipDate(value?: string): string {
  if (!value) return "";
  const parsed = new Date(`${value}T00:00:00.000`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function AdminActiveDateChips({ from, to, label = "Date filter active" }: AdminActiveDateChipsProps) {
  const fromLabel = formatChipDate(from);
  const toLabel = formatChipDate(to);
  if (!fromLabel && !toLabel) return null;

  return (
    <div className="admin-active-filters" role="status" aria-live="polite">
      <span className="admin-filter-chip admin-filter-chip-accent">{label}</span>
      {fromLabel && (
        <span className="admin-filter-chip">
          From <strong>{fromLabel}</strong>
        </span>
      )}
      {toLabel && (
        <span className="admin-filter-chip">
          To <strong>{toLabel}</strong>
        </span>
      )}
    </div>
  );
}
