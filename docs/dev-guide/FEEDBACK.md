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
| `evidence_superseded` | Retire one unique earlier AC/build/terminal event without rewriting history | `story`, `event`, `ref`, `target`, `reason` |
| `revalidated` | Replace a superseded event after a decided change | `story`, `event`, `ref`, `change`, `as_event`, plus the replacement event's evidence fields |
| `blocked` | Can't proceed | `story`, `event`, `reason`, `needs` |
| `deviation` | Spec divergence | `story`, `event`, `notes` |
| `decision` | Technical decision made | `story`, `event`, `id`, `text`, `reason` |
| `feedback` | Visual/UX issue with screenshot evidence | `story`, `event`, `title`, `description`, `images` |

## Example Stream

```jsonl
{"story":"US-064","event":"started","agent":"claude-code"}
{"story":"US-064","event":"ac_pass","ac":1,"notes":"socias list renders"}
{"story":"US-064","event":"ac_verify","ac":1,"method":"route check","pass":true,"notes":"empty state renders"}
{"story":"US-064","event":"build_pass","notes":"pnpm type-check && pnpm lint && pnpm build all green"}
{"story":"US-064","event":"done"}
{"story":"US-064","event":"feedback","title":"Button label wrong","description":"Save says Submit","images":["screenshots/us064-submit-btn.png"]}
```

For `feedback` events, save images under a `screenshots/` folder at the repo root
and list their repo-relative paths in `images`.

### Append-only evidence correction

Never edit an earlier evidence record to make its chronology look newer. Append
`evidence_superseded` with a unique `ref` and a `target` containing `story`,
`event`, and `ac` when the target is an AC. The target must identify exactly one
earlier event. Then append exactly one `revalidated` record using that `ref`
after both the supersession and a `decision` on the named `change`.

To supersede evidence that was itself projected by an earlier revalidation,
use `target: {"ref":"THE-EARLIER-REVALIDATION-REF"}`. The referenced
revalidation must exist uniquely, precede the new supersession, and not already
be superseded.

The validator projects the revalidation as `as_event`; the superseded raw
record remains audit history but is excluded from the canonical lifecycle.
Superseded build and terminal evidence must therefore be revalidated in order:
replacement `build_pass`, then replacement terminal event. Missing, duplicate,
ambiguous, out-of-order, or event-kind-mismatched references fail closed.

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

## Canonical Event Vocabulary (authoritative)

Canonical event vocabulary (single source: `feedback_schemas`). Unknown event names are surfaced by `pull`/`drift`, never silently dropped:

- **Lifecycle (flip story status):** `started`, `done`, `verified`
- **Terminal-with-deferral (→ dev_done + deferral note; prefer plain `done`):** `done_with_deferral`, `done_with_external_deferral`
- **Annotation (recorded, no status change):** `ac_pass`, `ac_verify`, `blocked`, `blocker`, `deviation`, `ac_fail`, `ac_unverifiable`, `test_report`, `feedback`, `nav_gap`, `evidence_superseded`, `revalidated`
- **Decision (registered):** `decision`
- **Sprint-level marker (project audit trail, never flips a story):** `closed_with_deferrals`, `adversarial_review`, `deferred_memory_saved`, `closure_hygiene`, `implemented_with_external_verification`
- **Informational (counted, not persisted):** `build_pass`

Any `done_with_<qualifier>` event is recognized as terminal (recorded as a deferral); prefer plain `done` when there is no caveat.
