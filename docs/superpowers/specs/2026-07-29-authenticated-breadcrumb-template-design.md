# Authenticated Breadcrumb Template Design

**Date:** 2026-07-29  
**Scope:** Task 17 support fix for authenticated client navigation

## Problem

The authenticated layout currently resolves breadcrumb labels from
`x-ledger-pathname` and passes them to the client `ApplicationShell`. Next.js
layouts persist across client navigation, so those route-specific labels remain
from the source page while `usePathname()` changes to the destination. Entering
a dynamic route then fails closed with `Missing dynamic breadcrumb label`.

Calling `router.refresh()` immediately after `router.push()` is racy and was
rejected by the real Compose E2E. Falling back to a UUID label or forcing a
browser reload would conceal the ownership error.

## Design

Split persistent identity authentication from route-sensitive shell rendering:

- `app/(authenticated)/layout.tsx` remains the persistent identity boundary. It
  verifies the Auth.js session and redirects unauthenticated users to `/login`.
  It does not resolve pathname-dependent authorization or breadcrumb data.
- Add `app/(authenticated)/template.tsx`. Next.js remounts this server template
  when the child route segment changes. On each navigation it:
  1. loads the authenticated session;
  2. reads `x-ledger-pathname`;
  3. applies `authenticatedRouteRedirect`;
  4. resolves authoritative labels through `dynamicBreadcrumbRepository`;
  5. renders `ApplicationShell` with the current user, roles, and labels.
- The template passes its server-resolved `pathname` and breadcrumb labels to
  `ApplicationShell` as one authoritative snapshot. `ApplicationShell` no
  longer subscribes independently to `usePathname()`. This prevents the old
  shell from combining destination client state with source-route labels while
  the new template is streaming.
- The strict breadcrumb resolver remains unchanged. Missing authoritative
  labels continue to fail closed.
- Successful request submission uses `router.push(redirectTo)` only. No refresh,
  sleep, retry, full-page reload, or test-only navigation recovery is added.

The repeated `auth()` call at the layout/template boundary is acceptable for
this focused correction: the layout owns persistent identity admission, while
the template independently owns route-sensitive authorization and presentation.
No client-visible authorization data is accepted as input.

## Data and Error Flow

1. A successful public form action returns a validated internal `redirectTo`.
2. The request controller calls `router.push(redirectTo)`.
3. Next.js selects a new key for the authenticated template as the child route
   changes.
4. The server template re-evaluates the destination pathname, Ledger roles and
   company grants, and dynamic breadcrumb labels.
5. The template commits the destination pathname and labels together to the
   remounted shell; the source shell remains internally consistent until then.
6. Unauthorized destinations redirect to `/acceso-denegado`; missing identity
   or pathname redirects to `/login`.
7. The remounted shell renders labels that correspond to its explicit pathname
   prop, without observing a separate client-navigation clock.

## Testing

- Static/authenticated-boundary tests prove the layout retains identity
  authentication but no longer owns route-sensitive breadcrumbs.
- Template tests prove it owns route authorization, dynamic label resolution,
  and `ApplicationShell` construction, including the explicit pathname prop.
- Shell ownership tests prove `ApplicationShell` does not call `usePathname`.
- The request-controller test keeps the `router.push` RED/GREEN contract and
  proves no raw history mutation or refresh workaround.
- Existing breadcrumb repository and resolver tests remain authoritative.
- The real `ledger-sprint2` Compose E2E must navigate continuously from request
  submission to the dynamic request detail page without an error boundary or
  manual `page.goto`.
- Full type-check, lint, tests, build, and Task 17 Playwright gates must pass.

## Trade-off

`ApplicationShell` client state resets on authenticated route navigation because
it is inside the template. That is intentional: route-specific shell state,
including breadcrumbs and mobile navigation presentation, must be synchronized
with the destination. Persistent application data remains in server/database
state rather than the shell instance.

## Server Action Reconciliation Refinement

The Compose journey also proved that manually awaiting checklist Server Actions
from click handlers does not merge the fresh Flight tree, even when
`revalidatePath()` or the Server Action `refresh()` returns the correct active
projection. The checklist dialogs therefore use the React 19/Next.js native form
protocol:

- each dialog is a real `<form action={formAction}>`;
- `useActionState` owns the returned result and pending state;
- the action-state function builds the existing stable confirmation/failure
  command and calls the injected Server Action;
- effects translate rejected results into the existing dialog errors;
- successful results close the dialog if the component remains mounted, while
  the authoritative Server Action response removes the checklist from the fresh
  server projection;
- no client transition, router refresh, reload, retry, or manual navigation is
  involved.

This keeps command validation and authorization on the existing server boundary
while letting React own action submission and Flight reconciliation as one
protocol.

### Successful mutation navigation

Compose evidence showed that the current Next runtime returns a correct refreshed
Flight tree but does not merge it while the remounting template is active. A
successful checklist mutation therefore completes with a Server Action redirect:

- orchestration operations return the canonical request ID already loaded under
  the transaction lock;
- the audited action service includes that database-derived request ID only on a
  successful result;
- the confirmation Server Action redirects to
  `/solicitudes/{requestId}?tab=assignment`, while the failure Server Action
  redirects to `/solicitudes/{requestId}?tab=actions`;
- rejected results still return to `useActionState` so the dialog can show the
  existing localized error;
- the redirect target never comes from client input, a referrer, or an arbitrary
  URL.

The request ID in both destinations comes from the provisioning action row
loaded under the transaction lock and is preserved through the audited action
service. The distinct canonical query destinations create a new authoritative
navigation and template request; redirecting to the unchanged detail URL can be
a same-URL no-op in this runtime. This replaces the unsuccessful
`revalidatePath()` and `refresh()` experiments; no client cache or navigation
call remains.
