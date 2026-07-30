import { expect, it } from "vitest";

it("exposes a production member-sync port without an HTTP or server-action boundary", async () => {
  const observationModule = await import(
    "./member-sync-checklist-observation"
  );

  expect(observationModule).toHaveProperty(
    "createMemberSyncChecklistObservationPort",
    expect.any(Function),
  );
  const port = observationModule.createMemberSyncChecklistObservationPort(
    "postgresql://unused:unused@127.0.0.1:1/unused",
  );
  expect(port).toHaveProperty("record", expect.any(Function));
  await port.close();
});
