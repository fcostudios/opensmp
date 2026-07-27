# US-007 Six-Company Go-Live Fixture Design

**Date:** 2026-07-26  
**Story:** US-007  
**Decisions:** DEC-SMP-006, DEC-SMP-007, DEC-SMP-009, DEC-SMP-017, DEC-SMP-018  
**Status:** Approved for implementation

## Objective

Complete US-007 against the local persistent Docker environment with an
audited, repeatable, synthetic go-live import. The fixture represents six
Ledger companies and two Claude Teams vendor organizations without depending
on live Anthropic access.

The import must exercise the same parser, validation, encryption, transaction,
register-integrity, reconciliation, audit, and idempotency boundaries intended
for the eventual operator-provided rollout inventory.

## Corrected Business Mapping

Ledger manages six companies:

| Company code | Company name | Teams organization |
|---|---|---|
| `CORP` | Corporativo | `corporativo-teams` |
| `PPM` | PPM | `corporativo-teams` |
| `FOCUS` | Focus | `corporativo-teams` |
| `MULLEN` | Mullen Lowe | `corporativo-teams` |
| `RAM` | RAM | `corporativo-teams` |
| `CENTROHUB` | CentroHub | `centrohub-teams` |

Corporativo owns the shared Teams subscription used by Corporativo, PPM,
Focus, Mullen Lowe, and RAM. CentroHub owns a separate Teams subscription.
The Teams organization is a `VendorAccount`, not Ledger's tenant boundary;
Ledger tenant isolation continues to use `company_id` per DEC-SMP-017.

## Synthetic Data Set

### Companies and contacts

All six companies use:

- `type=internal`
- `statement_language=es`
- a non-negative synthetic monthly USD budget
- a unique approver address
- a unique finance-contact address

All generated addresses use the reserved `.invalid` top-level domain. No real
address, credential, export, or customer datum is committed.

The import creates twelve synthetic contact accounts in total: one approver and
one finance contact per company. Contact addresses remain globally unique, as
required by the current CSV contract.

### Members and register backfill

The fixture contains two synthetic Teams seat holders per company:

- 10 members in `corporativo-teams`
- 2 members in `centrohub-teams`
- 12 members and active assignments in total

Every member receives:

- a synthetic `Person`
- a system-materialized `LicenseRequest` in `active`
- one initial `RequestTransition`
- an open `LicenseAssignment`
- `source_kind=import`
- the note and justification `importación inicial`
- company attribution matching the CSV

The single fixture license type is `Teams`.

### Capacity

The effective-dated capacity snapshot contains:

| Teams organization | License type | Purchased | Occupied | Spare |
|---|---|---:|---:|---:|
| `corporativo-teams` | `Teams` | 15 | 10 | 5 |
| `centrohub-teams` | `Teams` | 3 | 2 | 1 |

Reconciliation must produce `memberDelta=0` and `capacityDelta=0` for both
organization/license pairs. Purchased capacity may exceed occupied seats.

### Synthetic credentials

The current US-007 production boundary requires Admin and Analytics
credentials per imported vendor organization, even though Teams organizations
will use the API-less ingestion modes introduced by US-055.

The local fixture therefore supplies four unmistakably synthetic, distinct key
values:

- Corporativo Admin
- Corporativo Analytics
- CentroHub Admin
- CentroHub Analytics

The committed credential manifest contains environment-variable names only.
Credential values, the runtime environment file, and the 32-byte base64 KEK
remain in ignored private paths. The importer encrypts the values with the
existing XChaCha20-Poly1305 envelope before persistence. Tests and operator
output must not reveal plaintext values.

US-055 will later add `VendorAccount.ingestion_mode` and set these accounts to
`csv_import` or `manual`. US-007 must not prematurely implement Sprint 3
member/usage ingestion behavior.

## Import Cardinality Correction

DEC-SMP-018 changes five companies from a hard go-live count into the MVP
fixture baseline; 30 remains the rollout target. The current implementation
and import guide still require exactly 30 rows, contradicting the resynced
acceptance criterion and preventing the approved six-company inventory.

The implementation will remove the fixed-cardinality business validation.
Inventory validity is determined by the CSV contracts, unique keys,
cross-references, integrity constraints, and reconciliation—not by one
hard-coded company count.

Focused tests will prove that:

- the resynced five-company baseline is accepted;
- the approved six-company fixture is accepted;
- the same import path remains compatible with a 30-company rollout;
- an empty or malformed inventory remains rejected by the CSV and reference
  contracts.

The import guide will describe five as the MVP fixture baseline and 30 as the
rollout target rather than an exact parser rule.

## Operator Interface

Add a reusable repository operator command that invokes the existing US-007
application boundary. It will:

1. Read the three explicit CSV files.
2. Resolve the actor as an existing synthetic Ledger `group_admin`, creating
   the local-development actor through a narrowly scoped seed path if absent.
3. Load credentials and the KEK through the existing private production
   preparation path.
4. Run and print a sanitized dry-run report.
5. Refuse mutation if any validation error exists.
6. Execute the audited import only when explicitly requested.
7. Print created/existing counts and reconciliation without credential values.

The command is preferable to:

- a full browser import UI, which belongs with the later company-management
  screen work; or
- direct SQL, which would bypass application validation, encryption, audit,
  reconciliation, and idempotency guarantees.

The command must not require starting another Docker project or creating
ephemeral database containers. It targets the already-running persistent local
Postgres service through the configured `DATABASE_URL`.

## Execution Sequence

1. Correct the fixed 30-company validation and its focused tests.
2. Update the import guide.
3. Add the six-company CSV fixture and credential-name manifest.
4. Add the reusable preview/import operator command.
5. Create ignored local synthetic key material and KEK.
6. Run focused parser/import tests.
7. Run `pnpm type-check`, `pnpm lint`, and `pnpm build`.
8. Confirm the persistent Docker stack is healthy without recreating it.
9. Run the read-only preview against local Postgres.
10. Execute the audited import once.
11. Query the database to verify entities, company attribution, encrypted
    credentials, audit records, and zero reconciliation deltas.
12. Repeat the preview/import to demonstrate idempotency.
13. Run an independent implementation review and verification pass.
14. Commit the completed US-007 changes.

## Verification Contract

Completion requires evidence for all of the following:

- 6 companies
- 2 vendor accounts for Anthropic
- 1 `Teams` license type
- 12 synthetic member people
- 12 active system requests
- 12 open imported assignments
- 2 effective-dated capacity rows
- 4 active encrypted integration credentials
- unique approver and finance contacts for every company
- every member and assignment attributed to the intended `company_id`
- Corporativo/PPM/Focus/Mullen Lowe/RAM mapped to `corporativo-teams`
- CentroHub mapped to `centrohub-teams`
- zero member and capacity reconciliation deltas
- completion and assignment audit records
- a second identical execution creates no duplicate domain rows
- no plaintext key appears in committed files, logs, or returned reports

## Failure and Recovery

The existing import remains transactional and advisory-locked. Any validation,
integrity, encryption, or reconciliation failure rolls back the complete
mutation. Preview remains read-only. Because natural keys are deterministic,
the same accepted input can be safely rerun after a failure or interruption.

No direct data deletion, database reset, volume recreation, or destructive
Docker operation is part of this design.
