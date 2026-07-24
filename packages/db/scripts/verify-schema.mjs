// verify-schema.mjs — assert `drizzle-kit push` actually applied the schema.
// push exits 0 on an unreachable DATABASE_URL (silent no-op), so we count
// the tables it should have created and fail loud when none exist.
//
// IMP-264 — load the SAME env file `setup.sh` writes. `node` does not read
// .env files, and drizzle-kit auto-loads only `.env`; `setup.sh` writes
// `.env.local`. Load both (`.env.local` overrides `.env`) so the documented
// `task setup` / `task migrate` works with no manual `export`.
import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local", override: true });

const url = process.env.DATABASE_URL ?? "";
if (!url) {
  console.error("\u2717 migrate verify: DATABASE_URL is not set.");
  process.exit(1);
}
const driver = process.env.DB_DRIVER;
const useNeon =
  driver === "neon" || (driver !== "pg" && /neon|vercel/i.test(url));

const SQL =
  "SELECT count(*)::int AS n FROM information_schema.tables " +
  "WHERE table_schema = 'public'";

let n = 0;
try {
  if (useNeon) {
    const { neon } = await import("@neondatabase/serverless");
    const sql = neon(url);
    const rows = await sql(SQL);
    n = Number(rows[0]?.n ?? 0);
  } else {
    const pg = await import("pg");
    const pool = new pg.default.Pool({ connectionString: url });
    const { rows } = await pool.query(SQL);
    n = Number(rows[0]?.n ?? 0);
    await pool.end();
  }
} catch (err) {
  console.error(
    `\u2717 migrate verify: could not query the database after push \u2014 ${err.message}`
  );
  process.exit(1);
}

if (n < 1) {
  console.error(
    "\u2717 migrate verify: 0 tables in the public schema after 'drizzle-kit push'."
  );
  console.error(
    "  push exited 0 but applied nothing \u2014 DATABASE_URL is likely unreachable."
  );
  process.exit(1);
}
console.log(`\u2713 migrate verify: ${n} table(s) present in the public schema.`);
