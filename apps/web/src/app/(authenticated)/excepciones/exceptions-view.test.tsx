// @vitest-environment jsdom
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
    expect(link.textContent).toContain(emptyProps.counts[tab]);
  }
  const expected = selected==='blocked' ? en.exceptions.blocked.empty
    : selected==='failed' ? en.orchestration.exceptionsEmpty
    : selected==='drift' ? en.exceptions.future.drift : en.exceptions.overdueInvites.empty;
  expect(screen.getByText(expected)).toBeTruthy();
  expect(screen.queryByTestId('exceptions_load_more')).toBeNull();
});
