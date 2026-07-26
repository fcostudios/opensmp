-- US-003: database-enforced register integrity and runtime least privilege.
-- This complements the generated schema with PostgreSQL features Drizzle cannot
-- represent: exclusion constraints, a deferred constraint trigger, and exact
-- column-level application grants.

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE license_assignment
  ADD CONSTRAINT license_assignment_no_overlap
  EXCLUDE USING gist (
    person_id WITH =,
    vendor_account_id WITH =,
    license_type_id WITH =,
    daterange(started_on, COALESCE(ended_on + 1, 'infinity'::date), '[)') WITH &&
  );

CREATE UNIQUE INDEX reclamation_proposal_one_pending_per_assignment
  ON reclamation_proposal (assignment_id)
  WHERE status = 'pending';

CREATE OR REPLACE FUNCTION public.license_assignment_reallocation_contiguous()
RETURNS trigger AS $$
BEGIN
  IF NEW.end_reason = 'reallocated' AND NEW.ended_on IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.license_assignment AS successor
      WHERE successor.id <> NEW.id
        AND successor.person_id = NEW.person_id
        AND successor.vendor_account_id = NEW.vendor_account_id
        AND successor.license_type_id = NEW.license_type_id
        AND successor.started_on > NEW.started_on
        AND successor.started_on <= NEW.ended_on + 1
    ) THEN
      RAISE EXCEPTION
        USING ERRCODE = '23514',
          CONSTRAINT = 'license_assignment_reallocation_contiguous',
          MESSAGE = 'reallocated license assignments require a contiguous successor';
    END IF;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

ALTER FUNCTION public.license_assignment_reallocation_contiguous()
  SET search_path = pg_catalog, public;

CREATE CONSTRAINT TRIGGER license_assignment_reallocation_contiguous
  AFTER INSERT OR UPDATE OF ended_on, end_reason
  ON public.license_assignment
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.license_assignment_reallocation_contiguous();

-- The sole hard-delete path for a company role grant. The function is owned by
-- ledger_owner, locks and scopes the target row, writes the immutable
-- before-state audit entry, and deletes as one statement-level transaction.
CREATE OR REPLACE FUNCTION public.revoke_company_role_assignment(
  p_assignment_id uuid,
  p_company_id uuid,
  p_actor_user_id uuid
)
RETURNS TABLE (
  id uuid,
  user_account_id uuid,
  company_id uuid,
  role company_role_assignment_role_enum,
  unique_grant text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  assignment_row public.company_role_assignment%ROWTYPE;
  deleted_assignment public.company_role_assignment%ROWTYPE;
BEGIN
  SELECT *
  INTO assignment_row
  FROM public.company_role_assignment AS role_assignment
  WHERE role_assignment.id = p_assignment_id
    AND role_assignment.company_id = p_company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  INSERT INTO public.audit_log (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    company_id,
    note,
    before,
    after,
    occurred_at
  ) VALUES (
    p_actor_user_id,
    'company_role_assignment.revoked',
    'CompanyRoleAssignment',
    assignment_row.id,
    assignment_row.company_id,
    NULL,
    to_jsonb(assignment_row),
    NULL,
    now()
  );

  DELETE FROM public.company_role_assignment AS role_assignment
  WHERE role_assignment.id = p_assignment_id
    AND role_assignment.company_id = p_company_id
  RETURNING * INTO deleted_assignment;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'company-role assignment disappeared while locked';
  END IF;

  RETURN QUERY
  SELECT
    deleted_assignment.id,
    deleted_assignment.user_account_id,
    deleted_assignment.company_id,
    deleted_assignment.role,
    deleted_assignment.unique_grant;
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_company_role_assignment(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revoke_company_role_assignment(uuid, uuid, uuid) TO ledger_app;

-- The application can use the schema but never owns it or creates objects in
-- it.  New tables are opt-in in a later owner migration rather than inheriting
-- broad runtime access.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO ledger_app;

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM ledger_app;

GRANT SELECT, INSERT ON TABLE
  alert_rule,
  alert_event,
  system_setting,
  audit_log,
  rate_card,
  statement,
  statement_line,
  close_run,
  reconciliation,
  reconciliation_variance_line,
  company,
  person,
  user_account,
  company_role_assignment,
  license_assignment,
  provisioning_action,
  reclamation_proposal,
  license_request,
  request_transition,
  activity_record,
  cost_record,
  vendor,
  vendor_account,
  vendor_account_capacity,
  license_type,
  integration_credential
TO ledger_app;

REVOKE UPDATE, DELETE ON ALL TABLES IN SCHEMA public FROM ledger_app;

-- Mutable catalog and workflow state. Effective-dated and ledger/event rows
-- remain insert-only unless explicitly granted below.
GRANT UPDATE ON TABLE
  alert_rule,
  system_setting,
  statement,
  close_run,
  reconciliation,
  company,
  person,
  user_account,
  company_role_assignment,
  reclamation_proposal,
  license_request,
  vendor,
  vendor_account,
  license_type,
  integration_credential
TO ledger_app;

-- BR-28: exactly the legal in-place mutations on append-only entities.
GRANT UPDATE (ended_on, end_reason)
  ON license_assignment TO ledger_app;
GRANT UPDATE (status, sent_at, resolved_at)
  ON provisioning_action TO ledger_app;
GRANT UPDATE (acknowledged_by, acknowledged_at)
  ON alert_event TO ledger_app;

-- Raw hard deletes are forbidden. The SECURITY DEFINER routine above is the
-- only audited revocation path available to the application role.
REVOKE DELETE ON company_role_assignment FROM ledger_app;
