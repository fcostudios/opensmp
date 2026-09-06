-- US-057: this assertion is also rerun by the central release verifier.
DO $verify_connector_call$
DECLARE
  actual jsonb;
  source text;
  journal oid := to_regclass('public.connector_call_observation');
BEGIN
  IF journal IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_class WHERE oid = journal AND relkind = 'r'
      AND pg_get_userbyid(relowner) = 'ledger_owner'
  ) THEN RAISE EXCEPTION 'connector call table contract mismatch'; END IF;

  SELECT jsonb_agg(jsonb_build_array(a.attname, format_type(a.atttypid, a.atttypmod),
    a.attnotnull, pg_get_expr(d.adbin, d.adrelid)) ORDER BY a.attnum) INTO actual
  FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
  WHERE a.attrelid = journal AND a.attnum > 0 AND NOT a.attisdropped;
  IF actual IS DISTINCT FROM $columns$
[
  [
    "id",
    "uuid",
    true,
    "gen_random_uuid()"
  ],
  [
    "vendor_account_id",
    "uuid",
    true,
    null
  ],
  [
    "provisioning_action_id",
    "uuid",
    false,
    null
  ],
  [
    "correlation_id",
    "uuid",
    true,
    null
  ],
  [
    "operation",
    "connector_call_operation_enum",
    true,
    null
  ],
  [
    "attempt",
    "integer",
    true,
    null
  ],
  [
    "phase",
    "connector_call_phase_enum",
    true,
    null
  ],
  [
    "classification",
    "text",
    false,
    null
  ],
  [
    "summary",
    "jsonb",
    true,
    null
  ],
  [
    "occurred_at",
    "timestamp with time zone",
    true,
    null
  ]
]
$columns$::jsonb
  THEN RAISE EXCEPTION 'connector call column contract mismatch'; END IF;

  SELECT jsonb_object_agg(typname, labels) INTO actual FROM (
    SELECT t.typname, jsonb_agg(e.enumlabel ORDER BY e.enumsortorder) labels
    FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE n.nspname = 'public' AND t.typname IN ('connector_call_operation_enum', 'connector_call_phase_enum')
    GROUP BY t.typname
  ) catalog;
  IF actual IS DISTINCT FROM '{"connector_call_operation_enum":["provision","deprovision","sync_members","sync_activity","sync_cost"],"connector_call_phase_enum":["requested","succeeded","failed"]}'::jsonb
  THEN RAISE EXCEPTION 'connector call enum contract mismatch'; END IF;

  SELECT jsonb_object_agg(conname, pg_get_constraintdef(oid)) INTO actual
  FROM pg_constraint WHERE conrelid = journal AND convalidated AND NOT condeferrable;
  IF actual IS DISTINCT FROM $constraints$
{
  "connector_call_attempt_check": "CHECK ((attempt >= 1))",
  "connector_call_classification_check": "CHECK ((((phase = 'requested'::connector_call_phase_enum) AND (classification IS NULL)) OR ((phase = 'succeeded'::connector_call_phase_enum) AND (classification IS NOT NULL) AND (classification = 'success'::text)) OR ((phase = 'failed'::connector_call_phase_enum) AND (classification IS NOT NULL) AND (classification = ANY (ARRAY['rate_limited'::text, 'provider_error'::text, 'client_error'::text])))))",
  "connector_call_observation_pkey": "PRIMARY KEY (id)",
  "connector_call_observation_provisioning_action_id_fkey": "FOREIGN KEY (provisioning_action_id) REFERENCES provisioning_action(id)",
  "connector_call_observation_vendor_account_id_fkey": "FOREIGN KEY (vendor_account_id) REFERENCES vendor_account(id)",
  "connector_call_summary_check": "CHECK ((jsonb_typeof(summary) = 'object'::text))",
  "connector_call_sync_action_check": "CHECK (((operation = ANY (ARRAY['provision'::connector_call_operation_enum, 'deprovision'::connector_call_operation_enum])) OR (provisioning_action_id IS NULL)))",
  "uq_connector_call_phase": "UNIQUE (correlation_id, attempt, phase)"
}
$constraints$::jsonb
    OR (SELECT count(*) FROM pg_constraint WHERE conrelid = journal) <> 8
  THEN RAISE EXCEPTION 'connector call constraint contract mismatch'; END IF;

  SELECT jsonb_object_agg(c.relname, pg_get_indexdef(i.indexrelid)) INTO actual
  FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
  WHERE i.indrelid = journal AND i.indisvalid AND i.indisready;
  IF actual IS DISTINCT FROM $indexes$
{
  "connector_call_observation_pkey": "CREATE UNIQUE INDEX connector_call_observation_pkey ON public.connector_call_observation USING btree (id)",
  "idx_connector_call_action": "CREATE INDEX idx_connector_call_action ON public.connector_call_observation USING btree (provisioning_action_id)",
  "idx_connector_call_correlation": "CREATE INDEX idx_connector_call_correlation ON public.connector_call_observation USING btree (correlation_id)",
  "idx_connector_call_occurred_at": "CREATE INDEX idx_connector_call_occurred_at ON public.connector_call_observation USING btree (occurred_at)",
  "idx_connector_call_operation": "CREATE INDEX idx_connector_call_operation ON public.connector_call_observation USING btree (operation)",
  "idx_connector_call_vendor_account": "CREATE INDEX idx_connector_call_vendor_account ON public.connector_call_observation USING btree (vendor_account_id)",
  "uq_connector_call_phase": "CREATE UNIQUE INDEX uq_connector_call_phase ON public.connector_call_observation USING btree (correlation_id, attempt, phase)",
  "uq_connector_call_terminal": "CREATE UNIQUE INDEX uq_connector_call_terminal ON public.connector_call_observation USING btree (correlation_id, attempt) WHERE (phase = ANY (ARRAY['succeeded'::connector_call_phase_enum, 'failed'::connector_call_phase_enum]))"
}
$indexes$::jsonb
    OR (SELECT count(*) FROM pg_index WHERE indrelid = journal) <> 8
  THEN RAISE EXCEPTION 'connector call index contract mismatch'; END IF;

  SELECT jsonb_object_agg(t.tgname, jsonb_build_array(t.tgtype::int, t.tgenabled,
    n.nspname, p.proname, l.lanname, p.prorettype = 'trigger'::regtype,
    pg_get_userbyid(p.proowner), p.prosecdef, p.proconfig, t.tgnargs,
    t.tgqual IS NULL, t.tgattr::text, p.provolatile, p.proisstrict, p.proretset, p.proparallel)) INTO actual
  FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
  JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_language l ON l.oid = p.prolang
  WHERE t.tgrelid = journal AND NOT t.tgisinternal;
  IF actual IS DISTINCT FROM '{
    "trg_connector_call_validate":[7,"O","public","validate_connector_call_observation","plpgsql",true,"ledger_owner",false,null,0,true,"","v",false,false,"u"],
    "trg_connector_call_append_only":[27,"O","public","prevent_connector_call_mutation","plpgsql",true,"ledger_owner",false,null,0,true,"","v",false,false,"u"]
  }'::jsonb THEN RAISE EXCEPTION 'connector call trigger contract mismatch'; END IF;

  SELECT prosrc INTO source FROM pg_proc WHERE oid = 'public.validate_connector_call_observation()'::regprocedure;
  IF btrim(regexp_replace(source, '\s+', ' ', 'g')) IS DISTINCT FROM
    regexp_replace(btrim($expected_source$DECLARE
  context_row public.connector_call_observation%ROWTYPE;
  last_attempt integer;
BEGIN
  -- A transaction-scoped lock makes concurrent appends use one correlation order.
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.correlation_id::text, 57057));
  IF NEW.provisioning_action_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.provisioning_action
    WHERE id = NEW.provisioning_action_id AND vendor_account_id = NEW.vendor_account_id
  ) THEN
    RAISE EXCEPTION 'connector call action/account mismatch' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO context_row FROM public.connector_call_observation
    WHERE correlation_id = NEW.correlation_id ORDER BY attempt, phase LIMIT 1;
  IF FOUND AND (
    context_row.vendor_account_id IS DISTINCT FROM NEW.vendor_account_id
    OR context_row.operation IS DISTINCT FROM NEW.operation
    OR context_row.provisioning_action_id IS DISTINCT FROM NEW.provisioning_action_id
  ) THEN
    RAISE EXCEPTION 'connector call correlation context mismatch' USING ERRCODE = '23514';
  END IF;
  IF NEW.phase = 'requested' THEN
    SELECT COALESCE(MAX(attempt), 0) INTO last_attempt FROM public.connector_call_observation
      WHERE correlation_id = NEW.correlation_id AND phase = 'requested';
    IF NEW.attempt <> last_attempt + 1 THEN
      RAISE EXCEPTION 'connector call requested attempt must be sequential' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM public.connector_call_observation
      WHERE correlation_id = NEW.correlation_id AND attempt = NEW.attempt AND phase = 'requested'
    ) THEN
      RAISE EXCEPTION 'connector call terminal requires requested' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.connector_call_observation
      WHERE correlation_id = NEW.correlation_id AND attempt = NEW.attempt AND phase IN ('succeeded', 'failed')
    ) THEN
      RAISE EXCEPTION 'connector call already has terminal outcome' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;$expected_source$), '\s+', ' ', 'g')
  THEN RAISE EXCEPTION 'connector call validator source mismatch'; END IF;
  SELECT prosrc INTO source FROM pg_proc WHERE oid = 'public.prevent_connector_call_mutation()'::regprocedure;
  IF btrim(regexp_replace(source, '\s+', ' ', 'g')) IS DISTINCT FROM
    'BEGIN RAISE EXCEPTION ''connector call observations are append-only'' USING ERRCODE = ''55000''; END;'
  THEN RAISE EXCEPTION 'connector call append-only source mismatch'; END IF;

  SELECT jsonb_agg(privilege_type ORDER BY privilege_type) INTO actual
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public' AND table_name = 'connector_call_observation' AND grantee = 'ledger_app';
  IF actual IS DISTINCT FROM '["INSERT","SELECT"]'::jsonb
    OR EXISTS (SELECT 1 FROM pg_class c, LATERAL aclexplode(c.relacl) acl
      WHERE c.oid = journal AND acl.grantee = 0)
    OR NOT has_table_privilege('ledger_app', journal, 'SELECT')
    OR NOT has_table_privilege('ledger_app', journal, 'INSERT')
    OR has_table_privilege('ledger_app', journal, 'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    OR has_any_column_privilege('ledger_app', journal, 'UPDATE,REFERENCES')
  THEN RAISE EXCEPTION 'connector call runtime grant mismatch'; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p, LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
    WHERE p.oid IN ('public.validate_connector_call_observation()'::regprocedure,
      'public.prevent_connector_call_mutation()'::regprocedure)
      AND acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
  ) OR has_function_privilege('ledger_app', 'public.validate_connector_call_observation()', 'EXECUTE')
    OR has_function_privilege('ledger_app', 'public.prevent_connector_call_mutation()', 'EXECUTE')
  THEN RAISE EXCEPTION 'connector call function grant mismatch'; END IF;
END
$verify_connector_call$;
