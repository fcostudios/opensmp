// status-pill — SSOT atom for status colors (IMP-241).
// The ONLY component allowed to render the semantic hexes: #fee2e2 #dc2626 #991b1b #f2f2f2 #949394 #595756 #fef3c7 #d97706 #92400e #166534 #dcfce7 #16a34a
import "./status-pill.css";

export type StatusKind = 'error_bg' | 'error_dot' | 'error_text' | 'neutral_bg' | 'neutral_dot' | 'neutral_text' | 'pending_bg' | 'pending_dot' | 'pending_text' | 'success' | 'success_bg' | 'success_dot';

export interface StatusPillProps {
  kind: StatusKind;
  /** Text label — status is NEVER color-only (a11y baseline). */
  label: string;
}

export function StatusPill({ kind, label }: StatusPillProps) {
  return (
    <span className={`status-pill status-pill--${kind.replace(/_/g, "-")}`}>
      {label}
    </span>
  );
}
