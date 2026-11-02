// @vitest-environment jsdom
import React from "react";
import { act,cleanup,fireEvent,render,screen,waitFor } from "@testing-library/react";
import { afterEach,beforeEach,expect,test,vi } from "vitest";
import messages from "@/lib/i18n/en-US.json";
let ReconciliationView:typeof import("./reconciliation-view")["ReconciliationView"];
// Rebuild module-level render helpers under the active mutation, not the dry-run cache.
beforeEach(async()=>{vi.resetModules();({ReconciliationView}=await import("./reconciliation-view"));});
import type { ReconciliationCard } from "./reconciliation-transaction";
afterEach(cleanup);
const t=messages.reconciliation;
const card={vendorAccountId:"org-a",name:"Organization A",rollupAmountUsd:"10049.00",invoiceAmountUsd:"10000.00",status:"open",lines:[]} as unknown as ReconciliationCard;
const saved=async()=>({status:"saved" as const});
const actions={saveInvoiceAmount:saved,overrideReconciliation:saved,saveVarianceLine:saved,deleteVarianceLine:saved};
test("renders per-org money, tolerance feedback and immutable terminal evidence",()=>{
 const line={id:"line-a",cause:"timing",detail:"Explained timing",registerAmountUsd:"10.00",invoiceAmountUsd:"11.00",differenceUsd:"-1.00",evidenceUrl:"https://example.test/evidence"};
 render(<ReconciliationView period="2026-01" cards={[{...card,status:"reconciled",lines:[line]} as ReconciliationCard]} actions={actions}/>);
 expect(screen.getByText("Organization A")).toBeTruthy();
 expect(screen.getByText(/10,049.00/)).toBeTruthy();
 expect(screen.getByText(t.within)).toBeTruthy();expect(screen.getByText(t.reconciled)).toBeTruthy();
 expect(screen.getByRole("link",{name:t.evidence}).getAttribute("href")).toBe(line.evidenceUrl);
 expect(screen.getByText(/Explained timing/)).toBeTruthy();expect(screen.queryByRole("button",{name:t.saveInvoice})).toBeNull();
 expect(screen.getByText(/-\$1.00/)).toBeTruthy();
 expect(screen.getByText(`${t.registerAmount}: $10.00 · ${t.lineInvoiceAmount}: $11.00 · ${t.difference}: -$1.00`)).toBeTruthy();
});
test("invoice form posts scoped input, pending/error feedback and opens a mandatory-note override dialog",async()=>{
 const submitted:FormData[]=[];
 render(<ReconciliationView period="2026-01" cards={[{...card,invoiceAmountUsd:"100.00"}]} actions={{...actions,saveInvoiceAmount:async(_state,form)=>{submitted.push(form);return {status:"error"};}}}/>);
 expect(screen.getByText(t.outside)).toBeTruthy();
 fireEvent.click(screen.getByRole("button",{name:t.saveInvoice}));
 await waitFor(()=>expect(screen.getByRole("alert").textContent).toBe(t.error));
 expect(submitted[0]?.get("period")).toBe("2026-01");expect(submitted[0]?.get("vendorAccountId")).toBe("org-a");expect(submitted[0]?.get("invoiceAmountUsd")).toBe("100.00");
 fireEvent.click(screen.getByRole("button",{name:t.override}));
 expect(screen.getByRole("dialog")).toBeTruthy();expect(screen.queryByRole("status")).toBeNull();expect(screen.getByLabelText(t.note).hasAttribute("required")).toBe(true);
 fireEvent.click(screen.getByRole("button",{name:t.cancel}));expect(screen.queryByRole("dialog")).toBeNull();
});
test("variance forms submit amounts, evidence, update identity and delete identity",async()=>{
 const submissions:FormData[]=[];
 const save=async(_state:unknown,form:FormData)=>{submissions.push(form);return {status:"saved" as const};};
 render(<ReconciliationView period="2026-01" cards={[{...card,invoiceAmountUsd:null,lines:[{id:"line-a",cause:"timing",detail:"Explained",registerAmountUsd:"1.00",invoiceAmountUsd:"2.00",differenceUsd:"-1.00",evidenceUrl:"https://example.test/existing"}]} as ReconciliationCard]} actions={{...actions,saveVarianceLine:save,deleteVarianceLine:save}}/>);
 expect(screen.getByText(t.noInvoice)).toBeTruthy();expect(screen.queryByRole("button",{name:t.override})).toBeNull();
 fireEvent.click(screen.getAllByRole("button",{name:t.saveLine})[0]!);
 await waitFor(()=>expect(submissions).toHaveLength(1));
 expect(submissions[0]?.get("lineId")).toBe("line-a");expect(submissions[0]?.get("detail")).toBe("Explained");
 expect(submissions[0]?.get("cause")).toBe("timing");expect(submissions[0]?.get("evidenceUrl")).toBe("https://example.test/existing");
 expect(submissions[0]?.get("registerAmountUsd")).toBe("1.00");expect(submissions[0]?.get("invoiceAmountUsd")).toBe("2.00");
 await waitFor(()=>expect(screen.getByRole("status").textContent).toBe(t.saved));
 fireEvent.click(screen.getByRole("button",{name:t.deleteLine}));
 await waitFor(()=>expect(submissions).toHaveLength(2));expect(submissions[1]?.get("lineId")).toBe("line-a");
});
test("empty workbench explains the finalization prerequisite",()=>{
 render(<ReconciliationView period="2026-01" cards={[]} actions={actions}/>);
 expect(screen.getByText(t.empty)).toBeTruthy();expect(screen.queryByRole("button",{name:t.saveInvoice})).toBeNull();
});

test("typed invoice previews exact variance and tolerance before saving",()=>{
 render(<ReconciliationView period="2026-01" cards={[card]} actions={actions}/>);
 fireEvent.change(screen.getByLabelText(t.invoice),{target:{value:"100.00"}});
 expect(screen.getByText(t.outside)).toBeTruthy();
 expect(screen.getByTestId("variance_usd").textContent).toContain("$9,949.00");
 expect(screen.getByTestId("variance_usd").className).toBe("text-error-text");
 fireEvent.change(screen.getByLabelText(t.invoice),{target:{value:"10000.00"}});
 expect(screen.getByText(t.within)).toBeTruthy();expect(screen.getByTestId("variance_usd").className).toBe("text-success");
 // SCR-reconciliation specifies mono financial display, including the variance amount.
 expect(screen.getByText(`${t.variance}: $49.00`).classList.contains("font-mono")).toBe(true);
 fireEvent.change(screen.getByLabelText(t.invoice),{target:{value:""}});
 expect(screen.getByText(t.noInvoice)).toBeTruthy();
 expect(screen.getByTestId("variance_usd").className).toBe("text-text-secondary");
});

test("override submits the mandatory note and locks all controls after approval",async()=>{
 const sent:FormData[]=[];
 render(<ReconciliationView period="2026-01" cards={[{...card,invoiceAmountUsd:"100.00"}]} actions={{...actions,overrideReconciliation:async(_state,form)=>{sent.push(form);return {status:"overridden"};}}}/>);
 fireEvent.click(screen.getByRole("button",{name:t.override}));
 fireEvent.change(screen.getByLabelText(t.note),{target:{value:"Approved timing"}});
 fireEvent.click(screen.getByRole("button",{name:t.confirmOverride}));
 await waitFor(()=>expect(screen.getByRole("status").textContent).toBe(t.overridden));
 expect(sent[0]?.get("note")).toBe("Approved timing");expect(sent[0]?.get("period")).toBe("2026-01");expect(sent[0]?.get("vendorAccountId")).toBe("org-a");
 expect(screen.queryByRole("dialog")).toBeNull();expect(screen.queryByRole("button",{name:t.saveInvoice})).toBeNull();expect(screen.queryByText(t.addLine)).toBeNull();
});
test("creating a variance sends the chosen cause and HTTP evidence; failed saves remain recoverable",async()=>{
 const sent:FormData[]=[];
 render(<ReconciliationView period="2026-01" cards={[card]} actions={{...actions,saveVarianceLine:async(_state,form)=>{sent.push(form);return {status:"error"};}}}/>);
 fireEvent.click(screen.getByText(t.addLine));
 fireEvent.change(screen.getByLabelText(t.cause),{target:{value:"rate_mismatch"}});
 fireEvent.change(screen.getByLabelText(t.detail),{target:{value:"Different rate"}});
 fireEvent.change(screen.getByLabelText(t.registerAmount),{target:{value:"10.25"}});
 fireEvent.change(screen.getByLabelText(t.lineInvoiceAmount),{target:{value:"20.50"}});
 fireEvent.change(screen.getByLabelText(t.evidenceUrl),{target:{value:"https://example.test/rate"}});
 fireEvent.click(screen.getByRole("button",{name:t.saveLine}));
 await waitFor(()=>expect(screen.getByRole("alert").textContent).toBe(t.error));
 expect(sent[0]?.get("cause")).toBe("rate_mismatch");expect(sent[0]?.get("detail")).toBe("Different rate");expect(sent[0]?.get("registerAmountUsd")).toBe("10.25");expect(sent[0]?.get("invoiceAmountUsd")).toBe("20.50");expect(sent[0]?.get("evidenceUrl")).toBe("https://example.test/rate");expect(sent[0]?.get("lineId")).toBeNull();
 expect(screen.getByRole("button",{name:t.saveLine}).hasAttribute("disabled")).toBe(false);
});

// These oracles constrain evidence fidelity and duplicate submissions, not styling.
test("saved override evidence and historical missing amounts remain visible without reopening commands",()=>{
 const historical={id:"legacy",cause:"timing",detail:"Archived",registerAmountUsd:null,invoiceAmountUsd:null,differenceUsd:"0.00",evidenceUrl:null};
 render(<ReconciliationView period="2026-01" cards={[{...card,status:"overridden",invoiceAmountUsd:"100.00",overrideNote:"Approved documented timing",lines:[historical]} as ReconciliationCard]} actions={actions}/>);
 expect(screen.getByText(`${t.overrideRecorded}: Approved documented timing`)).toBeTruthy();
 expect(screen.getByText(`${t.registerAmount}: — · ${t.lineInvoiceAmount}: — · ${t.difference}: $0.00`)).toBeTruthy();
 expect(screen.queryByRole("button",{name:t.override})).toBeNull();
 expect(screen.queryByRole("dialog")).toBeNull();
 expect(screen.queryByText(t.empty)).toBeNull();
});
test("new explanations start with empty monetary and evidence inputs and the other cause",()=>{
 render(<ReconciliationView period="2026-01" cards={[{...card,invoiceAmountUsd:null}]} actions={actions}/>);
 expect((screen.getByLabelText(t.invoice) as HTMLInputElement).value).toBe("");
 expect((screen.getByLabelText(t.cause) as HTMLSelectElement).value).toBe("other");
 for(const label of [t.registerAmount,t.lineInvoiceAmount,t.evidenceUrl])expect((screen.getByLabelText(label) as HTMLInputElement).value).toBe("");
 expect(screen.queryByRole("dialog")).toBeNull();
 expect(screen.queryByRole("status")).toBeNull();
});
test("an unsaved invoice cannot open override, and refreshed persisted invoice resets the card input",()=>{
 const props={period:"2026-01",actions};
 const view=render(<ReconciliationView {...props} cards={[{...card,invoiceAmountUsd:"100.00"}]}/>);
 fireEvent.change(screen.getByLabelText(t.invoice),{target:{value:"200.00"}});
 expect(screen.queryByRole("button",{name:t.override})).toBeNull();
 view.rerender(<ReconciliationView {...props} cards={[{...card,invoiceAmountUsd:"300.00"}]}/>);
 expect((screen.getByLabelText(t.invoice) as HTMLInputElement).value).toBe("300.00");
});
test("saving or deleting an explanation disables both competing commands until completion",async()=>{
 let finish!:(state:{status:"saved"})=>void;
 const pending=()=>{return new Promise<{status:"saved"}>(resolve=>{finish=resolve;});};
 const line={id:"line-pending",cause:"timing",detail:"Pending evidence",registerAmountUsd:"1.00",invoiceAmountUsd:"2.00",differenceUsd:"-1.00",evidenceUrl:null};
 render(<ReconciliationView period="2026-01" cards={[{...card,lines:[line]} as ReconciliationCard]} actions={{...actions,saveVarianceLine:pending,deleteVarianceLine:pending}}/>);
 fireEvent.click(screen.getAllByRole("button",{name:t.saveLine})[0]!);
 await waitFor(()=>expect((screen.getAllByLabelText(t.detail)[0] as HTMLTextAreaElement).disabled || screen.getAllByLabelText(t.detail)[0]!.closest("fieldset")?.disabled).toBe(true));
 expect((screen.getByRole("button",{name:t.deleteLine}) as HTMLButtonElement).disabled).toBe(true);
 await act(async()=>finish({status:"saved"}));
 fireEvent.click(screen.getByRole("button",{name:t.deleteLine}));
 await waitFor(()=>expect(screen.getAllByLabelText(t.detail)[0]!.closest("fieldset")?.disabled).toBe(true));
 expect((screen.getAllByRole("button",{name:t.pending})[0] as HTMLButtonElement).disabled).toBe(true);
 await act(async()=>finish({status:"saved"}));
 expect(screen.queryByDisplayValue("Pending evidence")).toBeNull();
});

test("pending invoice saves cannot be submitted twice and automatic reconciliation removes editing",async()=>{
 let finish!:(state:{status:"reconciled"})=>void;
 render(<ReconciliationView period="2026-01" cards={[card]} actions={{...actions,saveInvoiceAmount:()=>{return new Promise(resolve=>{finish=resolve;});}}}/>);
 fireEvent.click(screen.getByRole("button",{name:t.saveInvoice}));
 await waitFor(()=>expect((screen.getByLabelText(t.invoice) as HTMLInputElement).disabled).toBe(true));
 expect((screen.getByRole("button",{name:t.pending}) as HTMLButtonElement).disabled).toBe(true);
 await act(async()=>finish({status:"reconciled"}));
 expect(screen.queryByRole("button",{name:t.saveInvoice})).toBeNull();
 expect((screen.getByLabelText(t.invoice) as HTMLInputElement).readOnly).toBe(true);
 expect(screen.queryByText(t.addLine)).toBeNull();
});

test("a rejected override keeps its dialog open with one recoverable error",async()=>{
 render(<ReconciliationView period="2026-01" cards={[{...card,invoiceAmountUsd:"100.00"}]} actions={{...actions,overrideReconciliation:async()=>({status:"error"})}}/>);
 fireEvent.click(screen.getByRole("button",{name:t.override}));
 fireEvent.change(screen.getByLabelText(t.note),{target:{value:"Check failure"}});
 fireEvent.click(screen.getByRole("button",{name:t.confirmOverride}));
 await waitFor(()=>expect(screen.getAllByRole("alert")).toHaveLength(1));
 expect(screen.getByRole("dialog")).toBeTruthy();
 expect((screen.getByRole("button",{name:t.confirmOverride}) as HTMLButtonElement).disabled).toBe(false);
});
