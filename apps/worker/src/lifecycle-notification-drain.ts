type Dispatcher = {
  close(): Promise<void>;
  drain(options: { limit: number }): Promise<unknown>;
};

export function createLifecycleNotificationDrainLoop(options: {
  batchSize?: number;
  clearIntervalFn?: typeof clearInterval;
  dispatcher: Dispatcher;
  intervalMs?: number;
  onError: (error: unknown) => void;
  setIntervalFn?: typeof setInterval;
}) {
  const batchSize = options.batchSize ?? 100;
  const intervalMs = options.intervalMs ?? 60_000;
  const setIntervalFn = options.setIntervalFn ?? setInterval;
  const clearIntervalFn = options.clearIntervalFn ?? clearInterval;
  let timer: ReturnType<typeof setInterval> | undefined;
  let inFlight: Promise<void> | undefined;
  let stopped = true;

  const run = (): void => {
    if (stopped || inFlight) return;
    inFlight = options.dispatcher
      .drain({ limit: batchSize })
      .then(() => undefined)
      .catch(options.onError)
      .finally(() => {
        inFlight = undefined;
      });
  };

  return {
    start(): void {
      if (!stopped) return;
      stopped = false;
      run();
      timer = setIntervalFn(run, intervalMs);
    },

    async stop(): Promise<void> {
      stopped = true;
      if (timer) {
        clearIntervalFn(timer);
        timer = undefined;
      }
      await inFlight;
      await options.dispatcher.close();
    },
  };
}
