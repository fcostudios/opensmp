# Statement PDF template — US-049

`renderStatementPdf({ company, statement, lines }): Promise<Buffer>` is a
Node/server presentation module. All row types derive from `@smp/db/schema`.
It accepts an already authorized, company-scoped statement snapshot. It checks
the company/statement and statement/line relationships as defense in depth;
this is not an authorization boundary. US-037 loads the snapshot through its
authenticated export path, using a repeatable-read company-scoped transaction
and the same stored S1 license/adjustment rows as US-036 detail. Rendering and
the export audit must both succeed before the download returns.

BR-19 / DEC-SMP-011: only `Company.statementLanguage` selects the labels and
date/decimal presentation (`en` → en-US; `es` or null → es-EC). User UI language
is deliberately absent from the interface. Notes remain verbatim source data.
Calendar dates never shift timezone; generated/created instants use
America/Guayaquil. Stored decimal amounts and totals are displayed without
recalculation. Input line order is preserved. All Statement and StatementLine
display fields and references are included, with nullable facts distinguished
from zero. Joiner/leaver descriptions come from stored notes, with their
`periodFrom`/`periodTo` dates; this renderer invents no movement classifications
from live assignments. `companyId` and `statementId` are validated relationships
represented by their parent headings, rather than repeated on every line.

DEC-SMP-005/012: colors and font families import the delivered design tokens.
The temporary **Corporativo.** typographic lockup was explicitly approved by
the operator for this story because no approved logo artwork is in the
delivered worktree. It is isolated in the page header for later replacement.
Barlow Regular, Barlow Condensed Bold and IBM Plex Mono Regular are bundled in
`public/fonts/statement`, with upstream OFL licenses. Sources are the matching
`ofl/barlow`, `ofl/barlowcondensed` and `ofl/ibmplexmono` directories in
https://github.com/google/fonts. Rendering needs no network. Font assets resolve relative to the module, so direct Node rendering does not
depend on the working directory. The Next.js server webpack rules retain real
file URLs for this renderer and emit its fonts beside the server chunks;
standalone output tracing includes those assets. PDFKit remains external so its
AFM data resolves from its installed package. Do not replace those server file
URLs with browser asset URLs. Verify a relocated standalone PDF download with
the source font directory unavailable whenever changing this packaging.

## Fixture and verification

`testing/statement.json` contains a mid-month joiner, a leaver, nullable usage
fields, Spanish accents, stored rates and totals. Both language PDFs are
committed and compared byte-for-byte, alongside a seven-page overflow golden.
PDF metadata uses the statement's
generated timestamp, so tests do not normalize away layout or content changes.
Tests also parse the actual PDFs for data/language, check mixed-tenant rejection,
nullable/empty/credit cases, and force multi-page overflow with a long note.

From `apps/web`:

```sh
pnpm exec vitest run src/modules/statements/pdf/render.test.ts
# Intentional template updates only; then render and visually review BOTH PDFs:
pnpm exec tsx src/modules/statements/pdf/testing/generate.mjs
pdftoppm -png src/modules/statements/pdf/testing/statement-es.pdf /tmp/statement-es
pdftoppm -png src/modules/statements/pdf/testing/statement-en.pdf /tmp/statement-en
```

US-037 integration tests verify the authenticated PDF path, the US-036 stored
S1 detail facts, company-selected language (including Spanish by default), and
the per-page period, statement-generated stamp and integrity note. The footer
uses `Statement.generatedAt`; the audit separately records when the export
occurs. List and detail expose localized PDF download links.

The Sprint S3 production exit criterion still requires the real finance-user
and IT Director journey/acceptance across the other stories; this module alone
cannot attest it.
