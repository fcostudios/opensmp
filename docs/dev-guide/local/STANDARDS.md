## Database Roles and Migration Execution

- Committed release migrations run as `ledger_owner`, which owns schema changes
  and grants.
- The deployed Next.js application connects as `ledger_app`, which has only the
  runtime privileges established by migrations.
- Do not run schema mutation or migration tooling with the application role.

## Tenant boundary note (tenant-authored)

- `Company` is the application-tenant boundary. `VendorAccount` is a vendor
