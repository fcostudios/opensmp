import { parseRegisterFilters } from "@smp/contracts/register";
import { hasCapability } from "@smp/domain/identity-access";

import type { LedgerAuthorization } from "../identity-access/authorization";
import type { RegisterRepository } from "./repository";

export const MAX_REGISTER_EXPORT_QUERY_LENGTH = 4096;

function jsonError(error: string, status: number): Response {
  return new Response(JSON.stringify({ error }), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

function queryInput(searchParams: URLSearchParams): Record<string, string> {
  const input: Record<string, string> = {};
  for (const [key, value] of searchParams) {
    if (key in input) throw new Error();
    input[key] = value;
  }
  return input;
}

/** Secure, testable route boundary: parses untrusted query input before the scoped read. */
export async function createRegisterExportResponse({
  loadAuthorization,
  query,
  queryLength,
  repository,
  subject,
}: {
  readonly loadAuthorization: (subject: string) => Promise<LedgerAuthorization | null>;
  readonly query: URLSearchParams;
  readonly queryLength: number;
  readonly repository: RegisterRepository;
  readonly subject: string | null;
}): Promise<Response> {
  if (!subject) return jsonError("Unauthorized", 401);
  if (queryLength > MAX_REGISTER_EXPORT_QUERY_LENGTH) {
    return jsonError("Invalid register filters", 400);
  }
  let filters;
  try {
    filters = parseRegisterFilters(queryInput(query));
  } catch {
    return jsonError("Invalid register filters", 400);
  }
  const authorization = await loadAuthorization(subject);
  if (!authorization || !hasCapability(authorization, "finance:read") || (authorization.globalRole !== "group_admin" && authorization.globalRole !== "central_finance")) {
    return jsonError("Forbidden", 403);
  }
  const iterator = repository.streamCsv(authorization, filters);
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await iterator.next();
        if (next.done) controller.close();
        else controller.enqueue(encoder.encode(next.value));
      } catch (error) {
        controller.error(error);
        await iterator.return(undefined);
      }
    },
    // Stryker disable next-line BlockStatement: @equivalent the current keyset generator holds no DB cursor and its finally block has no observable cleanup.
    async cancel() {
      await iterator.return(undefined);
    },
  });
  return new Response(stream, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": 'attachment; filename="register.csv"',
      "Content-Type": "text/csv; charset=utf-8",
    },
  });
}
