/**
 * CHG-118 — S0 + S1 demo dress rehearsal on the disposable production-shaped
 * stack. All data is fictitious and labelled PROVISIONAL; nothing here is a
 * real-data acceptance (US-094 / H2 stay pending). Run with
 * playwright.demo.config.ts; see docs/runbooks/demo-s0-s1.md.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Browser, type BrowserContext, type Download, type Page } from "@playwright/test";

import {
  ACCOUNT,
  COMPANIES,
  LICENSE,
  PROVISIONAL_RATE_USD,
  cents,
  credentialsFile,
  day,
  demoBaseUrl,
  demoConfigured,
  evidenceDir,
  expectedStatements,
  parseCsv,
  previousMonth,
  totp,
  type DemoUser,
} from "./demo-s0-s1.fixture";

test.skip(!demoConfigured, "Set DEMO_REHEARSAL_ENV_FILE to a disposable rehearsal stack (CHG-118)");
test.describe.configure({ mode: "serial" });

const month = previousMonth();
const expected = expectedStatements(month);
const appHost = new URL(demoBaseUrl).hostname;
const NOTE = "PROVISIONAL CHG-118 demo — fictitious M-1 assignment, not real pilot data";
const sessions = new Map<DemoUser["key"], { context: BrowserContext; page: Page }>();
const totpSecrets = new Map<string, string>();
const statementIds = new Map<string, string>();
let groupTotalFromClose = "";

// The authenticated shell can hold a hidden duplicate of the route; scope to it.
const main = (page: Page) => page.locator("#main-content");
const shot = (page: Page, name: string) =>
  page.screenshot({ path: resolve(evidenceDir, `${name}.png`), fullPage: true });
const finding = (description: string) => test.info().annotations.push({ type: "finding", description });
const readDownload = async (download: Download) => readFileSync((await download.path())!, "utf8");

async function session(browser: Browser, key: DemoUser["key"]): Promise<Page> {
  const existing = sessions.get(key);
  if (existing) return existing.page;
  const credentials = JSON.parse(readFileSync(credentialsFile, "utf8"))[key] as { username: string; password: string };
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByTestId("btn_continue_corporativo").click();
  await page.waitForURL((url) => url.hostname.startsWith("auth."));
  await page.locator("#username").fill(credentials.username);
  await page.locator("#password").fill(credentials.password);
  await page.locator("#kc-login").click();
  await Promise.race([
    page.waitForURL((url) => url.hostname === appHost),
    page.locator("#kc-totp-secret-key, #otp, a:has-text('Unable to scan?')").first().waitFor(),
  ]);
  if (new URL(page.url()).hostname !== appHost) {
    if (page.url().includes("CONFIGURE_TOTP") || await page.locator("#totp").count()) {
      const secret = page.locator("#kc-totp-secret-key");
      if (!(await secret.isVisible())) await page.getByRole("link", { name: "Unable to scan?" }).click();
      const value = (await secret.textContent())?.replaceAll(" ", "") ?? "";
      expect(value).not.toBe("");
      totpSecrets.set(credentials.username, value);
      await page.locator("#totp").fill(totp(value));
      const label = page.locator("#userLabel");
      if (await label.isVisible()) await label.fill("chg118-demo");
      await page.locator("#saveTOTPBtn").click();
    } else {
      await page.locator("#otp").fill(totp(totpSecrets.get(credentials.username)!));
      await page.locator("#kc-login").click();
    }
    await page.waitForURL((url) => url.hostname === appHost);
  }
  sessions.set(key, { context, page });
  return page;
}

test.afterAll(async () => {
  for (const { context } of sessions.values()) await context.close();
});

test.describe("S0 — register on the production-shaped stack (provisional data)", () => {
  test("IT Director check: TLS app health reports a reachable database", async ({ page }) => {
    const response = await page.goto("/api/health");
    expect(response?.status()).toBe(200);
    expect(await response?.json()).toEqual({ status: "ok", database: "reachable" });
  });

  test("US-095: Group Admin records every M-1 assignment manually, including a joiner and a leaver", async ({ browser }) => {
    const page = await session(browser, "groupAdmin");
    await page.goto("/registro");
    const manual = main(page).getByTestId("manual_register_entry");
    await expect(manual).toBeVisible();
    const record = manual.locator("form").first();
    for (const company of COMPANIES) {
      for (const person of company.people) {
        await record.locator("select[name=companyId]").selectOption({ label: company.name });
        await record.locator("select[name=personId]").selectOption({ label: person.name });
        await record.locator("select[name=vendorAccountId]").selectOption({ label: ACCOUNT.name });
        await record.locator("select[name=licenseTypeId]").selectOption({ label: LICENSE.name });
        await record.locator("input[name=startedOn]").fill(day(month.period, person.startDay));
        await record.locator("textarea[name=note]").fill(NOTE);
        const posted = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/registro");
        await record.getByRole("button", { name: "Record assignment" }).click();
        await posted;
        await expect(manual.getByRole("status")).toHaveText("Register updated.");
      }
    }
    await shot(page, "s0-01-group-admin-manual-entries");

    const leaver = COMPANIES.flatMap((company) => company.people).find((person) => person.endDay !== null)!;
    await page.reload();
    const close = main(page).getByTestId("manual_register_entry").locator("form").nth(1);
    await close.locator("select[name=assignmentId]").selectOption({ label: `${leaver.name} · ${ACCOUNT.name} · ${month.from}` });
    await close.locator("input[name=endedOn]").fill(day(month.period, leaver.endDay!));
    await close.locator("select[name=endReason]").selectOption("inactive");
    await close.locator("textarea[name=note]").fill(`${NOTE} — leaver`);
    const posted = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/registro");
    await close.getByRole("button", { name: "Close assignment" }).click();
    await posted;
    await expect(main(page).getByTestId("manual_register_entry").getByRole("status")).toHaveText("Register updated.");
    await shot(page, "s0-02-group-admin-leaver-closed");
  });

  test("Exit S0: Central Finance inspects the register and its M-1 CSV matches the entered list for five companies", async ({ browser }) => {
    const page = await session(browser, "centralFinance");
    await page.goto(`/registro?startDate=${month.from}&endDate=${month.to}`);
    await expect(main(page).getByTestId("register_table").first()).toBeVisible();
    // Manual entry is a Group Admin capability only.
    await expect(main(page).getByTestId("manual_register_entry")).toHaveCount(0);
    await shot(page, "s0-03-central-finance-register");

    const downloading = page.waitForEvent("download");
    await main(page).getByTestId("register_actions").getByRole("button", { name: "Export CSV" }).click();
    const download = await downloading;
    await download.saveAs(resolve(evidenceDir, "s0-register-M-1.csv"));
    const [header, ...rows] = parseCsv(await readDownload(download)).filter((row) => row.length > 1);
    expect(header![0]).toBe("schema_version");
    const column = (name: string) => header!.indexOf(name);
    const people = COMPANIES.reduce((sum, company) => sum + company.people.length, 0);
    expect(rows).toHaveLength(people);
    for (const row of rows) {
      expect(row[0]).toBe("register_v1");
      expect(row[column("source_kind")]).toBe("manual");
      expect(row[column("note")]).toContain("PROVISIONAL CHG-118");
    }
    for (const [index, company] of COMPANIES.entries()) {
      const companyRows = rows.filter((row) => row[column("company_code")] === company.code);
      expect(companyRows.map((row) => row[column("person_name")]).sort()).toEqual(company.people.map((person) => person.name).sort());
      for (const person of company.people) {
        const row = companyRows.find((candidate) => candidate[column("person_name")] === person.name)!;
        expect(row[column("started_on")]).toBe(day(month.period, person.startDay));
        expect(row[column("ended_on")]).toBe(person.endDay === null ? "" : day(month.period, person.endDay));
        expect(row[column("end_reason")]).toBe(person.endDay === null ? "" : "inactive");
      }
      const monthEnd = companyRows.filter((row) => row[column("ended_on")] === "").length;
      expect(monthEnd).toBe(expected.rows[index]!.monthEndHeadcount);
    }
  });

  test("US-005 scoping: Company Finance cannot open the group register or its export", async ({ browser }) => {
    const page = await session(browser, "companyFinance");
    await page.goto("/registro");
    await expect(page).toHaveURL(/\/acceso-denegado$/);
    await shot(page, "s0-04-company-finance-register-denied");
    const exportResponse = await page.goto(`/api/exports/register?startDate=${month.from}&endDate=${month.to}`);
    expect(exportResponse?.status()).toBe(403);
    finding("S0 gap: Company Finance has no own-company register/headcount surface before a close "
      + "(/registro and /api/exports/register are global-role only; /companias is a scaffold). "
      + "Its headcount is visible only as statement opening seats after S1 (US-041 not merged).");
  });
});

test.describe("S1 — first draft chargeback (provisional rate)", () => {
  test("US-032: Central Finance records a visibly provisional per-seat rate effective from M-1", async ({ browser }) => {
    const page = await session(browser, "centralFinance");
    await page.goto("/tarifas");
    const form = main(page).getByTestId("modal_add_rate");
    await form.getByLabel("Organization").selectOption({ label: ACCOUNT.name });
    await form.getByLabel("License type").selectOption({ label: LICENSE.name });
    await form.getByLabel("Monthly rate (USD)").fill(PROVISIONAL_RATE_USD);
    await form.getByLabel("Effective from").fill(month.from);
    await expect(form.locator("input[name=provisional]")).toBeChecked();
    await form.getByTestId("btn_save_rate").click();
    await expect(form.getByRole("status")).toHaveText("Rate saved");
    const row = main(page).getByTestId("rates_table").locator("tbody tr", { hasText: ACCOUNT.name });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(`$${PROVISIONAL_RATE_USD}`);
    await expect(row).toContainText(month.from);
    await expect(row).toContainText("Provisional");
    await shot(page, "s1-01-provisional-rate");
  });

  test("US-034: Central Finance runs the license-only close for M-1; five drafts and the expected group total", async ({ browser }) => {
    const page = await session(browser, "centralFinance");
    await page.goto(`/cierre?period=${month.period}`);
    await main(page).getByTestId("confirm_note").fill("PROVISIONAL CHG-118 demo close — provisional rate, fictitious register");
    await main(page).getByTestId("btn_confirm_run_close").click();
    await expect(main(page).getByTestId("modal_confirm_close").getByRole("status")).toContainText("Close succeeded", { timeout: 60_000 });
    await page.goto(`/cierre?period=${month.period}`);
    await expect(main(page).getByTestId("tile_statements_generated")).toContainText("5");
    await expect(main(page).getByTestId("tile_drafts")).toContainText("5");
    await expect(main(page).getByTestId("tile_finals")).toContainText("0");
    groupTotalFromClose = (await main(page).getByTestId("tile_group_total").locator("dd").textContent())!.trim();
    expect(groupTotalFromClose).toBe(expected.groupTotalUsd);
    await expect(main(page).getByTestId("close_nfr")).toContainText("Runtime target met");
    await shot(page, "s1-02-close-run");
  });

  test("US-096: statements list shows five drafts whose sum equals the group total", async ({ browser }) => {
    const page = await session(browser, "centralFinance");
    await page.goto(`/estados-de-cuenta?period=${month.period}`);
    const rows = main(page).locator("tr[data-testid^='statement-']");
    await expect(rows).toHaveCount(COMPANIES.length);
    let sum = BigInt(0);
    for (const row of await rows.all()) {
      const cells = row.locator("td");
      const code = (await cells.nth(0).locator("span").textContent())!.trim();
      const want = expected.rows.find((candidate) => candidate.code === code)!;
      expect(want, `unexpected company ${code}`).toBeDefined();
      await expect(cells.nth(2)).toHaveText("Draft");
      await expect(cells.nth(3)).toHaveText(String(want.openingSeats));
      await expect(cells.nth(6)).toHaveText(String(want.seatDays));
      await expect(cells.nth(8)).toHaveText(want.totalUsd);
      sum += cents((await cells.nth(8).textContent())!);
      statementIds.set(code, (await row.getAttribute("data-testid"))!.replace(/^statement-/, ""));
    }
    expect(sum).toBe(cents(expected.groupTotalUsd));
    expect(sum).toBe(cents(groupTotalFromClose));
    await shot(page, "s1-03-statements-list");
  });

  test("US-036 + US-037: a draft's detail shows register evidence and its CSV total equals the statement", async ({ browser }) => {
    const page = await session(browser, "centralFinance");
    const want = expected.rows[4]!; // the company with the dated leaver
    await page.goto(`/estados-de-cuenta/${statementIds.get(want.code)}`);
    await expect(main(page).getByTestId("status_banner")).toContainText("Draft");
    expect(cents((await main(page).getByTestId("tile_total").locator("dd").textContent())!)).toBe(cents(want.totalUsd));
    const lines = main(page).locator("[data-testid=statement_lines] tr[data-line-id]");
    await expect(lines).toHaveCount(want.lines.length);
    await expect(main(page).getByTestId("statement_lines")).toContainText("provisional_rate");
    await main(page).getByText("View evidence").first().click();
    const evidence = main(page).getByTestId("register_drilldown").first();
    await expect(evidence).toBeVisible();
    await expect(evidence).toContainText("PROVISIONAL CHG-118");
    await shot(page, "s1-04-statement-detail-evidence");

    const downloading = page.waitForEvent("download");
    await main(page).getByTestId("btn_export_csv").click();
    const download = await downloading;
    await download.saveAs(resolve(evidenceDir, `s1-statement-${want.code}.csv`));
    const [, ...records] = parseCsv(await readDownload(download)).filter((row) => row.length > 1);
    expect(records).toHaveLength(want.lines.length);
    for (const record of records) {
      expect(record[0]).toContain(want.code);
      expect(record[1]).toBe(month.period);
      expect(record[2]).toBe("Draft");
      expect(record[4]).toBe(want.totalUsd);
      expect(record[6]).toBe(statementIds.get(want.code));
      expect(record[17]).toBe("provisional_rate");
    }
    expect(records.reduce((sum, record) => sum + cents(record[16]!), BigInt(0))).toBe(cents(want.totalUsd));
    expect(records.reduce((sum, record) => sum + Number(record[14]), 0)).toBe(want.seatDays);
    expect(records.map((record) => record[16]).sort()).toEqual(want.lines.map((line) => line.amountUsd).sort());
  });

  test("IT Director rerun check: a second close replaces drafts in place and leaves a final untouched", async ({ browser }) => {
    const page = await session(browser, "centralFinance");
    // Finalization is US-035 (S2); used here only to prove the S1 "finals untouched" leg
    // on disposable data. Never finalize provisional statements on production.
    const finalCompany = COMPANIES[2]!;
    const finalCode = expected.rows[2]!.code;
    await page.goto(`/estados-de-cuenta?period=${month.period}`);
    const firstRun = new Map<string, string>();
    for (const want of expected.rows) {
      const row = main(page).getByTestId(`statement-${statementIds.get(want.code)}`);
      firstRun.set(want.code, (await row.locator("td").nth(11).textContent())!.trim());
    }
    await page.goto(`/cierre?period=${month.period}`);
    const article = main(page).getByRole("region", { name: "Finalize statements" }).locator("article", { hasText: finalCompany.name });
    await article.getByRole("checkbox").check();
    await article.getByRole("button", { name: "Finalize statement" }).click();
    await expect(article.getByRole("status")).toContainText("Statements finalized: 1");

    await page.goto(`/cierre?period=${month.period}`);
    await main(page).getByTestId("btn_confirm_run_close").click();
    await expect(main(page).getByTestId("modal_confirm_close").getByRole("status")).toContainText("Close succeeded", { timeout: 60_000 });
    const secondRun = (await main(page).getByTestId("modal_confirm_close").getByRole("status").textContent())!.split(" · ")[1]!.trim();
    await page.goto(`/estados-de-cuenta?period=${month.period}`);
    await expect(main(page).locator("tr[data-testid^='statement-']")).toHaveCount(COMPANIES.length);
    for (const want of expected.rows) {
      const cells = main(page).getByTestId(`statement-${statementIds.get(want.code)}`).locator("td");
      await expect(cells.nth(8)).toHaveText(want.totalUsd);
      if (want.code === finalCode) {
        await expect(cells.nth(2)).toHaveText("Final");
        await expect(cells.nth(11)).toHaveText(firstRun.get(want.code)!);
      } else {
        await expect(cells.nth(2)).toHaveText("Draft");
        await expect(cells.nth(11)).toHaveText(secondRun);
      }
    }
    await shot(page, "s1-05-rerun-final-untouched");
  });

  test("US-005: Company Finance opens only its own draft (headcount, total, CSV) and is refused another company's", async ({ browser }) => {
    const page = await session(browser, "companyFinance");
    const own = expected.rows[0]!;
    const other = expected.rows[1]!;
    await page.goto(`/estados-de-cuenta?period=${month.period}`);
    const rows = main(page).locator("tr[data-testid^='statement-']");
    await expect(rows).toHaveCount(1);
    await expect(rows.first().locator("td").nth(0)).toContainText(own.code);
    await expect(rows.first().locator("td").nth(2)).toHaveText("Draft");
    await expect(rows.first().locator("td").nth(3)).toHaveText(String(own.openingSeats));
    await expect(rows.first().locator("td").nth(6)).toHaveText(String(own.seatDays));
    await expect(rows.first().locator("td").nth(8)).toHaveText(own.totalUsd);
    await expect(main(page).getByTestId("filter_company")).toHaveCount(0);
    await shot(page, "s1-06-company-finance-own-list");

    await page.goto(`/estados-de-cuenta/${statementIds.get(own.code)}`);
    expect(cents((await main(page).getByTestId("tile_total").locator("dd").textContent())!)).toBe(cents(own.totalUsd));
    await expect(main(page).getByTestId("btn_view_register")).toHaveCount(0);
    const downloading = page.waitForEvent("download");
    await main(page).getByTestId("btn_export_csv").click();
    const [, ...records] = parseCsv(await readDownload(await downloading)).filter((row) => row.length > 1);
    expect(records).toHaveLength(own.lines.length);
    expect(records.every((record) => record[4] === own.totalUsd)).toBe(true);
    await shot(page, "s1-07-company-finance-own-detail");

    // Another company's statement id is refused with the access-denied screen, no data.
    await page.goto(`/estados-de-cuenta/${statementIds.get(other.code)}`);
    await expect(page).toHaveURL(/\/acceso-denegado$/);
    await expect(page.getByText(other.code)).toHaveCount(0);
    await expect(page.getByTestId("tile_total")).toHaveCount(0);
    const foreignCsv = await page.goto(`/api/v1/statements/${statementIds.get(other.code)}/export/csv`);
    expect([403, 404]).toContain(foreignCsv?.status());
    await shot(page, "s1-08-company-finance-foreign-refused");
  });
});

