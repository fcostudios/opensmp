DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.vendor_account WHERE low_pool_floor < 0
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'pool invariant preflight failed: negative low_pool_floor';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.vendor_account_capacity WHERE purchased_qty < 0
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'pool invariant preflight failed: negative purchased_qty';
  END IF;
END
$$;

ALTER TABLE public.vendor_account
  ADD CONSTRAINT vendor_account_low_pool_floor_nonnegative
  CHECK (low_pool_floor >= 0);

ALTER TABLE public.vendor_account_capacity
  ADD CONSTRAINT vendor_account_capacity_purchased_qty_nonnegative
  CHECK (purchased_qty >= 0);
