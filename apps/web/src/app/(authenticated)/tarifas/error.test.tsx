// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import ErrorBoundary from "./error";
import Loading from "./loading";
afterEach(cleanup);
test("reports loading and offers a working retry after a rate workspace failure", () => {
  const loading = render(<Loading />);
  expect(screen.getByRole("status").textContent).toBe("Loading rates and capacity…");
  loading.unmount();
  let retries = 0;
  render(<ErrorBoundary reset={() => { retries++; }} />);
  expect(screen.getByRole("alert").textContent).toContain("Unable to load rates and capacity");
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(retries).toBe(1);
});
