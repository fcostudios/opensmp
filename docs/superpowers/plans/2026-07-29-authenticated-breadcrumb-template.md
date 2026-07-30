# Authenticated Breadcrumb Template Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make authenticated client navigation re-resolve route authorization and authoritative dynamic breadcrumb labels without reloads, retries, or fallback labels.

**Architecture:** Keep identity admission in the persistent authenticated layout. Move pathname-sensitive authorization, breadcrumb lookup, and `ApplicationShell` construction into a Next.js server template, which remounts when the authenticated segment's child route changes.

**Tech Stack:** Next.js 16 App Router, React Server Components, Auth.js, Vitest, Playwright, Docker Compose

---

### Task 1: Move route-sensitive shell ownership to a template

**Files:**
- Modify: `apps/web/src/lib/auth/authenticated-layout.test.ts`
- Modify: `apps/web/src/app/(authenticated)/layout.tsx`
- Create: `apps/web/src/app/(authenticated)/template.tsx`

- [ ] **Step 1: Write the failing ownership test**

Replace the current source-wiring assertion with separate layout and template
assertions:

```ts
test("keeps identity admission in the persistent authenticated layout", () => {
  const source = readFileSync(
    new URL("../../app/(authenticated)/layout.tsx", import.meta.url),
    "utf8",
  );

  expect(source).toContain("await auth()");
  expect(source).toContain('redirect("/login")');
  expect(source).not.toContain("x-ledger-pathname");
  expect(source).not.toContain("dynamicBreadcrumbRepository");
  expect(source).not.toContain("ApplicationShell");
});

test("resolves route authorization and breadcrumbs in the remounting template", () => {
  const source = readFileSync(
    new URL("../../app/(authenticated)/template.tsx", import.meta.url),
    "utf8",
  );

  expect(source).toContain("await auth()");
  expect(source).toContain('get("x-ledger-pathname")');
  expect(source).toContain("authenticatedRouteRedirect");
  expect(source).toContain("dynamicBreadcrumbRepository.resolve");
  expect(source).toContain("dynamicBreadcrumbLabels=");
  expect(source).toContain("pathname={pathname}");
  expect(source).toContain("redirect(destination)");
  expect(source).toContain("ApplicationShell");
});

test("keeps pathname and breadcrumb labels on the same server snapshot", () => {
  const source = readFileSync(
    new URL("../../components/layout/app-shell.tsx", import.meta.url),
    "utf8",
  );

  expect(source).not.toContain("usePathname");
  expect(source).toContain("readonly pathname: string");
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm --dir apps/web exec vitest run src/lib/auth/authenticated-layout.test.ts
```

Expected: FAIL because `template.tsx` does not exist and the persistent layout
still owns pathname-dependent shell work.

- [ ] **Step 3: Reduce the persistent layout to identity admission**

Replace `layout.tsx` with:

```tsx
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth/auth-config";

export default async function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return children;
}
```

- [ ] **Step 4: Create the route-sensitive server template**

Create `template.tsx`:

```tsx
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { ApplicationShell } from "@/components/layout/app-shell";
import { auth } from "@/lib/auth/auth-config";
import { authenticatedRouteRedirect } from "@/lib/auth/route-guard";
import { updateLocale } from "@/modules/identity-access/actions/update-locale";
import { dynamicBreadcrumbRepository } from "@/modules/navigation/repository";

export default async function AuthenticatedTemplate({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  const requestHeaders = await headers();
  const pathname = requestHeaders.get("x-ledger-pathname");
  const destination = authenticatedRouteRedirect(
    session?.user ?? null,
    pathname,
  );
  if (destination) redirect(destination);
  if (!session?.user || !pathname) redirect("/login");

  const user = session.user;
  const dynamicBreadcrumbLabels =
    await dynamicBreadcrumbRepository.resolve(pathname, user);
  if (!dynamicBreadcrumbLabels) redirect("/acceso-denegado");

  return (
    <ApplicationShell
      displayName={user.name || user.email}
      dynamicBreadcrumbLabels={dynamicBreadcrumbLabels}
      pathname={pathname}
      roles={user.roles}
      updateLocaleAction={updateLocale}
    >
      {children}
    </ApplicationShell>
  );
}
```

- [ ] **Step 5: Make the shell consume the server pathname snapshot**

Remove the `usePathname` import and call from
`apps/web/src/components/layout/app-shell.tsx`. Add `pathname` to the component
destructuring and props:

```tsx
export function ApplicationShell({
  children,
  dynamicBreadcrumbLabels = {},
  displayName,
  pathname,
  roles,
  updateLocaleAction,
}: {
  readonly children: ReactNode;
  readonly dynamicBreadcrumbLabels?: DynamicBreadcrumbLabels;
  readonly displayName: string;
  readonly pathname: string;
  readonly roles: readonly LedgerRole[];
  readonly updateLocaleAction: (input: {
    locale: StoredLocale;
  }) => Promise<void>;
}) {
  const t = useTranslations();
  const routeContext = shellRouteContext(pathname, dynamicBreadcrumbLabels);
```

- [ ] **Step 6: Run focused GREEN gates**

Run:

```bash
pnpm --dir apps/web exec vitest run \
  src/lib/auth/authenticated-layout.test.ts \
  src/components/layout/breadcrumbs.test.ts \
  src/modules/navigation/repository.integration.test.ts \
  src/components/requests/request-submission-controller.integration.test.tsx
```

Expected: all tests pass; the controller calls `router.push` without raw history
mutation, refresh, sleep, reload, or test-only navigation recovery.

- [ ] **Step 7: Rebuild and prove continuous public navigation**

Run the isolated primary journey:

```bash
pnpm --dir apps/web exec playwright test \
  e2e/sprint2-orchestration.spec.ts --grep "request approval"
```

Expected: the browser naturally transitions from `/solicitudes/nueva` to the
dynamic request detail page, renders authoritative breadcrumbs, and continues
through approval and checklist confirmation without an error boundary or
`page.goto` recovery.

### Task 1B: Submit checklist actions through the native form protocol

**Files:**
- Modify: `apps/web/src/components/requests/checklist-panel.test.tsx`
- Modify: `apps/web/src/components/requests/checklist-panel.tsx`
- Modify: `apps/web/src/modules/request-workflow/actions/checklist.ts`

- [ ] **Step 1: Write failing form-action tests**

Update the panel tests to require both dialogs to render real forms and to prove
that action-state pending disables controls, successful results settle without
client navigation, blank failure reasons return the existing validation error,
and rejected server results keep the dialog open. Add a source contract:

```ts
expect(panelSource).toContain("useActionState");
expect(panelSource).toContain("<form action={confirmFormAction}>");
expect(panelSource).toContain("<form action={failureFormAction}>");
expect(panelSource).not.toContain("useTransition");
expect(panelSource).not.toContain("useRouter");
expect(panelSource).not.toContain("router.refresh");
```

- [ ] **Step 2: Run the panel tests and verify RED**

```bash
pnpm --dir apps/web exec vitest run \
  src/components/requests/checklist-panel.test.tsx
```

Expected: FAIL because the dialogs still call injected Server Actions from
manual async handlers.

- [ ] **Step 3: Define exact action state**

Add this local state contract:

```ts
type ChecklistFormState =
  | { readonly status: "idle" }
  | { readonly status: "success" }
  | { readonly status: "generic_error" }
  | { readonly status: "failure_error" };

const initialChecklistFormState: ChecklistFormState = { status: "idle" };
```

- [ ] **Step 4: Bind confirmation to `useActionState`**

Create the confirmation dispatcher:

```ts
const [confirmState, confirmFormAction, confirmPending] = useActionState(
  async (): Promise<ChecklistFormState> => {
    const result = await confirmAction(
      buildChecklistConfirmation(action.id, crypto.randomUUID()),
    );
    return result.ok
      ? { status: "success" }
      : { status: "generic_error" };
  },
  initialChecklistFormState,
);
```

Render the confirmation controls inside
`<form action={confirmFormAction}>`; the confirmation button is a submit button.

- [ ] **Step 5: Bind failure to `useActionState`**

Create the failure dispatcher:

```ts
const [failureState, failureFormAction, failurePending] = useActionState(
  async (
    _previous: ChecklistFormState,
    formData: FormData,
  ): Promise<ChecklistFormState> => {
    const command = buildChecklistFailure(
      action.id,
      String(formData.get("reason") ?? ""),
      crypto.randomUUID(),
    );
    if (!command.ok) return { status: "failure_error" };
    const result = await notDoneAction(command.input);
    return result.ok
      ? { status: "success" }
      : { status: "generic_error" };
  },
  initialChecklistFormState,
);
```

Give the textarea `name="reason"` and render the failure controls inside
`<form action={failureFormAction}>`.

- [ ] **Step 6: Project action state into dialog behavior**

Use effects to close the corresponding dialog on `"success"` and to show the
existing localized message for `"generic_error"` or `"failure_error"`. Derive
the shared disabled state from `confirmPending || failurePending`. Remove
`useTransition`, manual submit handlers, and all client cache/navigation calls.

- [ ] **Step 7: Run focused GREEN**

```bash
pnpm --dir apps/web exec vitest run \
  src/components/requests/checklist-controller.test.ts \
  src/components/requests/checklist-panel.test.tsx \
  src/modules/request-workflow/actions/checklist-action-transaction.test.ts
```

Expected: all checklist tests pass.

- [ ] **Step 8: Run the decisive primary E2E**

```bash
pnpm --dir apps/web exec playwright test \
  e2e/sprint2-orchestration.spec.ts --grep "request approval"
```

Expected: React commits the fresh active projection returned by the Server
Action; the checklist disappears without any manual refresh or navigation.

### Task 1C: Redirect successful actions with a trusted request ID

**Files:**
- Modify: `apps/web/src/modules/request-workflow/orchestration.ts`
- Modify: `apps/web/src/modules/request-workflow/orchestration.integration.test.ts`
- Modify: `apps/web/src/modules/request-workflow/actions/checklist-action-transaction.ts`
- Modify: `apps/web/src/modules/request-workflow/actions/checklist.ts`
- Modify: `apps/web/src/components/requests/checklist-panel.test.tsx`

- [ ] **Step 1: Write failing trusted-target tests**

Update real-PostgreSQL action-service success assertions to require:

```ts
expect(result).toEqual({
  ok: true,
  requestId,
});
```

Add source assertions that the production Server Actions import
`redirect` from `next/navigation`, redirect successful results using
`result.requestId`, and contain no `refresh`, `revalidatePath`, referrer, or
client-supplied redirect target.

- [ ] **Step 2: Run focused RED**

```bash
pnpm --dir apps/web exec vitest run \
  src/modules/request-workflow/orchestration.integration.test.ts \
  src/components/requests/checklist-panel.test.tsx
```

Expected: FAIL because successful service results currently discard the request
ID and production actions return after cache refresh.

- [ ] **Step 3: Return the canonical request ID from orchestration**

For both confirmation and failure operations, include the locked
`action.requestId` in successful and idempotent results:

```ts
return {
  assignmentId,
  requestId: action.requestId,
  status: "active" as const,
};
```

```ts
return {
  requestId: action.requestId,
  status: "failed" as const,
};
```

Replay queries must obtain the same request ID by joining the provisioning action
to its request; they must not accept it from the command.

- [ ] **Step 4: Preserve the trusted ID through the audited service**

Change the success branch of `ChecklistActionResult` to:

```ts
{
  readonly ok: true;
  readonly requestId: string;
}
```

Capture each orchestration operation result and return its `requestId` in the
audited value. Rejected result shapes remain unchanged.

- [ ] **Step 5: Redirect only successful production actions**

Replace Server Action cache calls with:

```ts
import { redirect } from "next/navigation";

const result = await checklistActionService.confirmChecklistDone(input);
if (result.ok) {
  redirect(`/solicitudes/${result.requestId}?tab=assignment`);
}
return result;
```

Apply the same pattern to the failure action, using the distinct canonical
destination `/solicitudes/${result.requestId}?tab=actions`. The request ID is
database-derived by orchestration and preserved through the audited action
service; it never comes from the form, referrer, or client navigation state.
Because `redirect()` returns `never`, rejected results continue to flow back to
`useActionState`.

- [ ] **Step 6: Run focused GREEN**

```bash
pnpm --dir apps/web exec vitest run \
  src/modules/request-workflow/orchestration.integration.test.ts \
  src/components/requests/checklist-controller.test.ts \
  src/components/requests/checklist-panel.test.tsx
```

Expected: exact trusted request IDs and UI error behavior pass.

- [ ] **Step 7: Run the decisive primary E2E**

```bash
pnpm --dir apps/web exec playwright test \
  e2e/sprint2-orchestration.spec.ts --grep "request approval"
```

Expected: successful confirmation redirects through the Server Action to the
canonical assignment tab (`?tab=assignment`); the distinct destination remounts
the template, renders the active state, and removes the checklist. The failure
path analogously redirects to the canonical actions tab (`?tab=actions`) so it
cannot collapse into an unchanged same-URL redirect.

### Task 2: Complete Task 17 gates and commit

**Files:**
- Preserve all Task 17 implementation and support files already in the worktree.
- Modify: `.github/workflows/ci.yml`
- Create: `apps/web/e2e/sprint2-orchestration.spec.ts`

- [ ] **Step 1: Run the full Task 17 browser suite**

```bash
pnpm --dir apps/web exec playwright test e2e/sprint2-orchestration.spec.ts
```

Expected: all three serial browser tests pass and collectively prove the primary
journey plus all five required negative cases. Global teardown removes the exact
`ledger-sprint2` containers, network, and volumes.

- [ ] **Step 2: Run repository gates**

```bash
pnpm type-check
pnpm lint
pnpm test
pnpm build
pnpm validate:routes
pnpm validate:sidebar
```

Expected: every command passes.

- [ ] **Step 3: Verify CI and cleanup contracts**

Inspect the CI job and run repository infrastructure checks:

```bash
pnpm test:infra
docker compose --project-name ledger-sprint2 \
  --env-file .env.example -f infra/docker-compose.yml \
  -f infra/docker-compose.test.yml ps --all
```

Expected: the CI job has a 20-minute bound, targets only the Sprint 2 spec,
installs Chromium dependencies, uploads failure artifacts, and always runs exact
project cleanup. Compose reports no remaining `ledger-sprint2` resources.

- [ ] **Step 4: Commit Task 17**

```bash
git add \
  .github/workflows/ci.yml \
  apps/web/Dockerfile \
  apps/web/e2e/auth.setup.ts \
  apps/web/e2e/sprint2-orchestration.spec.ts \
  apps/web/playwright.config.ts \
  apps/web/src/app/'(authenticated)'/layout.tsx \
  apps/web/src/app/'(authenticated)'/template.tsx \
  apps/web/src/components/layout/app-shell.tsx \
  apps/web/src/components/requests/request-submission-controller.integration.test.tsx \
  apps/web/src/components/requests/request-submission-controller.ts \
  apps/web/src/modules/request-workflow/approval-repository.integration.test.ts \
  apps/web/src/modules/request-workflow/approval/repository.ts \
  infra/docker-compose.yml
git commit -m "test(SPRINT-2): verify orchestration workflow end to end" \
  -m "US-012 US-015 US-020 US-022"
```

Expected: commit succeeds and the worktree is clean.
