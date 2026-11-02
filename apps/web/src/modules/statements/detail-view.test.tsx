// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/en-US.json";
import spanish from "../../../messages/es-EC.json";
import { StatementDetailView } from "./detail-view";
import type { StatementDetail } from "./repository";
import Loading from "../../app/(authenticated)/estados-de-cuenta/[statementId]/loading";
import ErrorState from "../../app/(authenticated)/estados-de-cuenta/[statementId]/error";

const assignment = {
 id:"assignment-a", companyId:"company-a",companyCode:"ALP",companyName:"Alpha",personId:"person-a",personName:"Alice",
 vendorAccountId:"org-a",vendorAccountName:"Enterprise Org",licenseTypeId:"type-a",licenseTypeName:"Enterprise",
 startedOn:"2026-07-10",endedOn:"2026-07-20",endReason:"inactive" as const,note:"Original register note",sourceKind:"manual" as const,
 sourceRequestApprovalState:null,sourceRequestDecidedAt:null,sourceRequestId:null,sourceRequestNo:null,statementLines:[],
};
const line = {
 id:"line-a",statementId:"statement-a",kind:"license" as const,personId:"person-a",personName:"Alice",vendorAccountId:"org-a",vendorAccountName:"Enterprise Org",
 licenseTypeId:"type-a",licenseTypeName:"Enterprise",assignmentId:"assignment-a",licenseDays:11,rateUsd:"60.00",amountUsd:"21.29",periodFrom:"2026-07-10",periodTo:"2026-07-20",note:"Prorated",assignment,
};
const detail: StatementDetail = {
 companyName:"Alpha",companyCode:"ALP",
 statement:{id:"statement-a",companyId:"company-a",period:"2026-07",status:"draft",openingSeats:0,totalUsd:"17.29",generatedAt:new Date("2026-08-01T00:00:00Z"),createdAt:new Date("2026-08-01T00:00:00Z"),closeRunId:null},
 lines:[line,{...line,id:"adjustment-a",kind:"adjustment",assignment:null,assignmentId:null,personId:null,personName:null,licenseDays:null,licenseTypeId:null,licenseTypeName:null,rateUsd:null,amountUsd:"-4.00",note:"Correction required note"}],
};
const show = (data = detail, canViewRegister = false) => render(<StatementDetailView detail={data} canViewRegister={canViewRegister} locale="en-US" copy={messages.statementDetail} registerLabels={messages.register} />);
afterEach(cleanup);

test("renders license fields, negative USD adjustment and expands US-033 evidence", () => {
 show();
 expect(screen.getByTestId("btn_export_csv").getAttribute("href")).toBe("/api/v1/statements/statement-a/export/csv");
 expect(screen.getByTestId("btn_export_pdf").getAttribute("href")).toBe("/api/v1/statements/statement-a/export/pdf");
 expect(screen.getByTestId("btn_export_pdf").textContent).toBe("Download PDF");
 expect(screen.getByRole("heading",{level:1}).textContent).toContain("Alpha");
 expect(screen.getByRole("heading",{level:1}).textContent).toContain("2026-07");
 const table = screen.getByRole("table");
 expect(within(table).getAllByRole("columnheader").map(cell=>cell.textContent)).toEqual([messages.statementDetail.kind,messages.statementDetail.person,messages.statementDetail.organization,messages.statementDetail.licenseType,messages.statementDetail.periodFrom,messages.statementDetail.periodTo,messages.statementDetail.seatDays,messages.statementDetail.rate,messages.statementDetail.amount,messages.statementDetail.note]);
 expect(Array.from(table.querySelector('[data-line-id="line-a"]')!.querySelectorAll("td")).map(cell=>cell.textContent)).toEqual(["License","Alice","Enterprise Org","Enterprise","7/10/2026","7/20/2026","11","$60.00","$21.29","Prorated"]);
 expect(Array.from(table.querySelector('[data-line-id="adjustment-a"]')!.querySelectorAll("td")).map(cell=>cell.textContent)).toEqual(["Adjustment","—","Enterprise Org","—","7/10/2026","7/20/2026","—","—","-$4.00","Correction required note"]);
 for (const value of ["Alice","Enterprise Org","Enterprise","11","$60.00","$21.29","-$4.00","Prorated","Correction required note","7/10/2026","7/20/2026"]) expect(table.textContent).toContain(value);
 expect(screen.getByTestId("status_banner").textContent).toContain(messages.statementDetail.draft);
 expect(screen.getByTestId("tile_total").textContent).toContain("$17.29");
 expect(screen.getByTestId("statement_tiles").textContent).toContain(messages.statementDetail.openingSeats);
 expect(screen.getByTestId("statement_tiles").textContent).toContain("8/1/2026");
 expect(screen.getByTestId("statement_tiles").querySelector("time")?.getAttribute("dateTime")).toBe("2026-08-01T00:00:00.000Z");
 const expanders = screen.getAllByText(messages.statementDetail.evidence).filter(element => element.tagName === "SUMMARY");
 fireEvent.click(expanders[0]);
 expect(expanders[0].closest("details")?.open).toBe(true);
 const evidence = screen.getByTestId("register_drilldown");
 expect(evidence.querySelector("section")?.getAttribute("aria-labelledby")).toBe("statement-line-line-a");
 expect(evidence.querySelector("h2")?.id).toBe("statement-line-line-a");
 expect(evidence.querySelector('[data-organism="register-drilldown"]')).not.toBeNull();
 expect(within(evidence).getByText("Note: Original register note").tagName).toBe("P");
 expect(evidence.textContent).toContain("assignment-a");
 expect(evidence.textContent).toContain("7/10/2026");
 expect(evidence.textContent).toContain("7/20/2026");
 expect(evidence.textContent).toContain(messages.register.sourceManual);
 fireEvent.click(expanders[1]);
 expect(expanders[1].closest("details")?.textContent).toContain("Correction required note");
 expect(screen.queryByTestId("btn_view_register")).toBeNull();
});

test("central roles get a filtered register link and missing evidence or adjustment notes are explicit", () => {
 show({...detail, statement:{...detail.statement,status:"reconciled"}, lines:[line,{...detail.lines[1],note:" "},{...line,id:"missing",assignment:null,rateUsd:null,periodFrom:null,periodTo:null,note:null,licenseDays:0}]},true);
 const link = screen.getByTestId("btn_view_register");
 const url = new URL(link.getAttribute("href")!,"https://ledger.test");
 expect(url.pathname).toBe("/registro");
 expect(Object.fromEntries(url.searchParams)).toEqual({companyId:"company-a",personId:"person-a",vendorAccountId:"org-a",licenseTypeId:"type-a",startDate:"2026-07-10",endDate:"2026-07-10"});
 expect(screen.getByTestId("status_banner").textContent).toContain(messages.statementDetail.reconciled);
 expect(screen.getAllByText(messages.statementDetail.missingNote).length).toBe(2);
 expect(screen.getByText(messages.statementDetail.missingEvidence)).toBeTruthy();
 expect(screen.getByRole("table").textContent).toContain("0");
 const missingCells=screen.getByRole("table").querySelector('[data-line-id="missing"]')!.querySelectorAll("td");
 expect([missingCells[4].textContent,missingCells[5].textContent,missingCells[6].textContent,missingCells[7].textContent,missingCells[9].textContent]).toEqual(["—","—","0","—","—"]);
 cleanup();
 show({...detail,lines:[{...detail.lines[1],note:null}]});
 expect(screen.getAllByText(messages.statementDetail.missingNote)).toHaveLength(2);
});

test("empty final statements show no draft banner; boundary recovery and localization work", () => {
 const view=show({...detail,statement:{...detail.statement,status:"final"},lines:[]});
 expect(screen.queryByTestId("status_banner")).toBeNull();
 expect(screen.getByText(messages.statementDetail.empty)).toBeTruthy();
 expect(screen.getByRole("link",{name:messages.statementDetail.back}).getAttribute("href")).toBe("/estados-de-cuenta");
 view.unmount();
 render(<NextIntlClientProvider locale="es-EC" messages={spanish}><Loading /></NextIntlClientProvider>);
 expect(screen.getByRole("status").textContent).toBe(spanish.statementDetail.loading);
 cleanup();
 let resets=0;
 render(<NextIntlClientProvider locale="en-US" messages={messages}><ErrorState reset={()=>{resets++;}} /></NextIntlClientProvider>);
 expect(screen.getByRole("alert").textContent).toBe(messages.statementDetail.loadError);
 fireEvent.click(screen.getByRole("button",{name:messages.statementDetail.retry}));
 expect(resets).toBe(1);
 cleanup();
 render(<StatementDetailView detail={detail} canViewRegister={false} locale="es-EC" copy={spanish.statementDetail} registerLabels={spanish.register} />);
 expect(within(screen.getByRole("table")).getByText(spanish.statementDetail.license)).toBeTruthy();
});
