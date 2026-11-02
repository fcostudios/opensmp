// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { RollupPanel } from "./rollup-panel";
import messages from "../../../messages/en-US.json";
afterEach(cleanup);
const t=messages.rollup;
test("selected period reaches reconciliation and export; success provides the actual CSV download",async()=>{
 let submitted: unknown;
 render(<RollupPanel period="2026-01" reconciliationTotalUsd="62.00" ties={true} t={t} action={async period=>{submitted=period;return {csv:'"Company","Period","Total (USD)"\r\n"A","2026-01",62.00\r\n',filename:"rollup-2026-01.csv"};}}/>);
 expect(screen.getByTestId("rollup_reconciliation_total").textContent).toContain("62.00");
 expect(screen.queryByRole("alert")).toBeNull();
 expect(screen.getByRole("status").textContent).toBe(t.tied);
 expect(screen.getByRole("link",{name:t.reconciliation}).getAttribute("href")).toBe("/conciliacion?period=2026-01");
 fireEvent.click(screen.getByTestId("btn_export_rollup_csv"));
 await waitFor(()=>expect(screen.getByRole("link",{name:t.download}).getAttribute("download")).toBe("rollup-2026-01.csv"));
 expect(submitted).toBe("2026-01");
 expect(decodeURIComponent(screen.getByRole("link",{name:t.download}).getAttribute("href")!)).toContain('"A","2026-01",62.00');
});
test("untied drafts show explanation and export failures are recoverable",async()=>{
 let reject!:(reason:Error)=>void;
 render(<RollupPanel period="2026-02" reconciliationTotalUsd="0.00" ties={false} t={t} action={async()=>new Promise((_resolve,fail)=>{reject=fail;})}/>);
 expect(screen.getByRole("status").textContent).toBe(t.untied);expect(screen.queryByRole("link",{name:t.download})).toBeNull();
 fireEvent.click(screen.getByTestId("btn_export_rollup_csv"));
 await waitFor(()=>expect(screen.getByTestId("btn_export_rollup_csv").hasAttribute("disabled")).toBe(true));
 reject(new Error("unavailable"));
 await waitFor(()=>expect(screen.getByRole("alert").textContent).toBe(t.error));
 expect(screen.getByTestId("btn_export_rollup_csv").hasAttribute("disabled")).toBe(false);
 fireEvent.click(screen.getByTestId("btn_export_rollup_csv"));
 await waitFor(()=>expect(screen.getByTestId("btn_export_rollup_csv").hasAttribute("disabled")).toBe(true));
 expect(screen.queryByRole("alert")).toBeNull();
 reject(new Error("still unavailable"));
 await waitFor(()=>expect(screen.getByRole("alert").textContent).toBe(t.error));
});
