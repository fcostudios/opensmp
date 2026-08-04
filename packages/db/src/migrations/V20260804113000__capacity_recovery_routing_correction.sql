-- US-023 quality correction: event-safe release work and application-owned routing.
ALTER TABLE public.capacity_recovery_work
  ADD COLUMN release_event_id uuid;

UPDATE public.capacity_recovery_work
SET release_event_id=id
WHERE source='seat_freed' AND release_event_id IS NULL;

ALTER TABLE public.capacity_recovery_work
  ADD CONSTRAINT capacity_recovery_release_identity_check
  CHECK ((source='seat_freed') = (release_event_id IS NOT NULL));

CREATE OR REPLACE FUNCTION public.enqueue_capacity_recovery(
  p_capacity_id uuid,p_vendor_account_id uuid,p_license_type_id uuid,
  p_effective_from date,p_source text,p_created_at timestamptz,
  p_release_event_id uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_id uuid; v_available timestamptz; v_key text;
BEGIN
  IF p_source NOT IN ('capacity_change','seat_freed') THEN
    RAISE EXCEPTION 'CAPACITY_RECOVERY_SOURCE_INVALID';
  END IF;
  IF (p_source='seat_freed') <> (p_release_event_id IS NOT NULL) THEN
    RAISE EXCEPTION 'CAPACITY_RECOVERY_RELEASE_IDENTITY_INVALID';
  END IF;
  v_available := greatest(p_created_at,
    ((p_effective_from::text || ' 00:00:00 America/Guayaquil')::timestamptz));
  v_key := CASE WHEN p_source='seat_freed'
    THEN 'seat-freed:' || p_release_event_id::text
    ELSE p_capacity_id::text || ':' || p_vendor_account_id || ':' ||
         p_license_type_id || ':' || p_effective_from || ':' || p_source END;
  INSERT INTO public.capacity_recovery_work
    (idempotency_key,capacity_id,vendor_account_id,license_type_id,effective_from,
     available_at,source,release_event_id,created_at)
  VALUES (v_key,p_capacity_id,p_vendor_account_id,p_license_type_id,p_effective_from,
          v_available,p_source,p_release_event_id,p_created_at)
  ON CONFLICT (idempotency_key) DO UPDATE
    SET available_at=least(capacity_recovery_work.available_at,excluded.available_at)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.enqueue_capacity_recovery(
  uuid,uuid,uuid,date,text,timestamptz,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_capacity_recovery(
  uuid,uuid,uuid,date,text,timestamptz,uuid) TO ledger_app;

-- The worker now uses the shared validated application command. Retain the
-- committed signature only as an explicit fail-closed compatibility boundary.
CREATE OR REPLACE FUNCTION public.recover_blocked_requests_for_capacity(
  p_capacity_id uuid,p_vendor_account_id uuid,p_license_type_id uuid,
  p_effective_from date,p_company_ids uuid[],p_occurred_at timestamptz
) RETURNS SETOF uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  RAISE EXCEPTION 'CAPACITY_RECOVERY_USE_APPLICATION_ROUTER';
END $$;

REVOKE ALL ON FUNCTION public.recover_blocked_requests_for_capacity(
  uuid,uuid,uuid,date,uuid[],timestamptz) FROM ledger_app;
