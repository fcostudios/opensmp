// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import messages from "@/lib/i18n/en-US.json";
import { CloseView } from "./close-view";
import Loading from "@/app/(authenticated)/cierre/loading";
import ErrorState from "@/app/(authenticated)/cierre/error";
beforeEach(()=>vi.stubEnv("TZ","UTC"));
afterEach(()=>{cleanup();vi.unstubAllEnvs();});
const t=messages.close;

test("renders license-only explanation, empty run state and submits period and note with pending state",async()=>{
  let finish!:(value:{status:"succeeded";runId:string;durationMs:number})=>void;
  let submitted:FormData|undefined;
  render(<CloseView period="2026-01" latest={null} action={async(_state,form)=>{submitted=form;return new Promise(resolve=>{finish=resolve;});}}/>);
  expect(screen.getByText(t.licenseOnly)).toBeTruthy();expect(screen.getByText(t.noRun)).toBeTruthy();
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.getByRole("link",{name:t.refresh}).getAttribute("href")).toBe("/cierre?period=2026-01");
  fireEvent.change(screen.getByLabelText(t.note),{target:{value:"Check transfer"}});
  fireEvent.submit(screen.getByTestId("modal_confirm_close"));
  await waitFor(()=>expect(screen.getByRole("button",{name:t.running}).hasAttribute("disabled")).toBe(true));
  expect(submitted?.get("period")).toBe("2026-01");expect(submitted?.get("note")).toBe("Check transfer");
  await act(async()=>finish({status:"succeeded",runId:"run-1",durationMs:1234}));
  expect(screen.getByRole("status").textContent).toContain(t.succeeded);expect(screen.getByRole("status").textContent).toContain("1.234");
  expect(screen.getByRole("button",{name:t.run}).hasAttribute("disabled")).toBe(false);
});

test("shows persisted failure, period, run identifier, note and duration; action errors are visible",async()=>{
  render(<CloseView period="2026-01" latest={{id:"run-old",period:"2026-01",status:"failed",note:"Missing rate",startedAt:new Date("2026-02-01T00:00:00Z"),finishedAt:new Date("2026-02-01T00:00:03Z")}} action={async()=>({status:"error"})}/>);
  expect(screen.getByTestId("latest_close_run").textContent).toContain("run-old");expect(screen.getByTestId("latest_close_run").textContent).toContain("3");
  expect(screen.getByText("Missing rate").tagName).toBe("P");
  expect(screen.getByText(`${t.duration}: 3 ${t.seconds}`)).toBeTruthy();expect(screen.getByText(t.failed)).toBeTruthy();
  fireEvent.submit(screen.getByTestId("modal_confirm_close"));await waitFor(()=>expect(screen.getByRole("alert").textContent).toBe(t.error));
});

test("route boundaries and running or failed runs remain visible and recoverable",async()=>{
  const loading=render(<Loading/>);expect(screen.getByRole("status").textContent).toBe(t.loading);loading.unmount();
  let resets=0;const error=render(<ErrorState reset={()=>{resets++;}}/>);expect(screen.getByRole("alert").textContent).toBe(t.loadError);fireEvent.click(screen.getByRole("button",{name:t.retry}));expect(resets).toBe(1);error.unmount();
  render(<CloseView period="2026-01" latest={{id:"running",period:"2026-01",status:"running",note:null,startedAt:new Date("2026-02-01T00:00:00Z"),finishedAt:null}} action={async()=>({status:"failed",runId:"failed",durationMs:1234})}/>);
  expect(screen.getByTestId("latest_close_run").textContent).toContain(t.running);
  fireEvent.submit(screen.getByTestId("modal_confirm_close"));await waitFor(()=>expect(screen.getByRole("alert").textContent).toContain(t.failed));
  expect(screen.getByRole("alert").textContent).toContain("1.234");
});

test("latest run binds actor, tiles and strict five-minute NFR without claiming failed runs meet target",()=>{
  const latest={id:"newest",period:"2026-10",status:"succeeded" as const,note:null,triggeredByName:"finance@test.invalid",startedAt:new Date("2026-11-06T10:30:00Z"),finishedAt:new Date("2026-11-06T10:34:59Z")};
  const view=render(<CloseView period="2026-10" latest={latest} summary={{generated:2,companies:3,drafts:1,finals:1,totalUsd:"42.18"}} action={async()=>({status:"error"})}/>);
  expect(screen.getByTestId("latest_close_run").textContent).toContain("finance@test.invalid");
  expect(screen.getByTestId("latest_close_run").querySelector("time")?.textContent).toBe("11/6/2026, 5:30:00 AM");
  expect(screen.getByTestId("tile_current_period").textContent).toContain("2026-10");
  expect(screen.getByTestId("tile_statements_generated").textContent).toContain("2/3");
  expect(screen.getByTestId("tile_drafts").textContent).toContain("1");
  expect(screen.getByTestId("tile_finals").textContent).toContain("1");
  expect(screen.getByTestId("tile_group_total").textContent).toContain("USD 42.18");
  expect(screen.getByTestId("close_nfr").textContent).toContain(t.withinTarget);
  view.rerender(<CloseView period="2026-10" latest={{...latest,finishedAt:new Date("2026-11-06T10:35:00Z")}} action={async()=>({status:"error"})}/>);
  expect(screen.getByTestId("close_nfr").textContent).toContain(t.overTarget);
  view.rerender(<CloseView period="2026-10" latest={{...latest,finishedAt:null}} action={async()=>({status:"error"})}/>);
  expect(screen.getByTestId("close_nfr").textContent).toContain(t.succeeded);
  expect(screen.getByTestId("close_nfr").textContent).not.toContain(t.withinTarget);
  view.rerender(<CloseView period="2026-10" latest={{...latest,status:"failed"}} action={async()=>({status:"error"})}/>);
  expect(screen.getByTestId("close_nfr").textContent).toContain(t.failed);
  view.rerender(<CloseView period="2026-10" latest={{...latest,status:"running",finishedAt:null,triggeredByName:"system@ledger.invalid",scheduled:true}} action={async()=>({status:"error"})}/>);
  expect(screen.getByTestId("latest_close_run").textContent).toContain(t.scheduled);
  expect(screen.getByTestId("close_nfr").textContent).toContain(t.running);
  expect(screen.getByRole("button",{name:t.run}).hasAttribute("disabled")).toBe(true);
});
