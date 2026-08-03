# US-011 Users and Roles Interaction Design

## Scope

Bring `SCR-users-roles` into conformance with its screen contract without changing server authorization, database mutations, or the existing `Promise<void>` server-action contracts.

## Architecture

`users-roles-page.tsx` remains an authorized Server Component. `UsersRolesPanel` is the only client island and receives the server-loaded users, company roles, companies, available people, localized labels, and server actions.

The panel owns:

- the selected tab, defaulting to Usuarios;
- one discriminated active-dialog context for account creation, 2FA reset, account disablement, role grant, or role removal;
- pending and localized error state for the active submission;
- localized success feedback;
- native dialog lifecycle, focus trapping, Escape cancellation, and opener focus restoration.

Tabs use `tablist`, `tab`, and `tabpanel` semantics with exact row counts. Only the selected panel is rendered. Dialogs use native `<dialog>` elements and preserve all existing test IDs.

## Data and Navigation

The user administration read model continues to select `personId` separately from the linked-person display label. A user row renders `btn_view_person` only when `personId` is present. Its destination is projected from `ROUTE_SCR_PERSON_DETAIL` by replacing `:personId` with the linked identifier.

Opening a row action captures that row's identifiers and display context. Hidden form fields are derived from the captured context, never from client-supplied authorization data. All authorization and target validation remain server-side.

## Submission Settlement

Each form awaits its existing server action. While pending, its submit button is disabled and displays the localized submitting label. A resolved action is treated as success: the panel publishes the action-specific localized success message in a `role="status"` live region, closes the dialog, restores focus to the opener, and calls `router.refresh()`.

A rejected action produces the localized generic error in the open dialog. The form remains available for correction and retry. Cancel or Escape closes without submission, clears transient error state, and restores opener focus. No success state is shown before the action resolves.

## Localized Content

Both production catalogs receive matching keys for all descriptions, help text, placeholders, submitting labels, success messages, generic error text, cancel/close behavior, and optional-field labels specified by `docs/screens/SCR-users-roles.json`. JSX contains no new hardcoded user-facing strings.

## Verification

Strict TDD interaction tests prove:

- exact person-detail navigation and action absence without a linked person;
- default and switched tab semantics, counts, and exclusive panel visibility;
- opening, canceling, and Escape-closing each dialog with correct selected context;
- every contract description, help text, placeholder, and hidden identifier;
- disabled submitting controls and absence of premature success;
- successful toast, close, focus restoration, and refresh only after resolution;
- rejected-action error persistence and retry availability;
- absence of password, TOTP secret, or other credential inputs;
- distinct `personId` propagation through the real read model;
- bilingual catalog key parity.

Focused tests precede production edits and must fail for the missing behaviors. Verification then includes focused panel/page tests, catalog tests, test lint, mutation testing for the changed production source, the full branch mutation gate, and `pnpm check`.
