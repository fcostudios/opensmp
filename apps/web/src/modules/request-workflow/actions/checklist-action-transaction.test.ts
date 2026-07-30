import { expect, it } from "vitest";

it("exposes the audited checklist mutation service used by server actions", async () => {
  const actionTransaction = await import("./checklist-action-transaction");

  expect(actionTransaction).toHaveProperty(
    "createChecklistActionService",
    expect.any(Function),
  );
});
