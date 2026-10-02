// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import en from "../../../messages/en-US.json";
import es from "../../../messages/es-EC.json";
import { OverdueInvitesTable } from "./overdue-invites-table";
afterEach(cleanup);

test("shows the invitation's request link and localized fractional age", () => {
  render(<OverdueInvitesTable items={[{requestId:"67000000-0000-4000-8000-000000000001",requestNo:"REQ-067",actionId:"67000000-0000-4000-8000-000000000002",ageHours:168.001}]} labels={en.exceptions.overdueInvites} locale="en-US" />);
  expect(screen.getByRole("link",{name:"REQ-067"}).getAttribute("href")).toBe("/solicitudes/67000000-0000-4000-8000-000000000001");
  expect(screen.getByText("168.001").textContent).toBe("168.001");
  expect(screen.getByRole("columnheader",{name:en.exceptions.overdueInvites.ageHours})).toBeTruthy();
});
test("shows the locale catalog empty state", () => {
  render(<OverdueInvitesTable items={[]} labels={es.exceptions.overdueInvites} locale="es-EC" />);
  expect(screen.getByText(es.exceptions.overdueInvites.empty)).toBeTruthy();
  expect(screen.queryByRole("link")).toBeNull();
});

const selected={requestId:"68000000-0000-4000-8000-000000000001",actionId:"68000000-0000-4000-8000-000000000002",requestNo:"REQ-068",ageHours:169};
test("carries selected request and action, requires note and displays localized success without duplicate pending submit",async()=>{
 let resolve!: (value:{ok:true;requestId:string;actionId:string})=>void;
 let submitted:FormData|undefined;let calls=0;
 const outcome=new Promise<{ok:true;requestId:string;actionId:string}>(done=>{resolve=done;});
 render(<OverdueInvitesTable items={[selected]} labels={en.exceptions.overdueInvites} locale="en-US" withdrawAction={async(form)=>{calls++;submitted=form;return outcome;}} />);
 const button=screen.getByRole("button",{name:en.exceptions.overdueInvites.withdraw});
 const note=screen.getByRole("textbox",{name:en.exceptions.overdueInvites.note}) as HTMLTextAreaElement;
 expect(note.required).toBe(true);expect(note.maxLength).toBe(2000);expect(note.disabled).toBe(false);
 fireEvent.change(note,{target:{value:"Not needed"}});fireEvent.submit(button.closest("form")!);
 await waitFor(()=>expect(submitted?.get("requestId")).toBe(selected.requestId));
 expect(submitted!.get("actionId")).toBe(selected.actionId);expect(submitted!.get("commandId")).toBe(selected.actionId);expect(submitted!.get("note")).toBe("Not needed");
 expect((screen.getByRole("button",{name:en.exceptions.overdueInvites.pending}) as HTMLButtonElement).disabled).toBe(true);expect(note.disabled).toBe(true);
 resolve({ok:true,requestId:selected.requestId,actionId:selected.actionId});
 await waitFor(()=>expect(screen.getByRole("status").textContent).toBe(en.exceptions.overdueInvites.success));
 expect((screen.getByRole("button",{name:en.exceptions.overdueInvites.withdraw}) as HTMLButtonElement).disabled).toBe(true);expect(note.disabled).toBe(true);
 await act(async()=>{fireEvent.submit(button.closest("form")!);});expect(calls).toBe(1);
});
test.each(["conflict","forbidden","invalid","unsupported","provider_error","ambiguous"] as const)("localizes inline %s refusal",async(error)=>{
 render(<OverdueInvitesTable items={[selected]} labels={es.exceptions.overdueInvites} locale="es-EC" withdrawAction={async()=>({ok:false,error})} />);
 fireEvent.change(screen.getByRole("textbox"),{target:{value:"No se necesita"}});
 fireEvent.submit(screen.getByRole("button").closest("form")!);
 await waitFor(()=>expect(screen.getByRole("alert").textContent).toBe(es.exceptions.overdueInvites.errors[error]));
});

test("thrown action outcome is localized as ambiguous and permits a later retry",async()=>{
 let calls=0;render(<OverdueInvitesTable items={[selected]} labels={en.exceptions.overdueInvites} locale="en-US" withdrawAction={async()=>{calls++;throw new Error("Lost outcome");}} />);
 fireEvent.change(screen.getByRole("textbox"),{target:{value:"Not needed"}});fireEvent.submit(screen.getByRole("button").closest("form")!);
 await waitFor(()=>expect(screen.getByRole("alert").textContent).toBe(en.exceptions.overdueInvites.errors.ambiguous));expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(false);
 await act(async()=>{fireEvent.submit(screen.getByRole("button").closest("form")!);});expect(calls).toBe(2);
});
