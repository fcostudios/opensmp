DO $$
DECLARE
  valid_constraints integer;
BEGIN
  SELECT count(*)::integer
    INTO valid_constraints
  FROM pg_constraint constraint_state
  JOIN pg_class relation ON relation.oid = constraint_state.conrelid
  JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public'
    AND constraint_state.convalidated
    AND (
      (
        relation.relname = 'vendor_account'
        AND constraint_state.conname =
          'vendor_account_low_pool_floor_nonnegative'
        AND pg_get_constraintdef(constraint_state.oid) =
          'CHECK ((low_pool_floor >= 0))'
      )
      OR
      (
        relation.relname = 'vendor_account_capacity'
        AND constraint_state.conname =
          'vendor_account_capacity_purchased_qty_nonnegative'
        AND pg_get_constraintdef(constraint_state.oid) =
          'CHECK ((purchased_qty >= 0))'
      )
    );

  IF valid_constraints <> 2 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'nonnegative pool invariant verification failed';
  END IF;
END
$$;
