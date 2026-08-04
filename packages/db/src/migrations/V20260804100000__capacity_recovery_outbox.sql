-- US-023 review correction: transactional, retryable capacity recovery work.
CREATE TABLE public.capacity_recovery_work (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL UNIQUE,
  capacity_id uuid REFERENCES public.vendor_account_capacity(id),
  vendor_account_id uuid NOT NULL REFERENCES public.vendor_account(id),
  license_type_id uuid NOT NULL REFERENCES public.license_type(id),
  effective_from date NOT NULL,
  available_at timestamptz NOT NULL,
  source text NOT NULL CHECK (source IN ('capacity_change','seat_freed')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  lease_token uuid,
  lease_expires_at timestamptz,
  last_error text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((lease_token IS NULL) = (lease_expires_at IS NULL))
);

CREATE INDEX idx_capacity_recovery_work_due
  ON public.capacity_recovery_work (available_at, created_at)
  WHERE status <> 'completed';

REVOKE ALL ON public.capacity_recovery_work FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON public.capacity_recovery_work TO ledger_app;

CREATE OR REPLACE FUNCTION public.enqueue_capacity_recovery(
  p_capacity_id uuid,
  p_vendor_account_id uuid,
  p_license_type_id uuid,
  p_effective_from date,
  p_source text,
  p_created_at timestamptz
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_id uuid; v_available timestamptz;
BEGIN
  IF p_source NOT IN ('capacity_change','seat_freed') THEN
    RAISE EXCEPTION 'CAPACITY_RECOVERY_SOURCE_INVALID';
  END IF;
  v_available := greatest(
    p_created_at,
    ((p_effective_from::text || ' 00:00:00 America/Guayaquil')::timestamptz)
  );
  INSERT INTO public.capacity_recovery_work
    (idempotency_key,capacity_id,vendor_account_id,license_type_id,effective_from,
     available_at,source,created_at)
  VALUES (coalesce(p_capacity_id::text,'seat-freed') || ':' || p_vendor_account_id ||
          ':' || p_license_type_id || ':' || p_effective_from || ':' || p_source,
          p_capacity_id,p_vendor_account_id,p_license_type_id,p_effective_from,
          v_available,p_source,p_created_at)
  ON CONFLICT (idempotency_key) DO UPDATE
    SET available_at = least(capacity_recovery_work.available_at, excluded.available_at)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.enqueue_capacity_recovery(uuid,uuid,uuid,date,text,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_capacity_recovery(uuid,uuid,uuid,date,text,timestamptz) TO ledger_app;
