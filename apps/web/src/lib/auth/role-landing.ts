import {
  ROUTE_SCR_ADMIN_DASHBOARD,
  ROUTE_SCR_APPROVAL_QUEUE,
  ROUTE_SCR_CLOSE,
  ROUTE_SCR_MY_REQUESTS,
  ROUTE_SCR_STATEMENTS,
} from "../routes";
import type { LedgerSessionUser } from "./auth-types";

export function roleLanding(user: LedgerSessionUser): string {
  if (user.globalRole === "group_admin") {
    return ROUTE_SCR_ADMIN_DASHBOARD;
  }
  if (user.globalRole === "central_finance") {
    return ROUTE_SCR_CLOSE;
  }
  if (user.companyGrants.some(({ role }) => role === "approver")) {
    return ROUTE_SCR_APPROVAL_QUEUE;
  }
  // Remaining company grants are finance/viewer; both land on scoped statements.
  if (user.companyGrants.length > 0) {
    return ROUTE_SCR_STATEMENTS;
  }
  return ROUTE_SCR_MY_REQUESTS;
}
