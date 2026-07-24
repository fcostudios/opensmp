// StatusPill consumes the semantic token variants defined in status-pill.css.
import "./status-pill.css";

export type StatusKind = "success" | "pending" | "attention" | "neutral";

export interface StatusPillProps {
  kind: StatusKind;
  /** Text label — status is NEVER color-only (a11y baseline). */
  label: string;
}

export function StatusPill({ kind, label }: StatusPillProps) {
  return (
    <span className={`status-pill status-pill--${kind}`}>
      {label}
    </span>
  );
}
