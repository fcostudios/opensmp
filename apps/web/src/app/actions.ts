"use server";

// IMP-238 — server actions entrypoint for the serverless backend.
// Mutations run here against the shared Drizzle client from @smp/db.
import { sql } from "drizzle-orm";
import { db } from "@smp/db";

export async function ping(): Promise<{ ok: true }> {
  return { ok: true };
}

// IMP-266 / I04 — worked example: a server action consuming the
// @smp/db workspace package (proves cross-package resolution and
// makes the declared dep live). Real mutations follow this shape
// against a table from @smp/db/schema; read-only + harmless here.
export async function dbReachable(): Promise<boolean> {
  await db.execute(sql`select 1`);
  return true;
}
