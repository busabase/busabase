export function formatDate(value: string | null | undefined) {
  if (!value) {
    return "Not set";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

// Short "Jul 11" form for dense list rows — mirrors formatListTime in
// packages/busabase-core/src/domains/dashboard/helpers/format.ts. Use
// formatDate above for detail screens where the full date/time is wanted.
export function formatListTime(value: string | null | undefined) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

export function shortId(id: string) {
  return id.length > 10 ? `${id.slice(0, 6)}...${id.slice(-4)}` : id;
}

export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value % 1 === 0 ? value : value.toFixed(1)} ${units[exponent]}`;
}
