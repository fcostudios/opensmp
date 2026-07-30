export default function RequestListLoading() {
  return (
    <div
      aria-busy="true"
      className="m-6 space-y-4"
      data-testid="requests_loading"
    >
      <div className="h-16 animate-pulse rounded bg-surface-muted" />
      <div className="h-28 animate-pulse rounded bg-surface-muted" />
      <div className="h-64 animate-pulse rounded bg-surface-muted" />
    </div>
  );
}
