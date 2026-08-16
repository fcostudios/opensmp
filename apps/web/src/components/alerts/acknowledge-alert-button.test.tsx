// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AcknowledgeAlertButton } from "./acknowledge-alert-button";

const navigation = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: navigation.refresh }),
}));

afterEach(() => {
  cleanup();
  navigation.refresh.mockClear();
});

const labels = {
  action: "Reconocer",
  confirmTitle: "Reconocer alerta",
  confirmBody: "Vas a marcar esta alerta como revisada. Quedará registrado tu usuario y la hora.",
  confirm: "Reconocer",
  cancel: "Cancelar",
  success: "Alerta reconocida. Gracias por revisarla.",
  error: "No pudimos reconocer la alerta.",
};
const eventId = "00000000-0000-4000-8000-000000004301";

describe("AcknowledgeAlertButton", () => {
  it("does not acknowledge until the confirmation is accepted", () => {
    const acknowledge = vi.fn();
    render(
      <AcknowledgeAlertButton
        alertEventId={eventId} labels={labels} acknowledge={acknowledge}
      />,
    );

    fireEvent.click(screen.getByTestId("act_reconocer"));

    expect(screen.getByText(labels.confirmBody)).toBeDefined();
    expect(acknowledge).not.toHaveBeenCalled();
  });

  it("acknowledges and reports success after confirmation", async () => {
    const acknowledge = vi.fn().mockResolvedValue({
      ok: true, acknowledgedBy: "actor", acknowledgedAt: "2026-08-15T12:00:00.000Z",
    });
    render(
      <AcknowledgeAlertButton
        alertEventId={eventId} labels={labels} acknowledge={acknowledge}
      />,
    );

    fireEvent.click(screen.getByTestId("act_reconocer"));
    fireEvent.click(screen.getByTestId("act_reconocer_confirm"));

    expect(acknowledge).toHaveBeenCalledWith({ alertEventId: eventId });
    expect(await screen.findByText(labels.success)).toBeDefined();
    expect(navigation.refresh).toHaveBeenCalledTimes(1);
  });

  it("surfaces a failure without claiming success", async () => {
    const acknowledge = vi.fn().mockResolvedValue({ ok: false, error: "not_found" });
    render(
      <AcknowledgeAlertButton
        alertEventId={eventId} labels={labels} acknowledge={acknowledge}
      />,
    );

    fireEvent.click(screen.getByTestId("act_reconocer"));
    fireEvent.click(screen.getByTestId("act_reconocer_confirm"));

    expect(await screen.findByText(labels.error)).toBeDefined();
    expect(screen.queryByText(labels.success)).toBeNull();
    expect(navigation.refresh).not.toHaveBeenCalled();
  });

  it("abandons the acknowledgment when the confirmation is cancelled", () => {
    const acknowledge = vi.fn();
    render(
      <AcknowledgeAlertButton
        alertEventId={eventId} labels={labels} acknowledge={acknowledge}
      />,
    );

    fireEvent.click(screen.getByTestId("act_reconocer"));
    fireEvent.click(screen.getByTestId("act_reconocer_cancel"));

    expect(acknowledge).not.toHaveBeenCalled();
    expect(screen.queryByText(labels.confirmBody)).toBeNull();
  });

  it("disables cancel while a confirmation is in flight, so it can't hide a running mutation", async () => {
    let resolveAcknowledge!: (value: { ok: boolean }) => void;
    const pendingAcknowledge = new Promise<{ ok: boolean }>((resolve) => {
      resolveAcknowledge = resolve;
    });
    const acknowledge = vi.fn().mockReturnValue(pendingAcknowledge);
    render(
      <AcknowledgeAlertButton
        alertEventId={eventId} labels={labels} acknowledge={acknowledge}
      />,
    );

    fireEvent.click(screen.getByTestId("act_reconocer"));
    fireEvent.click(screen.getByTestId("act_reconocer_confirm"));

    expect((screen.getByTestId("act_reconocer_cancel") as HTMLButtonElement).disabled).toBe(true);

    resolveAcknowledge({ ok: true });
    expect(await screen.findByText(labels.success)).toBeDefined();
  });

  it("surfaces an error when the acknowledge call throws instead of resolving", async () => {
    const acknowledge = vi.fn().mockRejectedValue(new Error("DATABASE_URL is required"));
    render(
      <AcknowledgeAlertButton
        alertEventId={eventId} labels={labels} acknowledge={acknowledge}
      />,
    );

    fireEvent.click(screen.getByTestId("act_reconocer"));
    fireEvent.click(screen.getByTestId("act_reconocer_confirm"));

    expect(await screen.findByText(labels.error)).toBeDefined();
    expect(screen.queryByText(labels.success)).toBeNull();
    expect(navigation.refresh).not.toHaveBeenCalled();
  });
});
