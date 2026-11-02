// @vitest-environment jsdom
import React from "react";
import { cleanup,render,screen } from "@testing-library/react";
import { afterEach,expect,test } from "vitest";
import Loading from "./loading";
import messages from "@/lib/i18n/en-US.json";
afterEach(cleanup);
test("loading exposes a status while the period loads",()=>{
 render(<Loading/>);expect(screen.getByRole("status").textContent).toBe(messages.reconciliation.loading);
});
