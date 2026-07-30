import { NextRequest } from "next/server";

import { auth } from "@/lib/auth/auth-config";
import { loadLedgerAuthorizationForSubject } from "@/modules/identity-access/server-authorization";
import { createRegisterExportResponse } from "@/modules/register/export-boundary";
import { registerRepository } from "@/modules/register/repository";

export async function GET(request: NextRequest) {
  const session = await auth();
  return createRegisterExportResponse({
    loadAuthorization: loadLedgerAuthorizationForSubject,
    query: request.nextUrl.searchParams,
    queryLength: request.nextUrl.search.length,
    repository: registerRepository,
    subject: session?.user?.idpSubject ?? null,
  });
}
