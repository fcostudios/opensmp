export function DecisionDialogError({
  message,
  testId,
}: {
  readonly message: string | null;
  readonly testId: string;
}) {
  if (!message) return null;
  return (
    <p
      aria-live="assertive"
      className="mt-3 rounded bg-error-bg p-3 text-error-text"
      data-testid={testId}
      role="alert"
    >
      {message}
    </p>
  );
}
