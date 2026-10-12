-- US-083 / DEC-SMP-043..045: authoritative catalog and accepted observations.
CREATE TYPE public.vendor_member_seat_evidence_enum AS ENUM ('provider_field','all_members_licensed','none');
CREATE TYPE public.vendor_member_license_identity_enum AS ENUM ('provider_field','none');
ALTER TABLE public.vendor ADD COLUMN member_seat_evidence public.vendor_member_seat_evidence_enum NOT NULL DEFAULT 'none',
  ADD COLUMN member_license_identity public.vendor_member_license_identity_enum NOT NULL DEFAULT 'none';
ALTER TABLE public.license_type ADD COLUMN provider_ref text;
ALTER TABLE public.license_type ADD CONSTRAINT uq_license_type_vendor_provider_ref UNIQUE (vendor_id,provider_ref);
ALTER TABLE public.vendor_account ADD COLUMN default_license_type_id uuid REFERENCES public.license_type(id);
UPDATE public.vendor SET member_seat_evidence='all_members_licensed',member_license_identity='none' WHERE lower(name)='anthropic';
CREATE FUNCTION public.initialize_vendor_member_capability() RETURNS trigger LANGUAGE plpgsql AS $bootstrap$
BEGIN
  IF lower(NEW.name) = 'anthropic' THEN
    NEW.member_seat_evidence := 'all_members_licensed';
    NEW.member_license_identity := 'none';
  END IF;
  RETURN NEW;
END;
$bootstrap$;
CREATE TRIGGER trg_vendor_member_capability_bootstrap BEFORE INSERT ON public.vendor
  FOR EACH ROW EXECUTE FUNCTION public.initialize_vendor_member_capability();
REVOKE ALL ON FUNCTION public.initialize_vendor_member_capability() FROM PUBLIC;

CREATE TABLE public.member_observation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_account_id uuid NOT NULL REFERENCES public.vendor_account(id),
  source public.ingestion_source NOT NULL,
  observed_at timestamptz NOT NULL,
  content_hash text NOT NULL,
  member_count integer NOT NULL,
  licensed_count integer NOT NULL,
  invited_count integer NOT NULL,
  warnings jsonb NOT NULL DEFAULT '[]',
  correlation_id uuid,
  accepted_at timestamptz NOT NULL,
  accepted_by uuid REFERENCES public.user_account(id),
  CONSTRAINT uq_member_observation_account_observed UNIQUE (vendor_account_id,observed_at),
  CONSTRAINT member_observation_counts_check CHECK (member_count >= 0 AND licensed_count >= 0 AND invited_count >= 0 AND licensed_count <= member_count),
  CONSTRAINT member_observation_hash_check CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT member_observation_warnings_check CHECK (jsonb_typeof(warnings) = 'array')
);
CREATE INDEX idx_member_observation_correlation ON public.member_observation(correlation_id);
CREATE FUNCTION public.prevent_member_observation_mutation() RETURNS trigger LANGUAGE plpgsql AS $append_only$
BEGIN
  RAISE EXCEPTION 'member observations are append-only' USING ERRCODE = '55000';
END;
$append_only$;
CREATE TRIGGER trg_member_observation_append_only BEFORE UPDATE OR DELETE ON public.member_observation
  FOR EACH ROW EXECUTE FUNCTION public.prevent_member_observation_mutation();
REVOKE ALL ON FUNCTION public.prevent_member_observation_mutation() FROM PUBLIC;
ALTER TABLE public.member_observation ENABLE ROW LEVEL SECURITY;
-- Catalog authority is application-enforced; no company exists for unregistered members.
CREATE POLICY member_observation_catalog_select ON public.member_observation FOR SELECT TO ledger_app
  USING (EXISTS (SELECT 1 FROM public.vendor_account WHERE id=vendor_account_id));
CREATE POLICY member_observation_catalog_insert ON public.member_observation FOR INSERT TO ledger_app
  WITH CHECK (EXISTS (SELECT 1 FROM public.vendor_account WHERE id=vendor_account_id));
GRANT SELECT,INSERT ON public.member_observation TO ledger_app;
REVOKE UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON public.member_observation FROM ledger_app;
