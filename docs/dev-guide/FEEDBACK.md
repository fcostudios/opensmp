# Nous Feedback — Events & AC Verification

How agents report progress to Nous. See `CLAUDE.md` for the summary;
this file is the authoritative event schema.

## Where to Write

Append one JSON object per line to `.nous-feedback.jsonl` at the repo root.
`ts` is optional (git fallback). Nous's `pull` command reads this file to update
story status, add annotations, and register decisions.

## Event Types

| Event | When | Required fields |
|-------|------|-----------------|
| `started` | Begin a story | `story`, `event`, `agent` |
| `ac_pass` | An acceptance criterion passes | `story`, `event`, `ac`, `notes` |
| `ac_verify` | Adversarial verification of one AC | `story`, `event`, `ac`, `method`, `pass`, `notes` |
| `build_pass` | type-check + lint + build pass | `story`, `event`, `notes` |
| `done` | Story complete, all AC + build passing | `story`, `event` |
| `blocked` | Can't proceed | `story`, `event`, `reason`, `needs` |
| `deviation` | Spec divergence | `story`, `event`, `notes` |
| `decision` | Technical decision made | `story`, `event`, `id`, `text`, `reason` |
| `feedback` | Visual/UX issue with screenshot evidence | `story`, `event`, `title`, `description`, `images` |

## Example Stream

```jsonl
{"story":"US-064","event":"started","agent":"claude-code","ts":"2026-04-02T18:00:00Z"}
{"story":"US-064","event":"ac_pass","ac":1,"notes":"socias list renders"}
{"story":"US-064","event":"ac_verify","ac":1,"method":"route check","pass":true,"notes":"empty state renders"}
{"story":"US-064","event":"build_pass","notes":"pnpm type-check && pnpm lint && pnpm build all green"}
{"story":"US-064","event":"done","ts":"2026-04-02T21:30:00Z"}
{"story":"US-064","event":"feedback","title":"Button label wrong","description":"Save says Submit","images":["screenshots/us064-submit-btn.png"]}
```

For `feedback` events, save images under a `screenshots/` folder at the repo root
and list their repo-relative paths in `images`.

## AC Verification Protocol (MANDATORY before `done`)

**Never mark `done` without adversarial verification — try to BREAK each AC.**

| AC Type | Adversarial Check |
|---------|-------------------|
| **Navigation** | Verify the link exists in `apps/web/src/app/`, no competing link. |
| **Data display** | Verify the route handler is called; check empty/null/error; ALL fields render. |
| **Role visibility** | Verify the role gate exists; test with the WRONG role → hide/403. |
| **Button/action** | Button exists, handler routes correctly, not disabled by default. |
| **Empty/error states** | Navigate with no data — empty state renders with the exact CTA. |
| **API contract** | Handler path matches the TOON `dataSource`; request/response shape matches. |

Read like a QA tester finding bugs: check exact wording, test the negative case,
verify integration (not just existence), and grep the codebase.

## `nav_gap` — route missing from the nav map (structured repair event)

When `infra/scripts/validate-routes.sh` reports a Next.js route missing from
`docs/specs/07c_navigation_map.json`, emit **one `nav_gap` event per missing
route** — never bundle several routes (or unrelated causes) into one event.
You have the page open; encode what you already know so Nous can build the
nav-map repair without re-investigating.

| Field | Required | Meaning |
|-------|----------|---------|
| `story` | yes | the story you were working (anchors the FBK) |
| `event` | yes | `"nav_gap"` |
| `route` | yes | the missing route path (top-level, or inside `expected`) |
| `expected.screen_id` | no | intended `SCR-NN` id |
| `expected.roles` | no | roles that may reach it |
| `expected.auth_required` | no | true if behind auth |
| `expected.dynamic_params` | no | dynamic segment names, e.g. `["id","periodCloseId"]` |
| `expected.sidebar` | no | true if a sidebar destination |
| `expected.inbound_edges` | no | how the route is reached (`[{from,kind}]`) |
| `expected.page_path` | no | the `page.tsx` path |
| `expected.introduced_by` | no | the story/CHG that added the page |

Unknown keys are preserved verbatim — encode anything else you know.

```jsonl
{"story":"US-096","event":"nav_gap","route":"/acceso-denegado",
 "expected":{"screen_id":"SCR-access-denied","roles":["tesorera","platform_operator"],
   "auth_required":true,"dynamic_params":[],"sidebar":false,
   "inbound_edges":[{"from":"redirect(ROUTE_ACCESS_DENIED)","kind":"gate_redirect"}],
   "page_path":"apps/web/src/app/(authenticated)/acceso-denegado/page.tsx",
   "introduced_by":"US-031"},
 "notes":"terminal access-denied page; only exit is /auth/logout"}
```

**The unbundling rule.** One failing gate = one event. A `blocked` event names
ONE cause; parallel causes get parallel events. Bundled causes cannot be
split-routed to their repairs — a single record mixing a nav gap with a schema
or toolchain gap can be linked to only one of them.

## `test_report` — mutation-evidence report (the effectiveness gate)

Emitted ONCE per story, at the campaign step of
[`DEFINITION_OF_DONE.md`](DEFINITION_OF_DONE.md) — **after** adversarial AC
verification and every fix it produced. Any commit after the campaign invalidates
it, so a report emitted before review is superseded and has to be run again.

A report missing a required field is **rejected at pull and persists nothing** —
a scoreless report is what made this gate un-gateable. Report the real numbers.

| Field | Required | Meaning |
|-------|----------|---------|
| `event` | **yes** | always `"test_report"` |
| `ts` | no | ISO-8601 timestamp |
| `project_id` | no | usually omitted — the pull knows the project |
| `story` | **yes** | the story whose diff the campaign scored |
| `agent` | no | your agent id |
| `mutation_score` | **yes** | percent of mutants killed on the scored code (0–100) |
| `scope` | **yes** | `diff` for the authoritative diff-scoped campaign; `critical-set` only when the critical set itself changed |
| `killed` | **yes** | mutants killed |
| `survived` | **yes** | mutants that survived |
| `surviving_annotated` | no | `@equivalent: <reason>` for each survivor you are keeping — an unannotated survivor is an assurance gap, not a pass |
| `suite_wallclock_s` | no | seconds the TEST SUITE took |
| `mutation_wallclock_s` | no | seconds the CAMPAIGN took — optional, no gate reads it; it is how we find out whether running the campaign after review actually pays |
| `quarantined` | no | tests quarantined as flaky and excluded from the gate |

```jsonl
{"story":"US-XXX","event":"test_report","mutation_score":84.2,"scope":"diff","killed":32,"survived":6,"surviving_annotated":[],"mutation_wallclock_s":720}
```

If a later commit invalidates a campaign you already reported, emit a
`mutation_invalidation` naming the reason rather than deleting the report.

## Completion Actuals Corrections

Use `actuals_corrected` when primary evidence proves immutable completion actuals are factually wrong. Append a complete replacement; never edit the raw actuals or emit a partial patch. Each later correction targets the SHA-256 of the currently effective object, forming one linear audit chain.

| Field | Required | Meaning |
|-------|----------|---------|
| `story` | **yes** | completed `US-NNN` or `CHG-NNN` whose immutable actuals are corrected |
| `event` | **yes** | always `actuals_corrected` |
| `ref` | **yes** | globally unique correction identity |
| `change` | **yes** | prior `CHG-NNN` decision authorizing the correction |
| `target_actuals_sha256` | **yes** | SHA-256 of compact recursively key-sorted current effective actuals |
| `replacement_actuals` | **yes** | complete replacement actuals object; never a partial patch |
| `reason` | **yes** | non-empty factual explanation |
| `evidence` | **yes** | one or more non-empty primary-source descriptions |
| `ts` | **yes** | ISO-8601 UTC timestamp after the terminal or preceding correction |

## Canonical Event Vocabulary (authoritative)

Canonical event vocabulary (single source: `feedback_schemas`). Unknown event names are surfaced by `pull`/`drift`, never silently dropped:

- **Lifecycle (flip story status):** `started`, `done`, `verified`
- **Terminal-with-deferral (→ dev_done + deferral note; prefer plain `done`):** `done_with_deferral`, `done_with_external_deferral`
- **Annotation (recorded, no status change):** `ac_pass`, `ac_verify`, `blocked`, `blocker`, `deviation`, `ac_fail`, `ac_unverifiable`, `test_report`, `feedback`, `evidence_superseded`, `revalidated`, `mutation_invalidation`, `actuals_corrected`, `nav_gap`
- **Decision (registered):** `decision`
- **Sprint-level marker (project audit trail, never flips a story):** `closed_with_deferrals`, `adversarial_review`, `deferred_memory_saved`, `closure_hygiene`, `implemented_with_external_verification`
- **Informational (counted, not persisted):** `build_pass`
- **Retired (accepted for history, never emit):** `checkpoint`

Any `done_with_<qualifier>` event is recognized as terminal (recorded as a deferral); prefer plain `done` when there is no caveat.

Retired names stay valid so previously written history keeps validating; do not emit them in new work.

**Stamp every event with `ts`** — an ISO-8601 UTC timestamp of when the event happened, e.g. `date -u +%FT%TZ` → `"ts": "2026-09-06T14:30:00Z"`. It is optional on every event and absence is always legal, so a forgotten stamp never fails a sync — but `started` and `done` without it mean nobody can say how long the story took (`nous_trace.py story elapsed` reports it as "lacking an endpoint", never as zero). A malformed stamp is excluded and named rather than guessed at.
<!-- nous-emitted: sha256=38503c4b2a53f768 -->
