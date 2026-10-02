// @vitest-environment jsdom
import type { ReactElement } from "react";
import { Children, isValidElement } from "react";
import { OverdueInvitesTable } from "../../../components/exceptions/overdue-invites-table";
import { withdrawInvite } from "../../../modules/request-workflow/actions/withdraw-invite";
import es from "../../../../messages/es-EC.json";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { createTranslator, type AbstractIntlMessages } from "next-intl";
import en from "../../../../messages/en-US.json";
import { ExceptionsView } from "./exceptions-view";
afterEach(cleanup);

test("renders the overdue tab count, invitation request and continuation together",()=>{
  render(<ExceptionsView selected="expiredInvites" blocked={{items:[],nextCursor:null}}
    failures={{items:[],nextCursor:null}} invitations={{items:[{
      requestId:"67000000-0000-4000-8000-000000000001",requestNo:"REQ-067-PAGE",ageHours:169,
      actionId:"67000000-0000-4000-8000-000000000002",companyId:"67000000-0000-4000-8000-000000000003",
      vendorAccountId:"67000000-0000-4000-8000-000000000004",vendorRef:"invite-page",invitedAt:"2026-09-25T14:07:00Z",
    }],nextCursor:"2026-09-25T14:07:00.000Z|67000000-0000-4000-8000-000000000002"}}
    retryErrorKey={null} counts={{blocked:"0",failed:"0",drift:"0",expiredInvites:"51"}}
    locale="en-US" title="Exceptions" t={createTranslator({locale:"en-US",messages:en as AbstractIntlMessages,namespace:"exceptions"})}
    orchestration={createTranslator({locale:"en-US",messages:en as AbstractIntlMessages,namespace:"orchestration"})} />);
  expect(screen.getByTestId("tab_expired_invites").textContent).toContain("51");
  expect(screen.getByRole("link",{name:"REQ-067-PAGE"}).getAttribute("href")).toBe("/solicitudes/67000000-0000-4000-8000-000000000001");
  expect(screen.getByText("169")).toBeTruthy();
  expect(screen.getByRole('columnheader',{name:en.exceptions.overdueInvites.request})).toBeTruthy();
  expect(screen.getByRole('columnheader',{name:en.exceptions.overdueInvites.ageHours})).toBeTruthy();
  expect(screen.getByTestId("exceptions_load_more").getAttribute("href")).toBe("?tab=expiredInvites&cursor=2026-09-25T14%3A07%3A00.000Z%7C67000000-0000-4000-8000-000000000002");
  expect(screen.queryByTestId("table_blocked")).toBeNull();
  expect(screen.queryByTestId("table_failed")).toBeNull();
});


const emptyProps = {
  blocked: {items:[],nextCursor:null},
  failures: {items:[],nextCursor:null},
  invitations: {items:[],nextCursor:null},
  retryErrorKey: null,
  counts: {blocked:"7",failed:"3",drift:"0",expiredInvites:"2"},
  locale: "en-US",
  title: "Exceptions",
  t: createTranslator({locale:"en-US",messages:en as AbstractIntlMessages,namespace:"exceptions"}),
  orchestration: createTranslator({locale:"en-US",messages:en as AbstractIntlMessages,namespace:"orchestration"}),
};

test.each(['blocked','failed','drift','expiredInvites'] as const)("preserves %s tab selection and its localized empty state",selected=>{
  render(<ExceptionsView {...emptyProps} selected={selected} />);
  expect(screen.getByRole('heading',{name:'Exceptions'})).toBeTruthy();
  const navigation=screen.getByRole('navigation',{name:en.exceptions.tabsLabel});
  expect(navigation.querySelectorAll('a')).toHaveLength(4);
  for (const tab of ['blocked','failed','drift','expiredInvites'] as const) {
    const link=screen.getByTestId(tab==='expiredInvites'?'tab_expired_invites':`tab_${tab}`);
    expect(link.getAttribute('href')).toBe(`?tab=${tab}`);
    expect(link.getAttribute('aria-current')).toBe(tab===selected?'page':null);
    expect(link.textContent).toContain(en.exceptions.tabs[tab]);
    expect(link.textContent).toBe(`${en.exceptions.tabs[tab]} ${emptyProps.counts[tab]}`);
  }
  const expected = selected==='blocked' ? en.exceptions.blocked.empty
    : selected==='failed' ? en.orchestration.exceptionsEmpty
    : selected==='drift' ? en.exceptions.future.drift : en.exceptions.overdueInvites.empty;
  expect(screen.getByText(expected)).toBeTruthy();
  expect(screen.queryByTestId('exceptions_load_more')).toBeNull();
});


test("keeps failed invitation evidence, translated headers, retry controls and feedback connected", () => {
  const failures = {items:[{
    actionId:"67000000-0000-4000-8000-000000000010",companyName:"Acme",failureReason:"provider_failure",
    kind:"invite" as const,mode:"automated" as const,personEmail:"invite@example.test",
    requestId:"67000000-0000-4000-8000-000000000011",requestNo:"REQ-FAILED",sentAt:null,
    status:"failed" as const,vendorAccountName:"Vendor account",vendorRef:null,
  },{
    actionId:"67000000-0000-4000-8000-000000000020",companyName:"Acme",failureReason:"checklist_assignment_missing|missing assignment",
    kind:"checklist" as const,mode:"orchestration" as const,personEmail:"checklist@example.test",
    requestId:"67000000-0000-4000-8000-000000000021",requestNo:"REQ-CHECKLIST",sentAt:null,
    status:"verification_failed" as const,vendorAccountName:"Vendor account",vendorRef:"checklist-ref",
  }],nextCursor:"failed-next"};
  render(<ExceptionsView {...emptyProps} selected="failed" failures={failures} retryErrorKey="retryInvalid" />);
  expect(screen.getByRole('alert').textContent).toBe(en.orchestration.retryInvalid);
  expect(screen.getByText(en.exceptions.eyebrow)).toBeTruthy();
  expect(screen.getByText(en.exceptions.subtitle)).toBeTruthy();
  expect(screen.getByRole('region',{name:en.exceptions.title})).toBeTruthy();
  for (const label of [en.orchestration.exceptionRequest,en.orchestration.exceptionOrganization,en.orchestration.exceptionMode,
    en.orchestration.exceptionReason,en.orchestration.exceptionSentAt,en.orchestration.exceptionStatus,en.orchestration.exceptionVendorReference,
    en.orchestration.exceptionAction]) expect(screen.getByRole('columnheader',{name:label})).toBeTruthy();
  expect(screen.getByText(en.orchestration.exceptionInvite)).toBeTruthy();
  expect(screen.getByText(en.orchestration.exceptionAutomated)).toBeTruthy();
  expect(screen.getByText(en.orchestration.exceptionChecklist)).toBeTruthy();
  expect(screen.getByText(en.orchestration.exceptionOrchestration)).toBeTruthy();
  expect(screen.getByText(en.orchestration.exceptionFailed)).toBeTruthy();
  expect(screen.getByText(en.orchestration.exceptionVerificationFailed)).toBeTruthy();
  expect(screen.getByText(en.orchestration.exceptionAssignmentMissing)).toBeTruthy();
  expect(screen.getAllByText(en.orchestration.exceptionNoData).length).toBeGreaterThan(0);
  expect(screen.getByText(en.orchestration.retryUnavailable)).toBeTruthy();
  expect(screen.getByRole('button',{name:en.orchestration.retryProvisioning})).toHaveProperty('disabled',false);
  expect(screen.getByTestId('exceptions_load_more').getAttribute('href')).toBe('?tab=failed&cursor=failed-next');
  expect(screen.getByTestId('exceptions_load_more').textContent).toBe(en.exceptions.loadMore);
  expect(screen.queryByTestId('table_drift')).toBeNull();
  expect(screen.queryByTestId('table_expired_invites')).toBeNull();
});

test("keeps the blocked continuation tied to its own cursor",()=>{
  render(<ExceptionsView {...emptyProps} selected="blocked" blocked={{items:[],nextCursor:"blocked-next"}} />);
  expect(screen.getByTestId('exceptions_load_more').getAttribute('href')).toBe('?tab=blocked&cursor=blocked-next');
  expect(screen.queryByTestId('table_drift')).toBeNull();
  expect(screen.queryByTestId('table_expired_invites')).toBeNull();
});


test.each([["en-US",en],["es-EC",es]] as const)("withdrawal form wiring preserves every %s catalog label and real server action",(locale,messages)=>{
 const props={...emptyProps,selected:"expiredInvites" as const,locale,t:createTranslator({locale,messages:messages as AbstractIntlMessages,namespace:"exceptions"}),orchestration:createTranslator({locale,messages:messages as AbstractIntlMessages,namespace:"orchestration"}),invitations:{items:[{requestId:"68000000-0000-4000-8000-000000000001",requestNo:"REQ-068",ageHours:200,actionId:"68000000-0000-4000-8000-000000000002",companyId:"68000000-0000-4000-8000-000000000003",vendorAccountId:"68000000-0000-4000-8000-000000000004",vendorRef:"invite-pinned",invitedAt:"2026-09-25T14:07:00Z"}],nextCursor:null}};
 const tree=ExceptionsView(props);let selected:ReactElement<Parameters<typeof OverdueInvitesTable>[0]>|undefined;
 function visit(node:unknown){if(!isValidElement(node))return;if(node.type===OverdueInvitesTable)selected=node as typeof selected;Children.forEach((node.props as {children?:React.ReactNode}).children,visit);}visit(tree);
 expect(selected!.props.withdrawAction).toBe(withdrawInvite);
 const catalog=messages.exceptions.overdueInvites;
 expect(selected!.props.labels).toEqual({request:catalog.request,ageHours:catalog.ageHours,empty:catalog.empty,withdraw:catalog.withdraw,pending:catalog.pending,note:catalog.note,success:catalog.success,errors:catalog.errors});
 render(tree);expect(screen.getByLabelText(catalog.note)).toHaveProperty("required",true);expect(screen.getByRole("button",{name:catalog.withdraw})).toHaveProperty("disabled",false);
});
