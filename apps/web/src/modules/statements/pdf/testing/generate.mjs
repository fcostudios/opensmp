// Explicit maintainer action only; tests never regenerate their own oracle.
// Run from apps/web: pnpm exec tsx src/modules/statements/pdf/testing/generate.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { renderStatementPdf } from "../render.ts";

const fixture = JSON.parse(readFileSync(new URL("./statement.json", import.meta.url), "utf8"));
for (const language of ["es", "en"]) {
  const bytes = await renderStatementPdf({
    ...fixture,
    company: { ...fixture.company, statementLanguage: language },
    statement: { ...fixture.statement, generatedAt: new Date(fixture.statement.generatedAt), createdAt: new Date(fixture.statement.createdAt) },
  });
  writeFileSync(new URL(`./statement-${language}.pdf`, import.meta.url), bytes);
}
const overflow = {
  ...fixture,
  company: { ...fixture.company, statementLanguage: "en" },
  statement: { ...fixture.statement, generatedAt: new Date(fixture.statement.generatedAt), createdAt: new Date(fixture.statement.createdAt) },
  lines: Array.from({ length: 20 }, (_, n) => ({ ...fixture.lines[0], id: `line-${n}`, note: n === 0 ? "Long evidence note. ".repeat(400) + "END-OF-NOTE" : `ROW-${n}` })),
};
writeFileSync(new URL("./statement-overflow-en.pdf", import.meta.url), await renderStatementPdf(overflow));
