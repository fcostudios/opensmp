import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { RegisterDrilldown } from "./register-drilldown";

const assignment = {companyName:"Alpha",personName:"Alice",vendorAccountName:"Org",licenseTypeName:"Seat",startedOn:"2026-07-10",endedOn:null,sourceRequestApprovalState:null,sourceRequestDecidedAt:null,sourceRequestNo:null,statementLines:[]};
const labels = {company:"Company",person:"Person",organization:"Organization",licenseType:"License",startedOn:"Start",endedOn:"End",drilldownTitle:"Evidence",drilldownSource:"Source",drilldownDecisionDate:"Decision",drilldownStatementLines:"Statement lines",requestApproved:"Approved",requestPending:"Pending",requestRejected:"Rejected"};
test("shared drilldown keeps its default heading and supports unique expander references",()=>{
 const original = renderToStaticMarkup(<RegisterDrilldown assignment={assignment} labels={labels} locale="en-US" />);
 expect(original).toContain('aria-labelledby="register-drilldown-title"');
 expect(original).toContain('id="register-drilldown-title"');
 const embedded = renderToStaticMarkup(<RegisterDrilldown assignment={assignment} labels={labels} locale="en-US" titleId="statement-line-123" />);
 expect(embedded).toContain('aria-labelledby="statement-line-123"');
 expect(embedded).toContain('id="statement-line-123"');
 expect(embedded).not.toContain('id="register-drilldown-title"');
});
