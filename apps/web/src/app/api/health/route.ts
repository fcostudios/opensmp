import { sql } from "drizzle-orm";

import { db } from "@smp/db";
import { createHealthResponse } from "./health";

export const runtime = "nodejs";

export async function GET() {
  return createHealthResponse(() => db.execute(sql`SELECT 1`));
}
