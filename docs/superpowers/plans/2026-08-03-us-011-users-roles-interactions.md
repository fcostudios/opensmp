# US-011 Users and Roles Interactions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the complete interactive SCR-users-roles contract with semantic tabs, accessible modal workflows, exact linked-person navigation, localized content, and truthful action settlement.

**Architecture:** Keep the page and authorization on the server while making `UsersRolesPanel` a single typed client island. The island owns tab/dialog/submission state and delegates every mutation to the existing Promise<void> server actions; the repository remains the source of distinct `personId` and display-label data.

**Tech Stack:** Next.js App Router, React 19, TypeScript, native `<dialog>`, next-intl JSON catalogs, Testing Library, Vitest, Stryker.

---

### Task 1: Lock the Navigation, Tabs, and Dialog Contract

**Files:**
- Modify: `apps/web/src/components/users/users-roles-panel.test.tsx`
- Modify: `apps/web/src/modules/identity-access/user-admin-service.integration.test.ts`

- [ ] **Step 1: Write failing navigation and tab interaction tests**

Render linked and unlinked user rows, assert only the linked row has `btn_view_person`, and assert its `href` is `/personas/<personId>`. Assert the Usuarios tab has `aria-selected="true"`, includes the user count, and is the only visible panel; click Roles por compañía and assert selection, count, and exclusive panel visibility reverse.

- [ ] **Step 2: Write failing dialog-context tests**

Use `userEvent` to open each existing action test ID. Assert exactly one `role="dialog"`, the localized title/description, selected email/company/role context, and exact hidden `userAccountId`, `assignmentId`, and `companyId`. Cancel and fire native `cancel` to prove close and focus restoration.

- [ ] **Step 3: Lock distinct read-model identifiers**

Extend the real Postgres list-users assertion to require both `linkedPerson` and its independent `personId` UUID.

- [ ] **Step 4: Run RED tests**

Run:

```sh
pnpm --filter smp-web exec vitest run src/components/users/users-roles-panel.test.tsx src/modules/identity-access/user-admin-service.integration.test.ts
```

Expected: failures for the collection route, action rendered without `personId`, both panels being visible, absent tab semantics, and non-dialog `<details>` interactions.

### Task 2: Lock Content and Action Settlement

**Files:**
- Modify: `apps/web/src/components/users/users-roles-panel.test.tsx`
- Modify: `apps/web/src/lib/i18n/catalogs.test.ts`

- [ ] **Step 1: Write failing contract-content tests**

For every modal, assert its exact localized description. Assert `nombre@compania.ec`, all reason placeholders, person/user select help, optional global-role help, and delegation-window help through accessible descriptions. Assert no password, TOTP, secret, or credential input exists.

- [ ] **Step 2: Write failing pending/success/error tests**

Provide deferred Promise<void> actions. Submit each workflow and assert the submit button becomes disabled with the localized submitting label while no success appears. Resolve and assert the action-specific localized `role="status"`, dialog closure, opener focus, and one router refresh. Reject and assert localized error remains visible in the still-open dialog with the submit control re-enabled and no refresh.

- [ ] **Step 3: Strengthen catalog tests**

Assert recursive catalog parity plus the exact `usersRoles` interaction-key set in both production catalogs.

- [ ] **Step 4: Run RED tests**

Run:

```sh
pnpm --filter smp-web exec vitest run src/components/users/users-roles-panel.test.tsx src/lib/i18n/catalogs.test.ts
```

Expected: failures for missing descriptions, placeholders, help, feedback states, and catalog keys.

### Task 3: Implement the Client Island and Localized Contract

**Files:**
- Modify: `apps/web/src/components/users/users-roles-panel.tsx`
- Modify: `apps/web/messages/es-EC.json`
- Modify: `apps/web/messages/en-US.json`

- [ ] **Step 1: Add typed island state**

Add `"use client"`, a `selectedTab: "users" | "roles"`, and a discriminated dialog union carrying the selected user or grant. Keep the action type `(formData: FormData) => Promise<void>`.

- [ ] **Step 2: Implement semantic tabs and person routes**

Render two buttons with `role="tab"`, `aria-selected`, `aria-controls`, and localized counts. Render only the active `role="tabpanel"`. Use:

```ts
const personHref = ROUTE_SCR_PERSON_DETAIL.replace(":personId", user.personId);
```

only inside the non-null `personId` branch.

- [ ] **Step 3: Implement native modal lifecycle**

Render one native `<dialog>` for the active discriminated context. On open call `showModal()` and focus the first field; on cancel/Escape close and restore opener focus; trap Tab within enabled dialog controls. Preserve every existing action, modal, field, and confirmation test ID.

- [ ] **Step 4: Implement truthful form settlement**

On submit, create `FormData`, set pending, clear the transient error, and await the selected server action. On resolve, publish the action-specific success message, close, restore focus, and invoke `router.refresh()`. On reject, publish localized error inside the open dialog. In `finally`, clear pending. Disable submit and cancel while pending.

- [ ] **Step 5: Add complete bilingual labels**

Add matching keys for modal descriptions; email and note placeholders; person/user/global-role/delegation help; optional date/global-role labels; submitting; generic error; and five success messages. Use labels for all rendered user-facing text.

- [ ] **Step 6: Run GREEN tests**

Run:

```sh
pnpm --filter smp-web exec vitest run src/components/users/users-roles-panel.test.tsx src/modules/identity-access/user-admin-service.integration.test.ts src/lib/i18n/catalogs.test.ts
```

Expected: all focused tests pass.

### Task 4: Verify Mutation Strength and Repository Gates

**Files:**
- Modify only if a focused failure identifies a real defect in an already changed file.

- [ ] **Step 1: Run test-policy lint**

```sh
pnpm lint:tests
```

Expected: pass with no weak-oracle violations.

- [ ] **Step 2: Run the mandatory branch mutation campaign**

```sh
MUTATION_BASE=f3b42a5 pnpm test:mutation
```

Expected: Stryker passes the configured threshold, with zero runner errors and the changed panel covered by responsible tests.

- [ ] **Step 3: Run the full repository gate**

```sh
pnpm check
```

Expected: type-check, lint, all tests, and production build pass.

- [ ] **Step 4: Commit implementation**

```sh
git add apps/web/src/components/users/users-roles-panel.tsx apps/web/src/components/users/users-roles-panel.test.tsx apps/web/src/modules/identity-access/user-admin-service.integration.test.ts apps/web/src/lib/i18n/catalogs.test.ts apps/web/messages/es-EC.json apps/web/messages/en-US.json
git commit -m "feat(US-011): complete users roles interactions"
```
