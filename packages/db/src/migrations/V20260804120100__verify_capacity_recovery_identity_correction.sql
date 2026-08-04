DO $verify_capacity_recovery_identity_correction$
DECLARE
  constraint_definition text;
  enqueue_source text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO constraint_definition
  FROM pg_constraint
  WHERE conrelid='public.capacity_recovery_work'::regclass
    AND conname='capacity_recovery_identity_xor_check'
    AND contype='c' AND convalidated;
  IF constraint_definition IS NULL
    OR position('source = ''seat_freed''' IN constraint_definition)=0
    OR position('release_event_id IS NOT NULL' IN constraint_definition)=0
    OR position('capacity_id IS NULL' IN constraint_definition)=0
    OR position('source = ''capacity_change''' IN constraint_definition)=0
    OR position('capacity_id IS NOT NULL' IN constraint_definition)=0
    OR position('release_event_id IS NULL' IN constraint_definition)=0
  THEN
    RAISE EXCEPTION 'capacity recovery identity XOR constraint mismatch';
  END IF;

  SELECT prosrc INTO enqueue_source
  FROM pg_proc
  WHERE oid='public.enqueue_capacity_recovery(uuid,uuid,uuid,date,text,timestamptz,uuid)'::regprocedure;
  IF enqueue_source IS NULL
    OR position('CAPACITY_RECOVERY_IDENTITY_INVALID' IN enqueue_source)=0
    OR NOT has_function_privilege(
      'ledger_app',
      'public.enqueue_capacity_recovery(uuid,uuid,uuid,date,text,timestamptz,uuid)',
      'EXECUTE'
    )
  THEN
    RAISE EXCEPTION 'capacity recovery enqueue XOR verification failed';
  END IF;
END
$verify_capacity_recovery_identity_correction$;
