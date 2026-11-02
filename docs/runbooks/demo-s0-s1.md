# Demo script: S0 (register on production) and S1 (first draft chargeback)

CHG-118. This is the script Francisco runs **with** Central Finance, Company
Finance and the IT Director. It maps every step to the Sprint 1 (S0) and Sprint 2
(S1) exit criteria in `docs/stories/SPRINT_PLAN.md`. A dress rehearsal of the same
journeys runs automatically on a disposable stack. Its result is at the end of
this page.

> **Nothing in this script is human acceptance until the participants say so.**
> The automated rehearsal uses fictitious `PROVISIONAL` data. It proves that the
> journeys work, not that real numbers are right. US-094 and H2 stay open until
> the real export, the contracted rate and the invoice arrive (OQ-SMP-1 and
> OQ-SMP-4).

## 1. Prerequisites

### Which instance

| Option | When | URL | Data |
|---|---|---|---|
| **A. Production** (`ledger-production`) | The real acceptance demo | `https://ledger.localhost:18443` (the operator's localhost deployment, US-053) | Real pilot data once it arrives. Until then it holds only the US-094 `PROVISIONAL US-094` / `PROV-094-0N` fixture for 2026-10. |
| **B. Disposable rehearsal** | Practice, or a walkthrough on fictitious data | `https://ledger.localhost:28443` | The CHG-118 `PROVISIONAL Demo Company 1..5` fixture, seeded by the spec's global setup |

To start option B next to a running production, use other ports, another
project name, another image tag, and no backup leg. The backup leg retags the
`ledger-backup:local` image that production's 02:00 LaunchAgent uses.

```bash
cd <smp checkout>
PRODUCTION_PROJECT=ledger-demo-rehearsal \
PRODUCTION_OVERRIDE_FILE=$PWD/infra/production/docker-compose.rehearsal-ports.yml \
REHEARSAL_HTTPS_PORT=28443 REHEARSAL_SKIP_BACKUP=1 REHEARSAL_IMAGE_TAG=demo \
bash infra/production/rehearse.sh            # prints "Rehearsal environment: <dir>/runtime.env"
pnpm install --frozen-lockfile
cd apps/web && DEMO_REHEARSAL_ENV_FILE=<dir>/runtime.env \
  npx playwright test -c playwright.demo.config.ts        # seeds + runs the S0/S1 journeys
```

The spec refuses the `ledger-production` project and port 18443. It also refuses
a database that already holds assignments, statements or rates, so start from a
fresh stack. The per-run role passwords are written to
`apps/web/test-results/demo-s0-s1/rehearsal-users.json` (git-ignored, mode
0600). Screenshots, the register CSV and the statement CSV land in the same
folder.

Tear the rehearsal down afterwards. Never run this against `ledger-production`.

```bash
docker compose -p ledger-demo-rehearsal --env-file <dir>/runtime.env \
  -f infra/docker-compose.production.yml \
  -f infra/production/docker-compose.rehearsal-ports.yml down --volumes --remove-orphans
```

**Browser trust (both options).** Import Caddy's local root CA for the instance
into the presenter's browser. For production, use the operator's CA directory
under `~/.local/share/smp/production/`. Do not click through certificate
warnings. The automated spec instead validates each certificate chain against
the rehearsal CA with OpenSSL, then pins those leaf keys for the test browser.

### Accounts, one per role

| Role | Ledger role | Keycloak | Created by |
|---|---|---|---|
| Group Admin (records register entries) | `global_role=group_admin` | `platform-admin` group, TOTP enrolled | First admin: operator bootstrap. Others: `/usuarios` |
| Central Finance | `global_role=central_finance` | `platform-admin` group, TOTP enrolled | Group Admin in `/usuarios` |
| Company Finance, one per pilot company | `company_role_assignment` role `finance` on **its** company only | Normal user | Group Admin in `/usuarios` (create user, grant company role) |
| IT Director | Operator host access (Docker, the runtime env file); `group_admin` login if they also inspect the UI | `platform-admin` + TOTP if a UI login | Operator |

Never add users to `infra/keycloak/realm-corporativo.json`. Before the session,
confirm that each person can sign in and complete TOTP enrollment.

### Data to have ready

* **M-1** is the most recently completed calendar month in America/Guayaquil.
  The close and statements pages default to it.
* For each of the five pilots, the list of people holding a seat in M-1, with
  start and end dates. Company Finance brings its own list.
* The rate per seat and month. Until the contract arrives this is
  **provisional**: keep the "Provisional rate" box ticked.
* With real data, the source export for US-094 (OQ-SMP-1). Without it, the
  S0 exit stays explicitly provisional.

## 2. S0: Register on production

**Exit criterion (Sprint 1).** Central Finance completes the register inspection
and CSV export journey for month M-1 and five pilot companies on production.
Company Finance verifies its company's headcount against its supplied list. The
IT Director completes login and deployment health checks.

| # | Who | Action | Must confirm |
|---|---|---|---|
| S0.1 | IT Director | On the host, run the production smoke test as the operator (below). Open `/api/health` in the browser. | 5/5 smoke assertions pass. Health shows `{"status":"ok","database":"reachable"}`. All six `ledger-production-*` services are healthy. |
| S0.2 | IT Director, then each participant | Sign in through "Continue with corporativo.". Admin roles enroll or use TOTP. | Login works. Admin roles must use a second factor. Sign-out works. |
| S0.3 | Group Admin | In `/registro`, use **Manual register entry**. Record each person's assignment: company, person, organization, license type, start date, and a mandatory note naming the source. Record joiners with their real start date. Record leavers with **Close assignment**, giving the end date and reason. (US-095) | Each save shows "Register updated." The register table lists the row as `Manual entry` with its note. Mistakes are corrected with a new audited entry or close, never with SQL. |
| S0.4 | Central Finance | Open `/registro` and filter by company, organization or person. Inspect dated history and open a row's drilldown. | Central Finance can read the whole group register. The manual-entry form is **not** shown to Central Finance (Group Admin only, by design in US-095). |
| S0.5 | Central Finance | Set **Active in month** to M-1 and press **Export CSV**. Leave `Start date` and `End date` empty: they match only the assignment's start date. (US-098) | The `register_v1` CSV has one row per assignment, with `company_code`, dates, `end_reason`, `source_kind` and `note`. People per company and month-end headcount match the lists for all **five** companies. |
| S0.6 | Company Finance (each) | Compare its supplied list with Central Finance's exported rows for its own company. Central Finance shares the CSV slice; see the known gap. | Every person, start and end date matches, or each mismatch is listed and then corrected through S0.3 with before/after evidence in `/auditoria`. |

IT Director smoke test on production. It is read-only, and the host operator
runs it with the operator's own env file:

```bash
PRODUCTION_PROJECT=ledger-production PRODUCTION_ENV_FILE=<operator runtime.env> \
LOCAL_CA_DIR=<operator CA dir> node --test infra/tests/production-smoke.test.mjs
```

## 3. S1: First draft chargeback

**Exit criterion (Sprint 2).** Central Finance completes the manual close and
CSV handover journey on production for month M-1. Company Finance reads each
pilot draft and compares seat-days, dated joiners/leavers and amounts line by
line against its manual spreadsheet, recording every difference. The IT
Director verifies deployed rerun behaviour and that finals remain untouched.
Provisional rates are visibly identified.

| # | Who | Action | Must confirm |
|---|---|---|---|
| S1.1 | Central Finance | In `/tarifas`, add the rate. Choose organization and license type, enter the monthly USD amount, set "Effective from" to day 1 of M-1 (or earlier), and keep **Provisional rate** ticked. (US-032) | "Rate saved". The rates table shows the amount, the effective date and **Provisional**, and the page explains that provisional rates are rehearsal-only. |
| S1.2 | Central Finance | In `/cierre`, period M-1, add a note and press **Run close**. (US-034) | "Close succeeded · <run id>". The tiles show generated = 5, drafts = 5, finals = 0, and a group total. The latest run shows actor, duration and "Runtime target met". A coverage gap shows "Close failed" with `CLOSE_RATE_COVERAGE` in the run note; fix the rate dates and rerun. |
| S1.3 | Central Finance | Open `/estados-de-cuenta` for M-1. (US-096) | Five rows, all **Draft**. The group total tile on `/cierre` equals the sum of the five row totals. Each row shows opening seats, joiners/leavers with dates, seat-days and rate. |
| S1.4 | Central Finance | Open one statement. Expand **View evidence** on a line. (US-036) | The draft banner is shown. Each license line has person, organization, from/to dates, seat-days, rate, amount and note `provisional_rate`. Evidence shows the register assignment, its source (`Manual entry`) and its note. **View evidence in register** jumps to the filtered register. |
| S1.5 | Central Finance | Press **Export CSV** on the statement and hand it to Company Finance. (US-037, CSV half) | The CSV has one row per line, the statement total on every row, and line amounts summing to that total. The PDF half is S3, so US-037 is only partly accepted. |
| S1.6 | Company Finance (each) | Sign in. Open `/estados-de-cuenta`, open **its** draft and export its CSV. Compare seat-days, joiner/leaver dates and amounts line by line with its spreadsheet. | Only its own company's statement is listed, with no company filter. Opening seats equals its month-start headcount. Every difference is written down, not explained away. |
| S1.7 | Company Finance | Paste another company's statement URL, or `/registro`. | Both are refused with "Access denied", and no figures from another company are shown. |
| S1.8 | IT Director | Ask Central Finance to **run the close again** for M-1. Compare statement ids, totals and the close-run column. | The same statements are updated in place: same ids, same totals for unchanged inputs, new close-run id. Finals are not touched. **On production with provisional data, do not finalize anything to demonstrate this.** Finalization (US-035, S2) is irreversible. The "finals untouched" leg is demonstrated on the rehearsal instance (section 5). |

Arithmetic the finance users can check by hand:

```
amount = monthly rate × assigned days in M-1 ÷ days in M-1   (rounded half-up to the cent)
```

For example, with $30.00 in a 31-day month, a seat held for 15 days is $14.52
and a seat held for 21 days is $20.32.

## 4. Known gaps (say these out loud)

* **No own-company register screen before a close.** US-041 (merged) scopes
  Company Finance to its own statements and the register evidence inside them,
  but there is no standalone own-company register or headcount screen before a close. `/registro` and the register CSV are limited
  to Group Admin and Central Finance, and `/companias` is still a scaffold. In S0,
  Company Finance verifies headcount from the CSV slice that Central Finance
  shares. In S1, it verifies headcount from opening seats and lines on its own
  draft.
* Fixed by US-098: the register now has an **Active in month** filter, so the M-1 CSV no longer needs the start/end-date workaround.
* Fixed with US-098: `docs/runbooks/operations.md` now says Group Admin records entries and Central Finance inspects and exports.
* **Real data is pending.** Without the real export, the contracted rate and the
  invoice, S0 is provisional, US-094 is not verified, and **H2 is not tested**.
  A provisional total proves nothing about the 0.5% reconciliation in S2.
* **Production already holds the US-094 `PROVISIONAL` fixture for 2026-10.**
  Exclude or retire it through audited operations before the real run, and never
  count it as pilot data.

## 5. Dress rehearsal result (automated)

The rehearsal ran `apps/web/e2e/demo-s0-s1.spec.ts` on the disposable stack, as
described in section 1, option B. The results are recorded in
`.nous-feedback.jsonl` under CHG-118 and summarised here.

Run on 2026-11-02 with the spec as committed in CHG-118 (branch `feature/tooling/chg-118-demo-rehearsal`). M-1 = **2026-10** (31
days). The stack was `ledger-demo-rehearsal` on 28080/28443, with images
`ledger-*:chg118-demo` built from main `3aceb12` application code. The run used
a fresh database: realm import, then all committed migrations. Production
smoke ran 5/5 on the rehearsal. The fixture was five `PROVISIONAL Demo Company
N` (`PROV-DEMO-01..05`) with 2/2/3/4/5 fictitious people, one joiner (C4,
starting on the 11th) and one leaver (C5, ending on the 15th, reason
`inactive`). The provisional rate was $30.00 per seat per month.

**10/10 journey steps passed:**

| Step | Story | Result | Evidence (asserted) |
|---|---|---|---|
| IT Director health | US-053 | pass | `/api/health` over verified TLS returns `{status: ok, database: reachable}` |
| Group Admin manual entry, joiner and leaver | US-095 | pass | 16 entries recorded through the form, then one closed with an end date and reason. "Register updated." each time. |
| Central Finance register inspection and M-1 CSV | S0 exit | pass | `register_v1` CSV with 16 rows, all `manual` with the note. Per-company people, start/end dates and reasons match the list. Month-end headcount is 2/2/3/4/4. No manual-entry form for Central Finance. |
| Company Finance register scoping | US-005 | pass, with a **gap** | `/registro` goes to `/acceso-denegado`. `/api/exports/register` returns 403. There is no own-company headcount surface before a close (US-041). |
| Provisional rate | US-032 | pass | "Rate saved". The row shows $30.00, effective 2026-10-01, **Provisional**. |
| License-only close | US-034 | pass | "Close succeeded". Generated 5, drafts 5, finals 0. Group total **454.84** equals the independently computed value. "Runtime target met". |
| Statements list | US-096 | pass | 5 Draft rows. Opening seats 2/2/3/3/5, seat-days 62/62/93/114/139, totals 60.00/60.00/90.00/110.32/134.52. The sum equals the group tile (454.84). |
| Detail with register evidence, and statement CSV | US-036, US-037 | pass | PROV-DEMO-05: draft banner, total $134.52, 5 lines noted `provisional_rate`. Evidence shows the manual assignment and its note. The CSV has 5 rows with total 134.52 on each. Line amounts (4 × 30.00 + 14.52) sum to the total, and seat-days sum to 139. |
| IT Director rerun, finals untouched | S1 exit | pass | PROV-DEMO-03 was finalized on disposable data, then the close was rerun. The same 5 statement ids and totals remain. Drafts carry the new close-run id. The final keeps its status and its original close-run id. |
| Company Finance own draft only | US-005 | pass | One row (PROV-DEMO-01, Draft, opening seats 2, seat-days 62, 60.00) and no company filter. Own detail and CSV total 60.00. Another company's statement id goes to "Access denied", with no figures. |

Screenshots and both CSVs are under `apps/web/test-results/demo-s0-s1/`
(git-ignored, regenerated on every run). The operator's `ledger-production`
containers kept identical start times, health and image ids before and after
the rehearsal, and `ledger-backup:local` was not retagged.

## 6. Sign-off (only after the humans accept)

Run this **only** after Central Finance, Company Finance and the IT Director
have each said that the evidence they saw is accepted. Agents never run it.

```bash
cd /Users/fcolomas/Projects/nous/Nous/System && NOUS_DB_URL=postgresql://nous:nous@localhost:5432/nous python3.14 nous_trace.py story verify US-053 US-095 US-032 US-034 US-096 US-037 --project fcostudios__smp
```

US-094 is verified **only** after the real-data run (section 4). US-037 covers
only the CSV half until the S3 PDF. US-036 is S2-scoped. Its evidence screen is
shown here, but its verification belongs to the S2 acceptance.
