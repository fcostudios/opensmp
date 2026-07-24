"use client";

// IMP-267 / I03 — worked example: consume the @smp/ui workspace
// package (the @smp/ui parallel to actions.ts's @smp/db
// example). The dev team imports real shared components from
// @smp/ui this way. NOTE: the app-shell chrome under
// components/layout/ legitimately lives in apps/web — it is NOT a
// packages/ui duplicate; packages/ui is the shared component library
// (many entries are typed DoR stubs the dev team fills in).
//
// We import the package NAMESPACE rather than a single hard-coded
// component: the generated component set varies per design system
// (e.g. `Button`, `TextInput`, `DataTable`…), so a fixed name would
// not type-check across projects. The dev team imports concrete
// components directly, e.g. `import { Button } from "@smp/ui"`.
import * as ui from "@smp/ui";

// Referencing the namespace keeps the @smp/ui dependency live and
// proves the shared component library resolves cross-package (IMP-267).
export const availableUiComponents: string[] = Object.keys(ui);
