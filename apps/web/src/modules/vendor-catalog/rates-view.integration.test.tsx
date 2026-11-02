// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, test } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@smp/db/schema";
import { createPostgresFixture } from "@smp/db/testing/postgres-container";
import { createRateService } from "./rate-service";
import { createRateServerActions } from "./actions/manage-rates-server-actions-factory";
import { RatesView } from "./rates-view";
import type { LedgerAuthorization } from "../identity-access/authorization";

test("manual form sends exact evidence to the real audited action and shows a rejected overlap", async () => {
  const fixture = await createPostgresFixture(); await fixture.migrate();
  const client = await fixture.connectAsApp();
  const database = drizzle(client, { schema });
  const now = new Date("2026-11-01T00:00:00Z");
  const actor = "32000000-0000-4000-8000-000000000011";
  const authorization: LedgerAuthorization = { userId: actor, userAccountId: actor, idpSubject: "system",
    globalRole: "central_finance", roles: ["central_finance"], companyIds: [], companyGrants: [], employeeCompanyId: null };
  try {
    await database.insert(schema.userAccount).values({ id: actor, email: "rates-form@test.invalid", status: "active", globalRole: "central_finance", createdAt: now });
    const [vendor] = await database.insert(schema.vendor).values({ name: "Form vendor", connectorType: "manual", provisioningProtocol: "none", canProvision: false, canDeprovision: false, hasUsageData: false, hasCostData: false, identityMatching: "email", status: "active", createdAt: now, createdBy: actor }).returning();
    const [account] = await database.insert(schema.vendorAccount).values({ name: "Form org", vendorId: vendor.id, mode: "orchestration", lowPoolFloor: 0, status: "active", createdAt: now, createdBy: actor }).returning();
    const [license] = await database.insert(schema.licenseType).values({ name: "Form seat", vendorId: vendor.id, unit: "seat", status: "active", createdAt: now, createdBy: actor }).returning();
    const service = createRateService(database, { now: () => now });
    const actions = createRateServerActions({ database, now: () => now, loadAuthorization: async () => authorization, revalidate: () => {} });
    const { rerender } = render(<RatesView data={await service.workspace(authorization)} action={actions.saveRateCard} />);
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.change(screen.getByLabelText("Organization"), { target: { value: account.id } });
    fireEvent.change(screen.getByLabelText("License type"), { target: { value: license.id } });
    fireEvent.change(screen.getByLabelText("Monthly rate (USD)"), { target: { value: "62.25" } });
    fireEvent.change(screen.getByLabelText("Effective from"), { target: { value: "2026-01-01" } });
    fireEvent.change(screen.getByLabelText("Effective to (inclusive)"), { target: { value: "2026-01-31" } });
    fireEvent.submit(screen.getByTestId("modal_add_rate"));
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Rate saved"));
    expect(screen.queryByRole("alert")).toBeNull();
    const [row] = await database.select().from(schema.rateCard);
    expect(row.monthlyRateUsd).toBe("62.25"); expect(row.provisional).toBe(true);
    expect(row.vendorAccountId).toBe(account.id); expect(row.licenseTypeId).toBe(license.id);
    expect(row.effectiveFrom).toBe("2026-01-01"); expect(row.effectiveTo).toBe("2026-01-31");
    rerender(<RatesView data={await service.workspace(authorization)} action={actions.saveRateCard} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit rate" }));
    fireEvent.change(screen.getByLabelText("Monthly rate (USD)"), { target: { value: "64.75" } });
    fireEvent.click(screen.getByLabelText("Provisional rate"));
    fireEvent.submit(screen.getByTestId("modal_add_rate"));
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Rate saved"));
    expect(screen.queryByRole("alert")).toBeNull();
    const updated = await database.select().from(schema.rateCard);
    expect(updated).toHaveLength(1);
    expect(updated[0].id).toBe(row.id);
    expect(updated[0].vendorAccountId).toBe(account.id); expect(updated[0].licenseTypeId).toBe(license.id);
    expect(updated[0].effectiveFrom).toBe("2026-01-01"); expect(updated[0].effectiveTo).toBe("2026-01-31");
    expect(updated[0].monthlyRateUsd).toBe("64.75"); expect(updated[0].provisional).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Cancel edit" }));
    // React resets uncontrolled new-form fields on success; retry the same dated period.
    fireEvent.change(screen.getByLabelText("Organization"), { target: { value: account.id } });
    fireEvent.change(screen.getByLabelText("License type"), { target: { value: license.id } });
    fireEvent.change(screen.getByLabelText("Monthly rate (USD)"), { target: { value: "70.00" } });
    fireEvent.change(screen.getByLabelText("Effective from"), { target: { value: "2026-01-31" } });
    fireEvent.submit(screen.getByTestId("modal_add_rate"));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Unable to save"));
    expect(await database.select().from(schema.rateCard)).toHaveLength(1);
  } finally { cleanup(); await client.end(); await fixture.stop(); }
}, 120_000);
