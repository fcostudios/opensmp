# Nous Feedback — Events & AC Verification

How agents report progress to Nous. See `CLAUDE.md` for the summary;
this file is the authoritative event schema.

## Where to Write

Append one JSON per line to `.nous-feedback.jsonl` at the repo root.
`ts` is optional (git fallback). Nous's `pull` command reads this file
to update story status, add annotations, and register decisions.

## Event Types

| Event | When | Required fields |
|-------|------|-----------------|
| `started` | Begin working on a story | `story`, `event`, `agent` (e.g. "codex", "claude-code", "copilot") |
| `ac_pass` | An acceptance criterion passes | `story`, `event`, `ac` (number), `notes` |
| `ac_verify` | Adversarial verification of one AC | `story`, `event`, `ac`, `method`, `pass` (bool), `notes` |
| `build_pass` | Full build passes (BE + FE) | `story`, `event`, `backend_tests`, `backend_coverage`, `frontend_tests`, `frontend_coverage` |
| `done` | Story complete, all AC + build passing | `story`, `event`, `coverage` |
| `blocked` | Can't proceed | `story`, `event`, `reason`, `needs` (blocker story) |
| `deviation` | Spec divergence | `story`, `event`, `notes` (what and why) |
| `decision` | Technical decision made | `story`, `event`, `id` (DEC-NNN), `text`, `reason` |
| `feedback` | Visual/UX issue with screenshot evidence | `story`, `event`, `title`, `description`, `images` (array of paths relative to repo root) |

## Example Stream

```jsonl
{"story":"US-064","event":"started","agent":"claude-code","ts":"2026-04-02T18:00:00Z"}
{"story":"US-064","event":"ac_pass","ac":1,"notes":"Tenant entity created"}
{"story":"US-064","event":"ac_verify","ac":1,"method":"grep + route check","pass":true,"notes":"Route registered, empty state renders"}
{"story":"US-064","event":"build_pass","backend_tests":154,"backend_coverage":"84%","frontend_tests":47,"frontend_coverage":"82%"}
{"story":"US-064","event":"done","coverage":"84%","agent":"claude-code"}
{"story":"US-064","event":"blocked","reason":"Missing dependency","needs":"US-062"}
{"story":"US-064","event":"deviation","notes":"Used discriminator strategy instead of schema-per-tenant"}
{"story":"US-064","event":"decision","id":"DEC-134","text":"Discriminator multi-tenancy for R1","reason":"Simpler"}
{"story":"US-064","event":"feedback","title":"Button label wrong","description":"Save button says Submit","images":["docs/screenshots/us064-submit-btn.png"]}
```

## Screenshot Evidence (for `feedback` events)

Save screenshots to `docs/screenshots/<story-id>-<short-desc>.png` and reference
them in the `images` array. `nous_package.py pull` reads these and attaches
them to the FBK record.

## AC Verification Protocol (MANDATORY before `done`)

**Never mark `done` without adversarial verification — try to BREAK each AC.**

| AC Type | Adversarial Check |
|---------|-------------------|
| **Navigation** | `grep -r "path" apps/web/src/` — verify link exists, no competing link. |
| **Data display** | Verify API called; check empty/null/error; ALL fields render. |
| **Role visibility** | Verify role check exists; test with WRONG role → hide/403. |
| **Button/action** | Button exists, `onClick` routes correctly, not disabled by default. |
| **Empty/error states** | Navigate with no data — empty state renders with exact CTA? |
| **API contract** | Endpoint path matches story spec; request/response shape matches frontend. |

### Protocol Steps

1. **Re-read the story file** — every AC literally before verifying.
2. **Run adversarial check per AC** (see table above).
3. **Log each result**: `{"story":"US-XXX","event":"ac_verify","ac":1,"method":"grep + route check","pass":true,"notes":"..."}`
4. **If ANY `ac_verify` fails**: fix, then re-verify.
5. **Log `done` only when all pass**: `{"story":"US-XXX","event":"done","coverage":"84%","ac_verified":7,"agent":"<your-agent>"}`

**What "adversarial" means**: read like a QA tester finding bugs. Check exact wording.
Test the negative case. Check integration, not just existence. Grep the codebase.

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
- **Annotation (recorded, no status change):** `ac_pass`, `ac_verify`, `blocked`, `blocker`, `deviation`, `ac_fail`, `ac_unverifiable`, `test_report`, `feedback`, `nav_gap`
- **Decision (registered):** `decision`
- **Sprint-level marker (project audit trail, never flips a story):** `closed_with_deferrals`, `adversarial_review`, `deferred_memory_saved`, `closure_hygiene`, `implemented_with_external_verification`
- **Informational (counted, not persisted):** `build_pass`

Any `done_with_<qualifier>` event is recognized as terminal (recorded as a deferral); prefer plain `done` when there is no caveat.
