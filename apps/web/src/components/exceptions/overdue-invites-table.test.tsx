// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import en from "../../../messages/en-US.json";
import es from "../../../messages/es-EC.json";
import { OverdueInvitesTable } from "./overdue-invites-table";
afterEach(cleanup);

test("shows the invitation's request link and localized fractional age", () => {
  render(<OverdueInvitesTable items={[{requestId:"67000000-0000-4000-8000-000000000001",requestNo:"REQ-067",ageHours:168.001}]} labels={en.exceptions.overdueInvites} locale="en-US" />);
  expect(screen.getByRole("link",{name:"REQ-067"}).getAttribute("href")).toBe("/solicitudes/67000000-0000-4000-8000-000000000001");
  expect(screen.getByText("168.001").textContent).toBe("168.001");
  expect(screen.getByRole("columnheader",{name:en.exceptions.overdueInvites.ageHours})).toBeTruthy();
});
test("shows the locale catalog empty state", () => {
  render(<OverdueInvitesTable items={[]} labels={es.exceptions.overdueInvites} locale="es-EC" />);
  expect(screen.getByText(es.exceptions.overdueInvites.empty)).toBeTruthy();
  expect(screen.queryByRole("link")).toBeNull();
});
