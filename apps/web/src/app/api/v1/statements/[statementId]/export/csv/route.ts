import { auth } from "@/lib/auth/auth-config";
import { loadLedgerAuthorizationForSubject } from "@/modules/identity-access/server-authorization";
import { createStatementExportResponse, createStatementExportService } from "@/modules/statements/export-transaction";
// eslint-disable-next-line no-restricted-imports -- Production composition of the audited export service.
import { db } from "@smp/db";

const service = createStatementExportService(db as unknown as Parameters<typeof createStatementExportService>[0]);

export async function GET(_request: Request, context: { params: Promise<{ statementId: string }> }) {
  const session = await auth();
  const authorization = await loadLedgerAuthorizationForSubject(session?.user?.idpSubject ?? null);
  return createStatementExportResponse(service, authorization, (await context.params).statementId);
}
