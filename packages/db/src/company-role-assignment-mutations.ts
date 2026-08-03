import type pg from "pg";

export interface DeleteCompanyRoleAssignmentInput {
  actorUserId: string;
  assignmentId: string;
  companyId: string;
  note: string;
}

export interface DeletedCompanyRoleAssignment {
  company_id: string;
  id: string;
  role: string;
  unique_grant: string;
  user_account_id: string;
}

type QueryClient = Pick<pg.Client, "query">;

/**
 * The sole authorized hard-delete path for company-role grants. PostgreSQL
 * owns the atomic action so this helper is safe inside a caller's transaction.
 */
export async function deleteCompanyRoleAssignmentWithAudit(
  client: QueryClient,
  { actorUserId, assignmentId, companyId, note }: DeleteCompanyRoleAssignmentInput,
): Promise<DeletedCompanyRoleAssignment | null> {
  const revoked = await client.query<DeletedCompanyRoleAssignment>(
    `SELECT id, user_account_id, company_id, role, unique_grant
     FROM public.revoke_company_role_assignment($1, $2, $3, $4)`,
    [assignmentId, companyId, actorUserId, note],
  );
  return revoked.rows[0] ?? null;
}
