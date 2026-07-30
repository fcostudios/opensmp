import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "vitest";

test("gates the global alert read before constructing or querying the repository", async () => {
  const source = await readFile(
    resolve(
      import.meta.dirname,
      "../../app/(authenticated)/alertas/page.tsx",
    ),
    "utf8",
  );
  const gate = source.indexOf(
    'authorization.globalRole !== "group_admin"',
  );
  const repository = source.indexOf("createAlertRepository(");
  const authorizedRead = source.indexOf("repository.listAuthorizedEvents(");
  const authorizedCount = source.indexOf("repository.countAuthorizedEvents(");

  expect(gate).toBeGreaterThan(-1);
  expect(repository).toBeGreaterThan(gate);
  expect(authorizedRead).toBeGreaterThan(repository);
  expect(authorizedCount).toBeGreaterThan(repository);
  expect(source.match(/repository\.listAuthorizedEvents\(/g)).toHaveLength(1);
  expect(source.match(/repository\.countAuthorizedEvents\(/g)).toHaveLength(1);
  expect(source).toContain("eventCounts.all,");
  expect(source).toContain("eventCounts.unacknowledged,");
  expect(source).toContain("allCount={allCount}");
  expect(source).toContain("unacknowledgedCount={unacknowledgedCount}");
  expect(source).not.toContain("items.filter(");
  expect(source).not.toContain("listGlobalEvents");
  expect(source).not.toContain("listCompanyEvents");
  expect(source).toContain('redirect("/acceso-denegado")');
});
