import type pg from "pg";

// Install before the first connect: pg-pool.end() empties its client list
// before idle clients finish ending. Track the actual client end events,
// including clients already being removed by idle eviction when close starts.
export function awaitPoolTermination(pool: pg.Pool): () => Promise<void> {
  const pending = new Set<Promise<void>>();
  pool.on("connect", (client) => {
    const termination = new Promise<void>((resolve) => {
      client.once("end", () => {
        pending.delete(termination);
        resolve();
      });
    });
    pending.add(termination);
  });
  return async () => {
    await pool.end();
    await Promise.all(pending);
  };
}
