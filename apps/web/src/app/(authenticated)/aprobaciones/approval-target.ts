import { z } from "zod";

const approvalTargetSchema = z.string().uuid();

export function resolveApprovalTarget(
  value: unknown,
  authorizedItems: readonly { readonly requestId: string }[],
): string | null {
  const target = approvalTargetSchema.safeParse(value);
  return target.success &&
    authorizedItems.some(({ requestId }) => requestId === target.data)
    ? target.data
    : null;
}

export async function resolveApprovalPageTarget(
  searchParams: Promise<{
    readonly requestId?: string | readonly string[];
  }>,
  authorizedItems: readonly { readonly requestId: string }[],
): Promise<string | null> {
  const query = await searchParams;
  return resolveApprovalTarget(query.requestId, authorizedItems);
}
