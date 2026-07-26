import "./freshness-label.css";

export type UiLocale = "es-EC" | "en-US";

const staleAfterMilliseconds = 48 * 60 * 60 * 1000;

export function FreshnessLabel({
  syncedAt,
  now,
  locale,
  prefix,
  staleLabel,
}: {
  syncedAt: Date;
  now: Date;
  locale: UiLocale;
  prefix: string;
  staleLabel: string;
}) {
  const stale = now.getTime() - syncedAt.getTime() > staleAfterMilliseconds;
  const formatted = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(syncedAt);
  return (
    <span
      className={`freshness-label freshness-label--${stale ? "stale" : "fresh"}`}
    >
      {stale ? (
        <span className="freshness-label__stale-marker">{staleLabel}: </span>
      ) : null}
      {prefix} <time dateTime={syncedAt.toISOString()}>{formatted}</time>
    </span>
  );
}
