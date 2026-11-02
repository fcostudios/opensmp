// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import messages from "../../../messages/en-US.json";
import spanish from "../../../messages/es-EC.json";
import { StatementsView, StatementSummary } from "./statement-view";
import type { StatementRegister } from "./repository";
import { NextIntlClientProvider } from "next-intl";
import ErrorState from "@/app/(authenticated)/estados-de-cuenta/error";
afterEach(cleanup);
const data: StatementRegister = {period:"2026-01",companies:[{id:"company-a",code:"P1",name:"Pilot A"}],latest:{id:"run-1",status:"succeeded",period:"2026-01",finishedAt:null,note:null,startedAt:new Date("2026-02-01T12:00:00Z")},totals:{generated:1,draft:1,final:0,reconciled:0,totalUsd:"62.00"},rows:[{id:"statement-a",companyId:"company-a",companyCode:"P1",companyName:"Pilot A",period:"2026-01",status:"draft",openingSeats:1,seatDays:31,rates:["62.00","63.00"],totalUsd:"62.00",generatedAt:new Date("2026-02-01T12:00:00Z"),createdAt:new Date("2026-02-01T12:00:00Z"),closeRunId:"run-1",joiners:[{assignmentId:"a",personId:"person-a",date:"2026-01-10"}],leavers:[{assignmentId:"b",personId:"person-b",date:"2026-01-31"}]}]};

test("statement rows show stamped financial evidence, status and future detail/CSV destinations; only global roles get company filters",()=>{
 render(<StatementsView data={data} filters={{period:"2026-01",companyId:"company-a",status:"draft"}} canFilterCompany t={messages.statements}/>);
 const row=within(screen.getByTestId("statement-statement-a"));
 for(const value of ["P1","Pilot A","2026-01",messages.statements.draft,"31","62.00","63.00","person-a","2026-01-10","person-b","2026-01-31","run-1","2026-02-01T12:00:00.000Z"])expect(row.getAllByText(value,{exact:false})).toBeTruthy();
 expect(row.queryByText(messages.statements.none)).toBeNull();
 expect(row.getByText("62.00 · 63.00")).toBeTruthy();
 expect(row.getByText("person-a").parentElement?.textContent).toContain("person-a · 2026-01-10");
 expect(screen.getAllByRole("columnheader").map(cell=>cell.textContent)).toEqual([messages.statements.company,messages.statements.period,messages.statements.status,messages.statements.openingSeats,messages.statements.joiners,messages.statements.leavers,messages.statements.seatDays,messages.statements.rate,messages.statements.total,messages.statements.generatedAt,messages.statements.statementId,messages.statements.closeRun]);
 expect(screen.getByRole("option",{name:"P1 · Pilot A"})).toBeTruthy();
 expect(screen.getByRole("status").textContent).toBe(`${messages.statements.succeeded} · 2026-01 · run-1 · 2026-02-01T12:00:00.000Z`);
 expect(row.getByRole("link",{name:"statement-a"}).getAttribute("href")).toBe("/estados-de-cuenta/statement-a");
 expect(row.getByRole("link",{name:messages.statements.csv}).getAttribute("href")).toBe("/api/v1/statements/statement-a/export/csv");
 expect(row.getByRole("link",{name:"Download PDF"}).getAttribute("href")).toBe("/api/v1/statements/statement-a/export/pdf");
 expect(row.getByRole("link",{name:messages.statements.csv}).parentElement?.textContent).toContain(`${messages.statements.csv} · ${messages.statements.pdf}`);
 expect((screen.getByTestId("filter_company") as HTMLSelectElement).value).toBe("company-a");
 expect((screen.getByTestId("filter_status") as HTMLSelectElement).value).toBe("draft");
 cleanup();render(<StatementsView data={data} filters={{period:"2026-01"}} canFilterCompany={false} t={messages.statements}/>);
 expect(screen.queryByTestId("filter_company")).toBeNull();
});

test("period/run failures and empty states remain explicit, with genuine final and reconciled labels",()=>{
 render(<StatementsView data={{...data,rows:[],latest:{...data.latest!,status:"failed"}}} filters={{period:"2026-01"}} canFilterCompany t={messages.statements}/>);
 expect(screen.getByRole("alert").textContent).toContain(messages.statements.failed);
 expect(screen.getByRole("alert").textContent).toContain("run-1");expect(screen.getByRole("alert").textContent).toContain("2026-01");
 expect(screen.getByTestId("statements_empty").textContent).toBe(`${messages.statements.empty} · 2026-01`);
 cleanup();render(<StatementsView data={{...data,rows:[],latest:null}} filters={{period:"2026-01"}} canFilterCompany={false} t={spanish.statements}/>);
 expect(screen.getByTestId("statements_latest_run").textContent).toContain(spanish.statements.noRun);
 cleanup();render(<StatementsView data={{...data,rows:[{...data.rows[0]!,status:"final",rates:[],joiners:[],leavers:[],closeRunId:null},{...data.rows[0]!,id:"reconciled",status:"reconciled"}]}} filters={{period:"2026-01"}} canFilterCompany t={messages.statements}/>);
 expect(within(screen.getByTestId("statement-statement-a")).getByText(messages.statements.final)).toBeTruthy();
 expect(within(screen.getByTestId("statement-statement-a")).getAllByText(messages.statements.none)).toHaveLength(4);
 expect(within(screen.getByTestId("statement-reconciled")).getByText(messages.statements.reconciled)).toBeTruthy();
});

test("close tiles expose counts and sum, link to the same period and route boundaries recover",()=>{
 render(<StatementSummary data={data} t={messages.statements}/>);
 expect(screen.getByTestId("tile_statements_generated").textContent).toContain("1");
 expect(screen.getByTestId("tile_drafts").textContent).toContain("1");expect(screen.getByTestId("tile_finals").textContent).toContain("0");
 expect(screen.getByTestId("tile_group_total").textContent).toContain("62.00");
 expect(screen.getByRole("link").getAttribute("href")).toBe("/estados-de-cuenta?period=2026-01");
 
 cleanup();let retries=0;render(<NextIntlClientProvider locale="en-US" messages={messages}><ErrorState reset={()=>{retries++;}}/></NextIntlClientProvider>);expect(screen.getByRole("alert").textContent).toBe(messages.statements.loadError);
 fireEvent.click(screen.getByRole("button",{name:messages.statements.retry}));expect(retries).toBe(1);
});
