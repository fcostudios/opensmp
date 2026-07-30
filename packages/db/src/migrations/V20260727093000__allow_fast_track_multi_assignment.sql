-- US-010: one company-move request materializes every open assignment's
-- contiguous successor. The generated Drizzle schema already models this
-- relationship as many assignments to one request; preserve its FK and normal
-- lookup index while removing the contradictory one-to-one constraint.
ALTER TABLE public.license_assignment
  DROP CONSTRAINT uq_license_assignment_source_request_id;
