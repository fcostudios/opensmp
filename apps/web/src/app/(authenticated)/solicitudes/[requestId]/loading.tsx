export default function RequestRecordLoading() {
  return (
    <div
      aria-busy="true"
      className="m-6 space-y-4"
      data-testid="request_record_loading"
    >
      <div className="h-20 animate-pulse rounded bg-surface-muted" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="h-24 animate-pulse rounded bg-surface-muted" />
        <div className="h-24 animate-pulse rounded bg-surface-muted" />
        <div className="h-24 animate-pulse rounded bg-surface-muted" />
        <div className="h-24 animate-pulse rounded bg-surface-muted" />
      </div>
      <div className="h-64 animate-pulse rounded bg-surface-muted" />
    </div>
  );
}
