import { execFileSync } from "node:child_process";

// Keep arbitrary passwords out of URI interpolation in Compose.
function url(user, password) {
  const value = new URL("postgresql://postgres/ledger");
  value.hostname = process.env.PGHOST;
  value.port = process.env.PGPORT;
  value.pathname = `/${process.env.PGDATABASE}`;
  value.username = user;
  value.password = password;
  return value.toString();
}
process.env.DATABASE_ADMIN_URL = url("ledger_owner", process.env.LEDGER_OWNER_PASSWORD);
process.env.DATABASE_URL = url("ledger_app", process.env.LEDGER_APP_PASSWORD);
for (const script of ["apply-migrations", "verify-schema"]) {
  execFileSync(process.execPath, [`scripts/${script}.mjs`], { stdio: "inherit" });
}
