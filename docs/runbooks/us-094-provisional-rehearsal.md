# US-094 — provisional register rehearsal

**Provisional evidence only. Real-data acceptance, human verification and H2 remain pending.**

Executed on 2026-11-01 against the operator-selected US-053 host:
`ledger-production`, <https://ledger.localhost:18443>.
The source month is **2026-10**, the most recently completed calendar month in
America/Guayaquil. Real input files, real company mapping, contracted rate and
invoice have not arrived (OQ-SMP-1 / OQ-SMP-4).

This completes the explicitly requested AC3 rehearsal. It does not complete the
real-source comparison in AC1/AC2 or the human inspection in AC4. `done` records
development/rehearsal completion; no `verified` event or H2 acceptance is claimed.
US-007 and its story/status are unchanged. No product logic, schema or tests were
changed for US-094; this run reuses US-095 and US-033 operations.

## Environment and provenance

The database initially contained no companies, people, vendor accounts or
assignments. Its 64-migration deployment predated US-095. Built the existing app,
worker and migration images from main baseline `d22b5c7`, then deployed with
`infra/production/deploy.sh build`. The checksum-verified committed applier
installed migration 65 (US-095 manual provenance); no migration was authored or
edited. All six services are healthy; the five production smoke assertions pass.
Images retain their existing operator tags; this was a local deployment, not a
new CI deployment or public DNS rollout.

The rehearsal bootstrap created only visibly named `PROVISIONAL US-094` entities:
five placeholder companies, 16 fictitious people at `ledger.invalid`, one manual
vendor/account/license and one isolated rate card. IDs use prefix
`94000000-0000-4000-8000-`. The account UUID ends `000000000003`, license ends
`000000000004`, rate ends `000000000005`. These are **not mappings to the five
actual pilot companies**. The rate is **USD 30.00 per seat/month**, effective
2026-10-01 through 2026-10-31, chosen solely for rehearsal. The provisional account
and license names, assignment notes and bootstrap audit label it provisional.
No statement, invoice, chargeback amount or financial reconciliation was generated.

Bootstrap was an owner-role transaction for prerequisites only. Register writes
and export used the deployed app's restricted `ledger_app` role and existing
shared Drizzle client. A dedicated rehearsal Group Admin database account
(`us094.provisional@ledger.invalid`, UUID ending `000000000001`) was resolved
through `createAuthorizationRepository.load`. It has no provisioned Keycloak
identity or login credential. This is a **service-level manual-entry/export
rehearsal**, not evidence of interactive Auth.js login or a browser form submit.
No API keys or provider calls were used.

## Source, comparison and export

- [Hand-entered provisional source](../evidence/us-094/provisional-source.csv):
  expected dated membership, company/person UUIDs and explicit provisional labels.
- [Actual register CSV](../evidence/us-094/provisional-register.csv): produced by
  `createRegisterCsvDownload` and `createRegisterExportResponse`, using the existing
  repository stream and authorization lookup. Canonical `register_v1`, 16 rows,
  all `source_kind=manual`, with system request anchors and mandatory notes.
- [Run assertions and digests](../evidence/us-094/provisional-run.json): counts,
  rejected commands, audit totals, rate, timestamp and SHA-256 source/export hashes.

| Placeholder code | Company UUID suffix | Expected / exported October people | October 31 headcount |
|---|---|---:|---:|
| PROV-094-01 | 000000000101 | 2 / 2 | 2 |
| PROV-094-02 | 000000000102 | 2 / 2 | 2 |
| PROV-094-03 | 000000000103 | 3 / 3 | 3 |
| PROV-094-04 | 000000000104 | 4 / 4 | 4 |
| PROV-094-05 | 000000000105 | 5 / 5 | 4 |

All entries start October 1. C5 member 5 ends October 15, inclusive, with reason
`inactive`. Monthly distinct people total 16; month-end headcount totals 15.
These different denominators are intentional, not an unexplained discrepancy.

One deliberate mismatch was recorded: C1 initially exported one person against
two on the typed list. `createManualRegisterService.record` added the missing
person with an explicit correction note. Final difference is zero for every
placeholder. This is an automated comparison of a provisional list, **not a
Central Finance check of a real spreadsheet**.

Six invalid commands were rejected with assignment, request-anchor and audit
counts unchanged: overlapping assignment, foreign-company person, company outside
authorization scope, Central Finance write, unauthenticated write and closing
before the start date. Twenty foreign-company filter attempts returned no rows
under Company Finance read scope. Anonymous export returned 401. Successful
commands produced exactly 16 `license_assignment.manual_recorded` and one
`license_assignment.manual_closed` audit records. Observations, capacity records,
credentials and statements remained at zero.

## Reproduce and inspect

The executed procedure used existing modules, with no alternate register writer:

1. Apply committed migrations and verify schema. Bootstrap the clearly marked
   prerequisites above in one transaction, including an
   `us094.provisional_bootstrap` audit containing the rate and provisional flag.
   Never rerun this bootstrap over real companies or rename placeholders to real
   companies. Stable UUID conflicts should fail, not overwrite existing data.
2. Load the rehearsal actor using the authorization repository. For each source
   row except C1 member 2, call `createManualRegisterService.record` with the
   company/person/account/license IDs, `startedOn=2026-10-01`, and a note beginning
   `PROVISIONAL US-094 rehearsal`. Detect C1's 1-versus-2 mismatch, then record
   the omitted member with a correction note. Close C5 member 5 on October 15
   through `createManualRegisterService.close`.
3. Exercise the six rejected commands above and compare assignment, anchor and
   audit counts before/after each rejection. Query each company's read scope with
   every other company filter and require an empty result.
4. Export using the existing download/export boundary with the provisional vendor
   account filter and `endDate=2026-10-31`; compare the CSV with the typed source,
   including dates and provenance. This filter is sufficient for this fixture
   because all starts are October 1. For a real month, inspect interval overlap
   (`started_on <= month_end` and null end or `ended_on >= month_start`) and
   distinguish month-end counts from people assigned at any time in the month.
5. Compare manual audit counts and verify zero provider/financial side effects.
   Do not rerun successful record commands blindly: overlap rejection deliberately
   prevents duplication. Retain current assignments/audit as provisional evidence.

For human inspection, Group Admin/Central Finance can open `/registro`, select
the provisional vendor account, inspect dates/notes and export the CSV. Company
Finance inspects its granted company's register; the current CSV download action
is restricted to Group Admin/Central Finance. Arrange identity/grants through the
existing identity workflow before claiming anyone completed that journey.

## Gate evidence

- `pnpm type-check`: 9/9 tasks; `pnpm lint`: 8/8; `pnpm build`: 9/9.
- `pnpm test`: 15/15 tasks (existing Turbo cache evidence).
- Fresh uncached register PostgreSQL suite: 37/37 assertions/tests pass.
- Fresh disposable PostgreSQL: `apply-migrations.mjs` applied all 65 committed
  migrations, then `verify-schema.mjs` verified 33 application tables, six
  append-only triggers and the exact least-privilege application grant matrix.
- Production smoke: 5/5 pass, including TLS app/DB health and canonical OIDC
  discovery. Initial invocation omitted `LOCAL_CA_DIR`; rerunning with the
  operator's existing CA directory passed without a product change.
- Final diff mutation gate is recorded in `.nous-feedback.jsonl`. This evidence-only
  change adds no mutatable source; S0 reuses register/auth integrity tests and
  US-095's existing mutation evidence, as required by slice S0.

## Real-data handover — pending

| Acceptance | Owner | Evidence still required |
|---|---|---|
| AC1 real import/run | Group Admin / Francisco | Actual five-company inventory, account/company mapping, source export and month; existing US-007 CSV/backfill run and source digests, no API keys |
| AC2 headcounts | Central Finance + each Company Finance | Compare actual source with register CSV; enumerate every mismatch and use audited US-095 corrections, retaining before/after evidence |
| AC4 inspection | Central Finance, Company Finance, IT Director | Inspect production evidence, verify login/health/isolation and personally accept real headcounts using human `story verify` |
| H2 | Central Finance, subsequent S2 | Real contracted rate and invoice, reconciled close within 0.5% with finance acceptance; a provisional total or override cannot pass H2 |

Recompute M-1 when the first real parallel close occurs; October is this
rehearsal's anchor only. Preserve provisional provenance and segregate or retire
these fixture entities through audited operations before actual pilot operation.
Do not delete the audit history or treat these headcounts/rate as real inputs.
