-- US-023 correction: each recovery source has exactly one canonical identity.
UPDATE public.capacity_recovery_work
SET capacity_id=NULL
WHERE source='seat_freed' AND capacity_id IS NOT NULL;

UPDATE public.capacity_recovery_work AS work
SET capacity_id=(
  SELECT capacity.id
  FROM public.vendor_account_capacity AS capacity
  WHERE capacity.vendor_account_id=work.vendor_account_id
    AND capacity.license_type_id=work.license_type_id
    AND capacity.effective_from=work.effective_from
  ORDER BY capacity.created_at DESC,capacity.id DESC
  LIMIT 1
)
WHERE work.source='capacity_change' AND work.capacity_id IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.capacity_recovery_work
    WHERE source='capacity_change' AND capacity_id IS NULL
  ) THEN
    RAISE EXCEPTION 'CAPACITY_RECOVERY_CAPACITY_IDENTITY_UNRECOVERABLE';
  END IF;
END $$;

ALTER TABLE public.capacity_recovery_work
  DROP CONSTRAINT capacity_recovery_release_identity_check,
  ADD CONSTRAINT capacity_recovery_identity_xor_check CHECK (
    (source='seat_freed' AND release_event_id IS NOT NULL AND capacity_id IS NULL)
    OR
    (source='capacity_change' AND capacity_id IS NOT NULL AND release_event_id IS NULL)
  );

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
  IF NOT (
    (p_source='seat_freed' AND p_release_event_id IS NOT NULL AND p_capacity_id IS NULL)
    OR
    (p_source='capacity_change' AND p_capacity_id IS NOT NULL AND p_release_event_id IS NULL)
  ) THEN
    RAISE EXCEPTION 'CAPACITY_RECOVERY_IDENTITY_INVALID';
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
