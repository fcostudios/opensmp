import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "vitest";

test("loads only the active bounded exception projection and never performs row details", async () => {
  const source = await readFile(
    resolve(
      import.meta.dirname,
      "../../app/(authenticated)/excepciones/page.tsx",
    ),
    "utf8",
  );

  expect(source.match(/listBlockedExceptions\(/g)).toHaveLength(1);
  expect(source.match(/verificationFailures\(/g)).toHaveLength(1);
  expect(source.match(/countOperationalExceptions\(/g)).toHaveLength(1);
  expect(source.indexOf("countOperationalExceptions(")).toBeLessThan(
    source.indexOf('selected === "blocked"'),
  );
  expect(source).toContain('selected === "blocked"');
  expect(source).toContain('selected === "failed"');
  expect(source).toContain("exceptionCounts.blocked,");
  expect(source).toContain("exceptionCounts.failed,");
  expect(source).not.toContain("blocked.items.length");
  expect(source).not.toContain("failures.items.length");
  expect(source).not.toContain("requestReadRepository.list(");
  expect(source).not.toContain("requestReadRepository.detail(");
});
