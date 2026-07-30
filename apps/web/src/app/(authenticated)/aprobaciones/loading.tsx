export default function ApprovalQueueLoading() {
  return (
    <div
      aria-busy="true"
      className="m-6 space-y-4"
      data-testid="approval_loading"
    >
      <div className="h-16 animate-pulse rounded bg-surface-muted" />
      <div className="h-48 animate-pulse rounded bg-surface-muted" />
    </div>
  );
}
