import { expect, test } from "vitest";
import { navItems } from "./nav-items.gen";

test.each(["company_finance", "approver", "viewer"] as const)("US-041 %s reaches statements without administration or global register", role => {
 const visible = navItems.filter(item => item.roles?.includes(role));
 expect(visible.filter(item => item.section === "finance").map(item=>[item.screenId,item.href])).toEqual([["SCR-statements","/estados-de-cuenta"]]);
 expect(visible.filter(item => item.section === "administration")).toEqual([]);
 expect(visible.some(item => item.screenId === "SCR-register")).toBe(false);
});
