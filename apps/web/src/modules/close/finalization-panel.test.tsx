// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import messages from "@/lib/i18n/en-US.json";
import { FinalizationPanel } from "./finalization-panel";
afterEach(cleanup);
const t=messages.finalization;
const rows=[{id:"a",companyName:"Company A",status:"draft" as const},{id:"b",companyName:"Company B",status:"final" as const},{id:"c",companyName:"Company C",status:"reconciled" as const}];
test("requires explicit confirmation for period and single commands, shows statuses and pending/result feedback",async()=>{
  const submitted:FormData[]=[];
  let finish!:(value:{status:"finalized";count:number})=>void;
  render(<FinalizationPanel period="2026-01" statements={rows} singleAction={async(_state,form)=>{submitted.push(form);return new Promise(resolve=>{finish=resolve;});}} periodAction={async(_state,form)=>{submitted.push(form);return {status:"finalized",count:1};}}/>);
  expect(screen.getByText(t.draft)).toBeTruthy();expect(screen.getByText(t.final)).toBeTruthy();expect(screen.getByText(t.reconciled)).toBeTruthy();
  expect(screen.getAllByRole("button")).toHaveLength(2);
  expect(screen.queryByRole("alert")).toBeNull();expect(screen.queryByText(t.empty)).toBeNull();
  expect(screen.getByRole("button",{name:t.single}).hasAttribute("disabled")).toBe(true);
  fireEvent.click(screen.getAllByRole("checkbox")[1]!);
  fireEvent.click(screen.getByRole("button",{name:t.single}));
  await waitFor(()=>expect(submitted).toHaveLength(1));
  expect(submitted[0]?.get("statementId")).toBe("a");expect(submitted[0]?.get("period")).toBe("2026-01");expect(submitted[0]?.get("confirmed")).toBe("true");
  expect(screen.getByRole("button",{name:t.pending}).hasAttribute("disabled")).toBe(true);
  await act(async()=>finish({status:"finalized",count:1}));
  expect(screen.getByRole("status").textContent).toBe(`${t.success}: 1`);
  fireEvent.click(screen.getAllByRole("checkbox")[0]!);
  fireEvent.click(screen.getByRole("button",{name:t.period}));
  await waitFor(()=>expect(submitted).toHaveLength(2));
  expect(submitted[1]?.get("statementId")).toBeNull();expect(submitted[1]?.get("period")).toBe("2026-01");expect(submitted[1]?.get("confirmed")).toBe("true");
});
test("empty periods have no finalization controls; a failed command exposes a recoverable error",async()=>{
  const action=async()=>({status:"error" as const});
  const empty=render(<FinalizationPanel period="2026-02" statements={[]} singleAction={action} periodAction={action}/>);
  expect(screen.getByText(t.empty)).toBeTruthy();expect(screen.queryByRole("button")).toBeNull();empty.unmount();
  render(<FinalizationPanel period="2026-01" statements={rows} singleAction={action} periodAction={action}/>);
  fireEvent.click(screen.getAllByRole("checkbox")[0]!);fireEvent.click(screen.getByRole("button",{name:t.period}));
  await waitFor(()=>expect(screen.getByRole("alert").textContent).toBe(t.error));
});

test("final and reconciled periods expose status chips without any finalization form",()=>{
  const action=async()=>({status:"error" as const});
  render(<FinalizationPanel period="2026-01" statements={rows.slice(1)} singleAction={action} periodAction={action}/>);
  expect(screen.queryByRole("button")).toBeNull();expect(screen.queryByRole("checkbox")).toBeNull();
  expect(screen.queryByText(t.empty)).toBeNull();
  expect(screen.getByText(t.final)).toBeTruthy();expect(screen.getByText(t.reconciled)).toBeTruthy();
});
