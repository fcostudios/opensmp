import type pg from "pg";

export interface SeatPoolCountsSnapshot {
  readonly assigned: number;
  readonly contractRenewalOn: string | null;
  readonly effectiveFrom: string;
  readonly licenseTypeId: string;
  readonly licenseTypeName: string;
  readonly lowPoolFloor: number;
  readonly mode: "automated" | "orchestration";
  readonly pendingInvites: number;
  readonly purchased: number;
  readonly vendorAccountId: string;
  readonly vendorAccountName: string;
}

type Queryable = Pick<pg.Pool, "query">;

interface SeatPoolRow {
  assigned: number;
  contract_renewal_on: string | null;
  effective_from: string;
  license_type_id: string;
  license_type_name: string;
  low_pool_floor: number;
  mode: "automated" | "orchestration";
  pending_invites: number;
  purchased: number;
  vendor_account_id: string;
  vendor_account_name: string;
}

export async function listCurrentSeatPoolCounts(
  database: Queryable,
  input: {
    readonly operatingDate: string;
    /** Current status is evaluated at this instant; action status history is not reconstructed. */
    readonly asOf: Date;
    readonly vendorAccountId?: string;
  },
): Promise<SeatPoolCountsSnapshot[]> {
  const result = await database.query<SeatPoolRow>(
    `SELECT va.id::text AS vendor_account_id,
            va.name AS vendor_account_name,
            va.mode,
            va.contract_renewal_on::text,
            va.low_pool_floor::int,
            lt.id::text AS license_type_id,
            lt.name AS license_type_name,
            capacity.purchased_qty::int AS purchased,
            capacity.effective_from::text AS effective_from,
            assignments.assigned::int,
            invitations.pending_invites::int
     FROM vendor_account va
     JOIN LATERAL (
       SELECT DISTINCT ON (vac.license_type_id)
              vac.license_type_id, vac.purchased_qty, vac.effective_from
       FROM vendor_account_capacity vac
       WHERE vac.vendor_account_id = va.id
         AND vac.effective_from <= $1::date
         AND vac.created_at <= $3::timestamptz
       ORDER BY vac.license_type_id, vac.effective_from DESC,
                vac.created_at DESC, vac.id DESC
     ) capacity ON TRUE
     JOIN license_type lt
       ON lt.id = capacity.license_type_id
      AND lt.vendor_id = va.vendor_id
     JOIN LATERAL (
       SELECT count(*)::int AS assigned
       FROM license_assignment assignment
       JOIN person holder
         ON holder.id = assignment.person_id
        AND holder.company_id = assignment.company_id
       JOIN company tenant ON tenant.id = assignment.company_id
       WHERE assignment.vendor_account_id = va.id
         AND assignment.license_type_id = lt.id
         AND assignment.started_on <= $1::date
         AND assignment.created_at <= $3::timestamptz
         AND (assignment.ended_on IS NULL OR assignment.ended_on >= $1::date)
     ) assignments ON TRUE
     JOIN LATERAL (
       SELECT count(*)::int AS pending_invites
       FROM provisioning_action action
       JOIN license_request request
         ON request.id = action.request_id
        AND request.vendor_account_id = action.vendor_account_id
       JOIN person requester
         ON requester.id = request.person_id
        AND requester.company_id = request.company_id
       JOIN company tenant ON tenant.id = request.company_id
       WHERE action.vendor_account_id = va.id
         AND request.license_type_id = lt.id
         AND action.kind = 'invite'
         AND action.mode = 'automated'
         AND action.status IN ('pending', 'sent')
         AND action.created_at <= $3::timestamptz
     ) invitations ON TRUE
     WHERE va.status = 'active'
       AND lt.status = 'active'
       AND ($2::uuid IS NULL OR va.id = $2)
     ORDER BY va.id, lt.id`,
    [input.operatingDate, input.vendorAccountId ?? null, input.asOf],
  );
  return result.rows.map((row) => ({
    assigned: row.assigned,
    contractRenewalOn: row.contract_renewal_on,
    effectiveFrom: row.effective_from,
    licenseTypeId: row.license_type_id,
    licenseTypeName: row.license_type_name,
    lowPoolFloor: row.low_pool_floor,
    mode: row.mode,
    pendingInvites: row.pending_invites,
    purchased: row.purchased,
    vendorAccountId: row.vendor_account_id,
    vendorAccountName: row.vendor_account_name,
  }));
}
