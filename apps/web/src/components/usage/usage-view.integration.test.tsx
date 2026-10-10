import React from "react";
import { eq } from "drizzle-orm";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, expect, test } from "vitest";
import messages from "../../../messages/en-US.json";
import { createUsageRepository } from "../../modules/usage/repository";
import { createUsageFixture, usageId, usageIds as i, USAGE_EVALUATION_DATE } from "../../modules/usage/testing/fixture-transaction";
import { UsageView, type UsageLabels } from "./usage-view";

let f: Awaited<ReturnType<typeof createUsageFixture>>;
beforeAll(async () => { f = await createUsageFixture(); });
afterAll(async () => { await f?.stop(); });
async function model(window: 30 | 60 | 90 = 30, companyId: string | undefined = i.companyA) {
  return createUsageRepository(f.database).read(f.admin, { window, companyId }, USAGE_EVALUATION_DATE);
}
const labels = (messages as unknown as { usage: UsageLabels }).usage;
const render = (result: Awaited<ReturnType<typeof model>>) => renderToStaticMarkup(<UsageView model={result} locale="en-US" labels={labels} />);
const row = (html: string, id: string) => html.match(new RegExp(`<tr[^>]*data-assignment-id="${id}"[^>]*>([\\s\\S]*?)</tr>`))?.[1] ?? "";

const text = (html: string) => html.replace(/<[^>]*>/g, "");
const cells = (html: string, id: string) => [...row(html, id).matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(match => text(match[1]));
const card = (html: string, id: string) => html.match(new RegExp(`<div[^>]*data-testid="${id}"[^>]*>([\\s\\S]*?)</div>`))?.[1] ?? "";

test("renders real lag-aware license cards, separate window and persisted-state badges and account freshness", async () => {
  const html = render(await model());
  for (const testId of ["usage_filters", "usage_metrics", "active_30d_pct", "flagged_inactive", "no_data", "freshness_banner", "usage_table"]) expect(html).toContain(`data-testid="${testId}"`);
  expect(html).toContain("Last known Ana"); expect(html).not.toContain("Foreign Bea");
  expect(text(card(html, "active_30d_pct"))).toBe("Active licenses within 30 days444.4%");
  expect(text(card(html, "flagged_inactive"))).toBe("Inactive licenses beyond 30 days2");
  expect(html).toContain(`9 ${labels.licenses}`);
  expect([...html.matchAll(/<th [^>]*>([\s\S]*?)<\/th>/g)].map(match => text(match[1]))).toEqual([labels.person, labels.company, labels.lastKnownActivity, labels.daysInactive, labels.qualification, labels.license, labels.state, labels.dataThrough]);
  expect(cells(html, usageId(30))).toEqual(["Last known Ana", "Company A", "Sep 6, 2026", "31", labels.inactive + "30", "Enterprise · Account X", labels.states.flagged_inactive, "Oct 7, 2026"]);
  expect(cells(html, usageId(36)).slice(2,5)).toEqual([labels.unknown, labels.unknown, labels.noData + "30"]);
  expect(html).not.toContain(labels.empty);
  const freshness = html.match(/<aside[^>]*>([\s\S]*?)<\/aside>/)?.[1] ?? "";
  expect([...freshness.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map(match => text(match[1]))).toEqual([`Account X: ${labels.confirmed} Oct 7, 2026`, `Account Y: ${labels.confirmed} Oct 1, 2026`]);
  expect(row(html, usageId(30))).toContain("2026-09-06"); expect(row(html, usageId(30))).toContain(">31<");
  expect(row(html, usageId(30))).toContain(labels.states.flagged_inactive);
  expect(row(html, usageId(33))).toContain(">0<");
  expect(row(html, usageId(36))).toContain(labels.unknown); expect(row(html, usageId(36))).toContain(labels.anchorUnavailable);
  expect(html).toContain("2026-10-07"); expect(html).toContain("2026-10-01");
  expect(html).toContain('data-count="2"'); expect(html).toContain('data-count="3"');
  expect(row(html, usageId(32))).toContain("2026-10-01");
  const sixty = render(await model(60)); const ninety = render(await model(90));
  expect(sixty).toContain('data-count="0"'); expect(ninety).toContain('data-count="0"');
  expect(row(sixty, usageId(30))).toContain(labels.active); expect(row(sixty, usageId(30))).toContain(labels.states.flagged_inactive);
});
test("GET filters reset paging, preserve selection and use real company options with no proposal control", async () => {
  const html = render(await model(60));
  expect(html).toMatch(/<form[^>]*method="get"/);
  expect(html).toContain('name="companyId"'); expect(html).toContain('name="window"');
  expect(html).toContain(`<option value="${i.companyA}" selected="">`);
  expect(html).toContain('<option value="60" selected="">');
  expect(html).not.toContain('name="cursor"'); expect(html).not.toContain("btn_propose_reclamation");
  expect(html).toContain(`/personas/${i.old}`);
  const all = await createUsageRepository(f.database).read(f.admin, { window: 30 }, USAGE_EVALUATION_DATE);
  expect(render(all)).toContain("Foreign Bea");
});
test("empty repository output renders zero license cards and localized empty message", async () => {
  const html = render(await model(30, i.emptyCompany));
  expect(html).toContain(labels.empty); expect(html).toContain('data-count="0"');
  expect(html).not.toContain("Last known Ana"); expect(html).not.toContain('data-assignment-id=');
});
test("missing account observations show the real fallback freshness estimate", async () => {
  const { activityRecord } = await import("@smp/db/schema");
  const records = await f.ownerDb.select().from(activityRecord).where(eq(activityRecord.vendorAccountId, i.accountY));
  await f.ownerDb.delete(activityRecord).where(eq(activityRecord.vendorAccountId, i.accountY));
  try {
    const html = render(await model());
    const freshness = html.match(/<aside[^>]*>([\s\S]*?)<\/aside>/)?.[1] ?? "";
    expect(text(freshness)).toContain(`Account Y: ${labels.fallback} Oct 7, 2026`);
    expect(text(freshness)).toContain(labels.freshnessLag);
  } finally { await f.ownerDb.insert(activityRecord).values(records); }
});

test("next link binds company and selected window to the real cursor and every row has a stable assignment identity", async () => {
  const people = Array.from({ length: 55 }, (_, n) => ({ id: usageId(2000 + n), fullName: `Render page ${n}`, email: `render${n}@example.com`, companyId: i.companyA, status: "active" as const, createdAt: new Date("2026-01-01T00:00:00Z"), createdBy: i.admin }));
  const { person, licenseAssignment } = await import("@smp/db/schema");
  await f.ownerDb.insert(person).values(people);
  await f.ownerDb.insert(licenseAssignment).values(people.map((p,n) => ({ id: usageId(3000+n), personId: p.id, companyId: i.companyA, vendorAccountId: i.accountX, licenseTypeId: i.typeA, startedOn: "2026-08-01", sourceKind: "import" as const, createdAt: new Date("2026-01-01T00:00:00Z"), createdBy: i.admin })));
  const result = await model(90); const html = render(result);
  expect(result.nextCursor).not.toBeNull();
  expect(html).toContain(`companyId=${i.companyA}`); expect(html).toContain("window=90"); expect(html).toContain(`cursor=${result.nextCursor}`);
  expect([...html.matchAll(/data-assignment-id="([^"]+)"/g)].map(m => m[1])).toEqual(result.rows.map(r => r.assignmentId));
  expect(result.metrics.total).toBe(64); expect(html).toContain('data-count="58"');
});
