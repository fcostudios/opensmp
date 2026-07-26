export interface AuditRecordInput {
  readonly actorUserId: string | null;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly companyId: string | null;
  readonly note: string | null;
  readonly before: unknown;
  readonly after: unknown;
}

export interface AuditedMutationResult<T> {
  readonly value: T;
  readonly audit: AuditRecordInput;
}

