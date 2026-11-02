// @vitest-environment jsdom
import React from "react";
import { cleanup,fireEvent,render,screen } from "@testing-library/react";
import { afterEach,expect,test } from "vitest";
import ErrorBoundary from "./error";
import messages from "@/lib/i18n/en-US.json";
afterEach(cleanup);
test("errors offer a working retry",()=>{
 let retries=0;render(<ErrorBoundary reset={()=>{retries++;}}/>);
 expect(screen.getByRole("alert").textContent).toContain(messages.reconciliation.error);
 fireEvent.click(screen.getByRole("button",{name:messages.reconciliation.retry}));expect(retries).toBe(1);
});
