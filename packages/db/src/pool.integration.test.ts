import pg from "pg";
import { expect, it } from "vitest";

import { awaitPoolTermination } from "./pool.js";
import { createPostgresFixture } from "./testing/postgres-container.js";

it("CHG-117 close awaits every real client termination, including released clients", async () => {
  const fixture = await createPostgresFixture();
  const pool = new pg.Pool({ connectionString: fixture.appUrl });
  const close = awaitPoolTermination(pool);
  const removed: pg.PoolClient[] = [];
  pool.on("remove", (client) => removed.push(client));
  let closed = false;
  try {
    const clients = await Promise.all([pool.connect(), pool.connect()]);
    await Promise.all(clients.map((client) => client.query("SELECT 1")));
    clients.forEach((client) => client.release());
    await close();
    closed = true;
    expect(removed).toHaveLength(clients.length);
    for (const client of clients) expect(removed.includes(client)).toBe(true);
    expect(pool.totalCount).toBe(0);
  } finally {
    if (!closed) await pool.end();
    await fixture.stop();
  }
}, 120_000);
