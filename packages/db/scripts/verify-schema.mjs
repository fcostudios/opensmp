import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { config } from "dotenv";
import pg from "pg";
import { committedMigrations } from "./apply-migrations.mjs";

const explicitEnvironment = {
  DATABASE_ADMIN_URL: process.env.DATABASE_ADMIN_URL,
  DATABASE_URL: process.env.DATABASE_URL,
  MIGRATIONS_DIR: process.env.MIGRATIONS_DIR,
};
config({ path: ".env" });
config({ path: ".env.local", override: true });
for (const [key, value] of Object.entries(explicitEnvironment)) {
  if (value !== undefined) process.env[key] = value;
}

const expectedAppendOnlyTriggers = [
  {
    tableName: "audit_log",
    triggerName: "audit_log_no_mutate",
    functionName: "audit_log_append_only",
    functionSource:
      "BEGIN RAISE EXCEPTION 'append_only: % is forbidden on audit_log', TG_OP; END;",
  },
  {
    tableName: "lifecycle_notification",
    triggerName: "trg_lifecycle_notification_append_only",
    functionName: "prevent_lifecycle_notification_mutation",
    functionSource:
      "BEGIN RAISE EXCEPTION 'lifecycle notification records are append-only' USING ERRCODE = '55000'; END;",
  },
  {
    tableName: "lifecycle_notification_delivery",
    triggerName: "trg_lifecycle_notification_delivery_append_only",
    functionName: "prevent_lifecycle_notification_mutation",
    functionSource:
      "BEGIN RAISE EXCEPTION 'lifecycle notification records are append-only' USING ERRCODE = '55000'; END;",
  },
  {
    tableName: "request_transition",
    triggerName: "request_transition_no_mutate",
    functionName: "request_transition_append_only",
    functionSource:
      "BEGIN RAISE EXCEPTION 'append_only: % is forbidden on request_transition', TG_OP; END;",
  },
];

const coreTableNames = [
  "activity_record",
  "alert_event",
  "alert_notification_delivery",
  "alert_rule",
  "audit_log",
  "close_run",
  "company",
  "company_role_assignment",
  "cost_record",
  "integration_credential",
  "identity_provider_operation",
  "license_assignment",
  "license_request",
  "license_type",
  "lifecycle_notification",
  "lifecycle_notification_delivery",
  "person",
  "provisioning_action",
  "rate_card",
  "reclamation_proposal",
  "reconciliation",
  "reconciliation_variance_line",
  "request_transition",
  "statement",
  "statement_line",
  "system_setting",
  "user_account",
  "vendor",
  "vendor_account",
  "vendor_account_capacity",
];

const normallyUpdateableTableNames = [
  "alert_rule",
  "close_run",
  "company",
  "company_role_assignment",
  "integration_credential",
  "identity_provider_operation",
  "license_request",
  "license_type",
  "person",
  "reclamation_proposal",
  "reconciliation",
  "statement",
  "system_setting",
  "user_account",
  "vendor",
  "vendor_account",
];

const expectedRuntimeTableGrants = [
  ...coreTableNames.flatMap((tableName) => [
    ...(["alert_notification_delivery", "lifecycle_notification_delivery"].includes(tableName)
      ? []
      : [{ tableName, privilege: "INSERT" }]),
    { tableName, privilege: "SELECT" },
  ]),
  ...normallyUpdateableTableNames.map((tableName) => ({
    tableName,
    privilege: "UPDATE",
  })),
].sort((left, right) =>
  left.tableName.localeCompare(right.tableName) ||
  left.privilege.localeCompare(right.privilege),
);

const expectedAppendOnlyColumnUpdates = [
  { tableName: "alert_event", columnName: "acknowledged_at" },
  { tableName: "alert_event", columnName: "acknowledged_by" },
  { tableName: "license_assignment", columnName: "end_reason" },
  { tableName: "license_assignment", columnName: "ended_on" },
  { tableName: "provisioning_action", columnName: "failure_reason" },
  { tableName: "provisioning_action", columnName: "resolved_at" },
  { tableName: "provisioning_action", columnName: "sent_at" },
  { tableName: "provisioning_action", columnName: "status" },
];

const systemUserId = "00000000-0000-0000-0000-000000000001";

function normalizeSqlDefinition(value) {
  return value
    .toLowerCase()
    .replace(/::[a-z_][a-z0-9_]*/g, "")
    .replace(/\s+/g, "");
}

const expectedContiguityFunctionSource = normalizeSqlDefinition(`
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
`);

const expectedRoleRevocationFunctionSource = normalizeSqlDefinition(`
DECLARE
  assignment_row public.company_role_assignment%ROWTYPE;
  deleted_assignment public.company_role_assignment%ROWTYPE;
BEGIN
  IF p_note IS NULL OR btrim(p_note) = '' THEN
    RAISE EXCEPTION 'role revocation note is required' USING ERRCODE = '22023';
  END IF;

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
    'identity.company_role.removed',
    'CompanyRoleAssignment',
    assignment_row.id,
    assignment_row.company_id,
    p_note,
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
`);

export async function verifyMigratedSchema({
  databaseAdminUrl = process.env.DATABASE_ADMIN_URL,
  applicationUrl = process.env.DATABASE_URL,
  migrationsDirectory = process.env.MIGRATIONS_DIR,
} = {}) {
  if (!databaseAdminUrl) {
    throw new Error(
      "DATABASE_ADMIN_URL is required to verify committed migrations as ledger_owner",
    );
  }
  if (!applicationUrl) {
    throw new Error(
      "DATABASE_URL is required to verify ledger_app runtime grants",
    );
  }

  const owner = new pg.Client({
    connectionString: databaseAdminUrl,
    application_name: "ledger-schema-verifier",
  });
  await owner.connect();
  let ownerName;
  let tableCount;
  let migrationCount;
  try {
    const identity = await owner.query("SELECT current_user");
    ownerName = identity.rows[0]?.current_user;
    if (ownerName !== "ledger_owner") {
      throw new Error(
        `DATABASE_ADMIN_URL must connect as ledger_owner, connected as ${ownerName}`,
      );
    }
    const tables = await owner.query(`
      SELECT
        relation.relname AS table_name,
        pg_get_userbyid(relation.relowner) AS owner_name
      FROM pg_class AS relation
      JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public'
        AND relation.relkind IN ('r', 'p')
        AND relation.relname <> 'ledger_schema_migrations'
      ORDER BY relation.relname
    `);
    tableCount = tables.rows.length;
    if (tableCount === 0) {
      throw new Error("0 migrated application tables found in public");
    }
    const ownershipDrift = tables.rows.filter(
      ({ owner_name }) => owner_name !== "ledger_owner",
    );
    if (ownershipDrift.length > 0) {
      throw new Error(
        "application table ownership mismatch: " +
          ownershipDrift
            .map(
              ({ table_name, owner_name }) =>
                `${table_name}:${owner_name ?? "<missing>"}`,
            )
            .join(", "),
      );
    }

    const identityProviderColumns = await owner.query(`
      SELECT
        attribute.attname AS name,
        format_type(attribute.atttypid, attribute.atttypmod) AS type,
        attribute.attnotnull AS not_null,
        pg_get_expr(default_value.adbin, default_value.adrelid) AS default_value
      FROM pg_attribute AS attribute
      LEFT JOIN pg_attrdef AS default_value
        ON default_value.adrelid = attribute.attrelid
        AND default_value.adnum = attribute.attnum
      WHERE attribute.attrelid = 'public.identity_provider_operation'::regclass
        AND attribute.attnum > 0
        AND NOT attribute.attisdropped
      ORDER BY attribute.attnum
    `);
    const expectedIdentityProviderColumns = [
      ["id", "uuid", true, "gen_random_uuid()"],
      ["idempotency_key", "text", true, null],
      ["kind", "text", true, null],
      ["status", "text", true, null],
      ["actor_user_id", "uuid", true, null],
      ["target_user_account_id", "uuid", false, null],
      ["company_id", "uuid", false, null],
      ["provider_subject", "text", false, null],
      ["payload", "jsonb", true, null],
      ["attempt_count", "integer", true, "0"],
      ["last_attempted_at", "timestamp with time zone", false, null],
      ["next_retry_at", "timestamp with time zone", false, null],
      ["original_failure", "text", false, null],
      ["cleanup_failure", "text", false, null],
      ["created_at", "timestamp with time zone", true, null],
      ["completed_at", "timestamp with time zone", false, null],
      ["lease_token", "uuid", false, null],
      ["lease_expires_at", "timestamp with time zone", false, null],
    ];
    const actualIdentityProviderColumns = identityProviderColumns.rows.map(
      ({ name, type, not_null, default_value }) => [name, type, not_null, default_value],
    );
    if (JSON.stringify(actualIdentityProviderColumns) !== JSON.stringify(expectedIdentityProviderColumns)) {
      throw new Error(
        `identity_provider_operation column contract mismatch: ${JSON.stringify(actualIdentityProviderColumns)}`,
      );
    }

    const identityProviderConstraints = await owner.query(`
      SELECT
        constraint_row.conname AS name,
        constraint_row.contype AS type,
        ARRAY(
          SELECT attribute.attname
          FROM unnest(constraint_row.conkey) WITH ORDINALITY AS key(attnum, position)
          JOIN pg_attribute AS attribute
            ON attribute.attrelid = constraint_row.conrelid
            AND attribute.attnum = key.attnum
          ORDER BY key.position
        )::text[] AS source_columns,
        CASE WHEN constraint_row.contype = 'f'
          THEN constraint_row.confrelid::regclass::text ELSE NULL END AS target,
        CASE WHEN constraint_row.contype = 'f' THEN ARRAY(
          SELECT attribute.attname
          FROM unnest(constraint_row.confkey) WITH ORDINALITY AS key(attnum, position)
          JOIN pg_attribute AS attribute
            ON attribute.attrelid = constraint_row.confrelid
            AND attribute.attnum = key.attnum
          ORDER BY key.position
        )::text[] ELSE NULL END AS target_columns,
        constraint_row.confupdtype AS on_update,
        constraint_row.confdeltype AS on_delete,
        constraint_row.convalidated AS validated,
        pg_get_constraintdef(constraint_row.oid) AS definition
      FROM pg_constraint AS constraint_row
      WHERE constraint_row.conrelid = 'public.identity_provider_operation'::regclass
      ORDER BY constraint_row.conname
    `);
    const expectedIdentityProviderConstraints = [
      ["identity_provider_operation_actor_user_id_fkey", "f", ["actor_user_id"], "user_account", ["id"], "a", "a", true, "FOREIGN KEY (actor_user_id) REFERENCES user_account(id)"],
      ["identity_provider_operation_attempt_count_check", "c", ["attempt_count"], null, null, " ", " ", true, "CHECK ((attempt_count >= 0))"],
      ["identity_provider_operation_company_id_fkey", "f", ["company_id"], "company", ["id"], "a", "a", true, "FOREIGN KEY (company_id) REFERENCES company(id)"],
      ["identity_provider_operation_idempotency_key_key", "u", ["idempotency_key"], null, null, " ", " ", true, "UNIQUE (idempotency_key)"],
      ["identity_provider_operation_kind_check", "c", ["kind"], null, null, " ", " ", true, "CHECK ((kind = ANY (ARRAY['create_user'::text, 'disable_user'::text, 'reset_two_factor'::text])))"],
      ["identity_provider_operation_lease_pair_check", "c", ["lease_token", "lease_expires_at"], null, null, " ", " ", true, "CHECK ((((lease_token IS NULL) AND (lease_expires_at IS NULL)) OR ((lease_token IS NOT NULL) AND (lease_expires_at IS NOT NULL))))"],
      ["identity_provider_operation_pkey", "p", ["id"], null, null, " ", " ", true, "PRIMARY KEY (id)"],
      ["identity_provider_operation_status_check", "c", ["status"], null, null, " ", " ", true, "CHECK ((status = ANY (ARRAY['pending'::text, 'provider_applied'::text, 'cleanup_pending'::text, 'compensated'::text, 'completed'::text, 'failed'::text])))"],
      ["identity_provider_operation_target_user_account_id_fkey", "f", ["target_user_account_id"], "user_account", ["id"], "a", "a", true, "FOREIGN KEY (target_user_account_id) REFERENCES user_account(id)"],
    ];
    const actualIdentityProviderConstraints = identityProviderConstraints.rows.map(
      ({ name, type, source_columns, target, target_columns, on_update, on_delete, validated, definition }) =>
        [name, type, source_columns, target, target_columns, on_update, on_delete, validated, definition],
    );
    if (JSON.stringify(actualIdentityProviderConstraints) !== JSON.stringify(expectedIdentityProviderConstraints)) {
      throw new Error(
        `identity_provider_operation constraint contract mismatch: ${JSON.stringify(actualIdentityProviderConstraints)}`,
      );
    }

    const identityProviderIndexes = await owner.query(`
      SELECT
        index_relation.relname AS name,
        index_state.indisunique AS unique,
        index_state.indisready AS ready,
        index_state.indisvalid AS valid,
        ARRAY(
          SELECT attribute.attname
          FROM unnest(index_state.indkey::smallint[]) WITH ORDINALITY AS key(attnum, position)
          JOIN pg_attribute AS attribute
            ON attribute.attrelid = index_state.indrelid
            AND attribute.attnum = key.attnum
          ORDER BY key.position
        )::text[] AS columns,
        pg_get_expr(index_state.indpred, index_state.indrelid) AS predicate
      FROM pg_index AS index_state
      JOIN pg_class AS index_relation ON index_relation.oid = index_state.indexrelid
      WHERE index_state.indrelid = 'public.identity_provider_operation'::regclass
      ORDER BY index_relation.relname
    `);
    const expectedIdentityProviderIndexes = [
      {
        name: "identity_provider_operation_idempotency_key_key",
        unique: true,
        ready: true,
        valid: true,
        columns: ["idempotency_key"],
        predicate: null,
      },
      {
        name: "identity_provider_operation_pkey",
        unique: true,
        ready: true,
        valid: true,
        columns: ["id"],
        predicate: null,
      },
      {
        name: "idx_identity_provider_operation_retry",
        unique: false,
        ready: true,
        valid: true,
        columns: ["next_retry_at", "created_at"],
        predicate: "(status = ANY (ARRAY['pending'::text, 'provider_applied'::text, 'cleanup_pending'::text]))",
      },
    ];
    if (JSON.stringify(identityProviderIndexes.rows) !== JSON.stringify(expectedIdentityProviderIndexes)) {
      throw new Error(
        `identity_provider_operation index contract mismatch: ${JSON.stringify(identityProviderIndexes.rows)}`,
      );
    }

    const committed = await committedMigrations(migrationsDirectory);
    const applied = await owner.query(
      "SELECT filename, sha256 FROM ledger_schema_migrations ORDER BY filename",
    );
    const expected = committed.map(({ filename, sha256 }) => ({
      filename,
      sha256,
    }));
    if (JSON.stringify(applied.rows) !== JSON.stringify(expected)) {
      throw new Error(
        `committed migration ledger mismatch: expected ${JSON.stringify(expected)}, ` +
          `received ${JSON.stringify(applied.rows)}`,
      );
    }
    migrationCount = expected.length;

    const triggers = await owner.query(`
      SELECT
        relation.relname AS table_name,
        trigger_row.tgname AS trigger_name,
        trigger_row.tgenabled AS enabled,
        trigger_row.tgtype::int AS trigger_type,
        function_namespace.nspname AS function_schema,
        function_row.proname AS function_name,
        language_row.lanname AS function_language,
        function_row.prorettype = 'trigger'::regtype AS returns_trigger,
        function_row.prosrc AS function_source,
        pg_get_userbyid(function_row.proowner) AS function_owner,
        function_row.prosecdef AS security_definer,
        coalesce(function_row.proconfig, ARRAY[]::text[]) AS function_configuration
      FROM pg_trigger AS trigger_row
      JOIN pg_class AS relation ON relation.oid = trigger_row.tgrelid
      JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      JOIN pg_proc AS function_row ON function_row.oid = trigger_row.tgfoid
      JOIN pg_namespace AS function_namespace
        ON function_namespace.oid = function_row.pronamespace
      JOIN pg_language AS language_row ON language_row.oid = function_row.prolang
      WHERE namespace.nspname = 'public'
        AND NOT trigger_row.tgisinternal
        AND trigger_row.tgname = ANY($1::text[])
      ORDER BY relation.relname, trigger_row.tgname
    `, [expectedAppendOnlyTriggers.map(({ triggerName }) => triggerName)]);
    const appendOnlyTriggers = triggers.rows.map((row) => ({
      tableName: row.table_name,
      triggerName: row.trigger_name,
      enabled: row.enabled,
      triggerType: row.trigger_type,
      functionSchema: row.function_schema,
      functionName: row.function_name,
      functionLanguage: row.function_language,
      returnsTrigger: row.returns_trigger,
      functionSource: row.function_source.replace(/\s+/g, " ").trim(),
      functionOwner: row.function_owner,
      securityDefiner: row.security_definer,
      functionConfiguration: row.function_configuration,
    }));
    const expectedTriggerState = expectedAppendOnlyTriggers.map((expected) => ({
      tableName: expected.tableName,
      triggerName: expected.triggerName,
      enabled: "O",
      triggerType: 27,
      functionSchema: "public",
      functionName: expected.functionName,
      functionLanguage: "plpgsql",
      returnsTrigger: true,
      functionSource: expected.functionSource,
    }));
    const triggerState = appendOnlyTriggers.map(
      ({
        functionOwner: _functionOwner,
        securityDefiner: _securityDefiner,
        functionConfiguration: _functionConfiguration,
        ...trigger
      }) => trigger,
    );
    if (
      JSON.stringify(triggerState) !==
      JSON.stringify(expectedTriggerState)
    ) {
      throw new Error(
        `append-only trigger integrity mismatch: ${JSON.stringify(triggerState)}`,
      );
    }
    const functionSecurity = appendOnlyTriggers.map(
      ({
        functionName,
        functionOwner,
        securityDefiner,
        functionConfiguration,
      }) => ({
        functionName,
        functionOwner,
        securityDefiner,
        functionConfiguration,
      }),
    );
    const expectedFunctionSecurity = expectedAppendOnlyTriggers.map(
      ({ functionName }) => ({
        functionName,
        functionOwner: "ledger_owner",
        securityDefiner: false,
        functionConfiguration: [],
      }),
    );
    if (
      JSON.stringify(functionSecurity) !==
      JSON.stringify(expectedFunctionSecurity)
    ) {
      throw new Error(
        `integrity function security mismatch: ${JSON.stringify(functionSecurity)}`,
      );
    }

    const extension = await owner.query(
      "SELECT extname FROM pg_extension WHERE extname = 'btree_gist'",
    );
    if (JSON.stringify(extension.rows) !== JSON.stringify([{ extname: "btree_gist" }])) {
      throw new Error(`register extension mismatch: ${JSON.stringify(extension.rows)}`);
    }

    const exclusionConstraint = await owner.query(`
      SELECT
        constraint_row.contype = 'x' AS is_exclusion,
        pg_get_constraintdef(constraint_row.oid) AS definition
      FROM pg_constraint AS constraint_row
      WHERE constraint_row.conrelid = 'public.license_assignment'::regclass
        AND constraint_row.conname = 'license_assignment_no_overlap'
    `);
    const exclusion = exclusionConstraint.rows[0];
    const normalizedExclusionDefinition = normalizeSqlDefinition(
      exclusion?.definition ?? "",
    );
    if (
      exclusionConstraint.rows.length !== 1 ||
      !exclusion.is_exclusion ||
      normalizedExclusionDefinition !==
        "excludeusinggist(person_idwith=,vendor_account_idwith=,license_type_idwith=,daterange(started_on,coalesce((ended_on+1),'infinity'),'[)')with&&)"
    ) {
      throw new Error(
        `register exclusion integrity mismatch: ${JSON.stringify(exclusionConstraint.rows)}`,
      );
    }

    const sourceRequestLookupIndex = await owner.query(`
      SELECT
        index_definition.indisunique AS index_is_unique,
        array_agg(attribute.attname::text ORDER BY index_key.ordinality) AS column_names
      FROM pg_class AS index_relation
      JOIN pg_index AS index_definition
        ON index_definition.indexrelid = index_relation.oid
      JOIN LATERAL unnest(index_definition.indkey::smallint[]) WITH ORDINALITY
        AS index_key(attnum, ordinality) ON true
      JOIN pg_attribute AS attribute
        ON attribute.attrelid = index_definition.indrelid
        AND attribute.attnum = index_key.attnum
      WHERE index_definition.indrelid = 'public.license_assignment'::regclass
        AND index_relation.relname = 'idx_license_assignment_source_request_id'
      GROUP BY
        index_relation.oid,
        index_definition.indisunique
    `);
    const sourceRequestIndex = sourceRequestLookupIndex.rows[0];
    if (
      sourceRequestLookupIndex.rows.length !== 1 ||
      sourceRequestIndex.index_is_unique ||
      JSON.stringify(sourceRequestIndex.column_names) !==
        JSON.stringify(["source_request_id"])
    ) {
      throw new Error(
        `source-request lookup index integrity mismatch: ${JSON.stringify(sourceRequestLookupIndex.rows)}`,
      );
    }

    const contiguityTrigger = await owner.query(`
      SELECT
        trigger_row.tgenabled AS enabled,
        trigger_row.tgdeferrable AS deferrable,
        trigger_row.tginitdeferred AS initially_deferred,
        trigger_row.tgtype::int AS trigger_type,
        ARRAY(
          SELECT attribute.attname::text
          FROM unnest(trigger_row.tgattr::smallint[]) WITH ORDINALITY
            AS trigger_attribute(attnum, ordinality)
          JOIN pg_attribute AS attribute
            ON attribute.attrelid = trigger_row.tgrelid
            AND attribute.attnum = trigger_attribute.attnum
          ORDER BY trigger_attribute.ordinality
        ) AS update_columns,
        pg_get_triggerdef(trigger_row.oid) AS definition,
        function_row.proname AS function_name,
        function_row.prosrc AS function_source,
        pg_get_userbyid(function_row.proowner) AS function_owner,
        function_row.prosecdef AS security_definer,
        coalesce(function_row.proconfig, ARRAY[]::text[]) AS function_configuration
      FROM pg_trigger AS trigger_row
      JOIN pg_proc AS function_row ON function_row.oid = trigger_row.tgfoid
      WHERE trigger_row.tgrelid = 'public.license_assignment'::regclass
        AND trigger_row.tgname = 'license_assignment_reallocation_contiguous'
        AND NOT trigger_row.tgisinternal
    `);
    const contiguity = contiguityTrigger.rows[0];
    if (
      contiguityTrigger.rows.length !== 1 ||
      contiguity.enabled !== "O" ||
      !contiguity.deferrable ||
      !contiguity.initially_deferred ||
      contiguity.trigger_type !== 21 ||
      JSON.stringify(contiguity.update_columns) !==
        JSON.stringify(["ended_on", "end_reason"]) ||
      !contiguity.definition.includes("ON public.license_assignment") ||
      !contiguity.definition.includes("EXECUTE FUNCTION license_assignment_reallocation_contiguous()") ||
      contiguity.function_name !== "license_assignment_reallocation_contiguous" ||
      normalizeSqlDefinition(contiguity.function_source) !==
        expectedContiguityFunctionSource ||
      contiguity.function_owner !== "ledger_owner" ||
      contiguity.security_definer ||
      JSON.stringify(contiguity.function_configuration) !==
        JSON.stringify(["search_path=pg_catalog, public"])
    ) {
      throw new Error(
        `reallocation trigger integrity mismatch: ${JSON.stringify(contiguityTrigger.rows)}`,
      );
    }

    const roleRevocationFunction = await owner.query(`
      SELECT
        function_row.prosecdef AS security_definer,
        function_row.prosrc AS function_source,
        pg_get_function_arguments(function_row.oid) AS function_arguments,
        pg_get_userbyid(function_row.proowner) AS function_owner,
        coalesce(function_row.proconfig, ARRAY[]::text[]) AS function_configuration,
        ARRAY(
          SELECT concat(
            CASE
              WHEN function_acl.grantee = 0 THEN 'PUBLIC'
              ELSE pg_get_userbyid(function_acl.grantee)
            END,
            ':',
            function_acl.privilege_type,
            ':',
            function_acl.is_grantable::text
          )
          FROM aclexplode(coalesce(function_row.proacl, acldefault('f', function_row.proowner)))
            AS function_acl(grantor, grantee, privilege_type, is_grantable)
          ORDER BY 1
        ) AS function_acl
      FROM pg_proc AS function_row
      JOIN pg_namespace AS namespace ON namespace.oid = function_row.pronamespace
      WHERE namespace.nspname = 'public'
        AND function_row.proname = 'revoke_company_role_assignment'
    `);
    const revocation = roleRevocationFunction.rows[0];
    if (
      roleRevocationFunction.rows.length !== 1 ||
      revocation.function_arguments !==
        'p_assignment_id uuid, p_company_id uuid, p_actor_user_id uuid, p_note text' ||
      !revocation.security_definer ||
      revocation.function_owner !== 'ledger_owner' ||
      JSON.stringify(revocation.function_configuration) !==
        JSON.stringify(['search_path=pg_catalog, public']) ||
      JSON.stringify(revocation.function_acl) !==
        JSON.stringify([
          'ledger_app:EXECUTE:false',
          'ledger_owner:EXECUTE:false',
        ]) ||
      normalizeSqlDefinition(revocation.function_source) !==
        expectedRoleRevocationFunctionSource
    ) {
      throw new Error(
        `role-revocation function integrity mismatch: ${JSON.stringify(roleRevocationFunction.rows)}`,
      );
    }

    const partialIndex = await owner.query(`
      SELECT
        index_definition.indisunique AS is_unique,
        pg_get_expr(index_definition.indpred, index_definition.indrelid) AS predicate,
        ARRAY(
          SELECT attribute.attname::text
          FROM unnest(index_definition.indkey::smallint[]) WITH ORDINALITY
            AS index_key(attnum, ordinality)
          JOIN pg_attribute AS attribute
            ON attribute.attrelid = index_definition.indrelid
            AND attribute.attnum = index_key.attnum
          ORDER BY index_key.ordinality
        ) AS indexed_columns
      FROM pg_index AS index_definition
      JOIN pg_class AS index_relation ON index_relation.oid = index_definition.indexrelid
      WHERE index_definition.indrelid = 'public.reclamation_proposal'::regclass
        AND index_relation.relname = 'reclamation_proposal_one_pending_per_assignment'
    `);
    const proposalIndex = partialIndex.rows[0];
    if (
      partialIndex.rows.length !== 1 ||
      !proposalIndex.is_unique ||
      JSON.stringify(proposalIndex.indexed_columns) !== JSON.stringify(["assignment_id"]) ||
      normalizeSqlDefinition(proposalIndex.predicate ?? "") !== "(status='pending')"
    ) {
      throw new Error(
        `reclamation pending-index integrity mismatch: ${JSON.stringify(partialIndex.rows)}`,
      );
    }

    const pendingRemoveIndex = await owner.query(`
      SELECT
        index_relation.relname AS index_name,
        table_relation.relname AS table_name,
        index_state.indisunique AS is_unique,
        index_state.indisvalid AS is_valid,
        index_state.indisready AS is_ready,
        index_state.indimmediate AS is_immediate,
        index_state.indnkeyatts AS key_count,
        index_state.indnatts AS attribute_count,
        access_method.amname AS access_method,
        ARRAY(
          SELECT pg_get_indexdef(
            index_state.indexrelid,
            key_position,
            true
          )
          FROM generate_series(
            1,
            index_state.indnkeyatts
          ) AS key_position
        ) AS key_expressions,
        pg_get_expr(
          index_state.indpred,
          index_state.indrelid,
          true
        ) AS predicate,
        constraint_row.contype AS constraint_type,
        constraint_row.condeferrable AS constraint_deferrable,
        constraint_row.condeferred AS constraint_initially_deferred
      FROM pg_index AS index_state
      JOIN pg_class AS index_relation
        ON index_relation.oid = index_state.indexrelid
      JOIN pg_namespace AS index_namespace
        ON index_namespace.oid = index_relation.relnamespace
      JOIN pg_class AS table_relation
        ON table_relation.oid = index_state.indrelid
      JOIN pg_namespace AS table_namespace
        ON table_namespace.oid = table_relation.relnamespace
      JOIN pg_am AS access_method
        ON access_method.oid = index_relation.relam
      LEFT JOIN pg_constraint AS constraint_row
        ON constraint_row.conindid = index_state.indexrelid
      WHERE index_namespace.nspname = 'public'
        AND table_namespace.nspname = 'public'
        AND index_relation.relname =
          'uq_provisioning_action_pending_remove_request'
    `);
    const pendingRemove = pendingRemoveIndex.rows[0];
    if (
      pendingRemoveIndex.rows.length !== 1 ||
      pendingRemove.index_name !==
        "uq_provisioning_action_pending_remove_request" ||
      pendingRemove.table_name !== "provisioning_action" ||
      !pendingRemove.is_unique ||
      !pendingRemove.is_valid ||
      !pendingRemove.is_ready ||
      !pendingRemove.is_immediate ||
      pendingRemove.key_count !== 1 ||
      pendingRemove.attribute_count !== 1 ||
      pendingRemove.access_method !== "btree" ||
      JSON.stringify(pendingRemove.key_expressions) !==
        JSON.stringify(["request_id"]) ||
      normalizeSqlDefinition(pendingRemove.predicate ?? "") !==
        "kind='remove'andstatus='pending'" ||
      pendingRemove.constraint_type !== null ||
      pendingRemove.constraint_deferrable !== null ||
      pendingRemove.constraint_initially_deferred !== null
    ) {
      throw new Error(
        `pending-remove index integrity mismatch: ${JSON.stringify(pendingRemoveIndex.rows)}`,
      );
    }

    const orchestrationChecklistIndex = await owner.query(`
      SELECT
        index_state.indisunique AS is_unique,
        index_state.indisvalid AS is_valid,
        index_state.indisready AS is_ready,
        index_state.indnkeyatts AS key_count,
        index_state.indnatts AS attribute_count,
        ARRAY(
          SELECT pg_get_indexdef(index_state.indexrelid, key_position, true)
          FROM generate_series(1, index_state.indnkeyatts) AS key_position
          ORDER BY key_position
        ) AS key_expressions,
        pg_get_expr(index_state.indpred, index_state.indrelid, true) AS predicate,
        to_regclass(
          'public.uq_provisioning_action_orchestration_checklist_request'
        )::text AS legacy_index
      FROM pg_index AS index_state
      JOIN pg_class AS index_relation
        ON index_relation.oid = index_state.indexrelid
      JOIN pg_namespace AS index_namespace
        ON index_namespace.oid = index_relation.relnamespace
      WHERE index_namespace.nspname = 'public'
        AND index_relation.relname =
          'uq_provisioning_action_orchestration_checklist_operation'
    `);
    const orchestrationChecklist = orchestrationChecklistIndex.rows[0];
    if (
      orchestrationChecklistIndex.rows.length !== 1 ||
      !orchestrationChecklist.is_unique ||
      !orchestrationChecklist.is_valid ||
      !orchestrationChecklist.is_ready ||
      orchestrationChecklist.key_count !== 2 ||
      orchestrationChecklist.attribute_count !== 2 ||
      JSON.stringify(
        orchestrationChecklist.key_expressions.map(normalizeSqlDefinition),
      ) !==
        JSON.stringify(["request_id", "(raw_request->>'operation')"]) ||
      normalizeSqlDefinition(orchestrationChecklist.predicate ?? "")
        .replaceAll("(", "")
        .replaceAll(")", "") !==
        "kind='checklist'andmode='orchestration'andraw_request->>'operation'=anyarray['provision','deprovision']" ||
      orchestrationChecklist.legacy_index !== null
    ) {
      throw new Error(
        `orchestration-checklist index integrity mismatch: ${JSON.stringify(orchestrationChecklistIndex.rows)}`,
      );
    }

    const requestIdempotencyColumn = await owner.query(`
      SELECT
        data_type,
        is_nullable,
        column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'license_request'
        AND column_name = 'client_request_id'
    `);
    const requestIdempotencyIndex = await owner.query(`
      SELECT
        index_relation.relname AS index_name,
        table_relation.relname AS table_name,
        index_state.indisunique AS is_unique,
        index_state.indisvalid AS is_valid,
        index_state.indisready AS is_ready,
        index_state.indimmediate AS is_immediate,
        index_state.indnkeyatts AS key_count,
        index_state.indnatts AS attribute_count,
        access_method.amname AS access_method,
        ARRAY(
          SELECT pg_get_indexdef(
            index_state.indexrelid,
            key_position,
            true
          )
          FROM generate_series(
            1,
            index_state.indnkeyatts
          ) AS key_position
        ) AS key_expressions,
        pg_get_expr(
          index_state.indpred,
          index_state.indrelid,
          true
        ) AS predicate,
        constraint_row.contype AS constraint_type,
        constraint_row.condeferrable AS constraint_deferrable,
        constraint_row.condeferred AS constraint_initially_deferred
      FROM pg_index AS index_state
      JOIN pg_class AS index_relation
        ON index_relation.oid = index_state.indexrelid
      JOIN pg_class AS table_relation
        ON table_relation.oid = index_state.indrelid
      JOIN pg_namespace AS table_namespace
        ON table_namespace.oid = table_relation.relnamespace
      JOIN pg_am AS access_method
        ON access_method.oid = index_relation.relam
      LEFT JOIN pg_constraint AS constraint_row
        ON constraint_row.conindid = index_state.indexrelid
      WHERE table_namespace.nspname = 'public'
        AND index_relation.relname =
          'uq_license_request_requester_client_request'
    `);
    const requestIdempotency = requestIdempotencyIndex.rows[0];
    if (
      requestIdempotencyColumn.rows.length !== 1 ||
      requestIdempotencyColumn.rows[0].data_type !== "uuid" ||
      requestIdempotencyColumn.rows[0].is_nullable !== "NO" ||
      requestIdempotencyColumn.rows[0].column_default !== "gen_random_uuid()" ||
      requestIdempotencyIndex.rows.length !== 1 ||
      requestIdempotency.index_name !==
        "uq_license_request_requester_client_request" ||
      requestIdempotency.table_name !== "license_request" ||
      !requestIdempotency.is_unique ||
      !requestIdempotency.is_valid ||
      !requestIdempotency.is_ready ||
      !requestIdempotency.is_immediate ||
      requestIdempotency.key_count !== 2 ||
      requestIdempotency.attribute_count !== 2 ||
      requestIdempotency.access_method !== "btree" ||
      JSON.stringify(requestIdempotency.key_expressions) !==
        JSON.stringify(["requested_by", "client_request_id"]) ||
      requestIdempotency.predicate !== null ||
      requestIdempotency.constraint_type !== "u" ||
      requestIdempotency.constraint_deferrable !== false ||
      requestIdempotency.constraint_initially_deferred !== false
    ) {
      throw new Error(
        "request-idempotency integrity mismatch: " +
          JSON.stringify({
            column: requestIdempotencyColumn.rows,
            index: requestIdempotencyIndex.rows,
          }),
      );
    }

    const alertDeliveryIndexes = await owner.query(`
      SELECT
        index_relation.relname AS index_name,
        index_state.indisunique AS is_unique,
        ARRAY(
          SELECT pg_get_indexdef(index_state.indexrelid, position, true)
          FROM generate_series(1, index_state.indnkeyatts) AS position
        ) AS key_expressions,
        pg_get_expr(index_state.indpred, index_state.indrelid, true) AS predicate
      FROM pg_index AS index_state
      JOIN pg_class AS index_relation
        ON index_relation.oid = index_state.indexrelid
      WHERE index_state.indrelid IN (
          'public.alert_rule'::regclass,
          'public.alert_notification_delivery'::regclass
        )
        AND index_relation.relname IN (
          'uq_alert_rule_global_type',
          'idx_alert_notification_delivery_claim_fence',
          'uq_alert_notification_delivery_attempt_phase',
          'uq_alert_notification_delivery_succeeded'
        )
      ORDER BY index_relation.relname
    `);
    if (
      JSON.stringify(alertDeliveryIndexes.rows) !==
      JSON.stringify([
        {
          index_name: "idx_alert_notification_delivery_claim_fence",
          is_unique: false,
          key_expressions: [
            "alert_event_id",
            "recipient_key",
            "attempt",
            "claim_token",
          ],
          predicate: null,
        },
        {
          index_name: "uq_alert_notification_delivery_attempt_phase",
          is_unique: true,
          key_expressions: [
            "alert_event_id",
            "recipient_key",
            "attempt",
            "phase",
          ],
          predicate: null,
        },
        {
          index_name: "uq_alert_notification_delivery_succeeded",
          is_unique: true,
          key_expressions: ["alert_event_id", "recipient_key"],
          predicate:
            "phase = 'succeeded'::alert_notification_delivery_phase_enum",
        },
        {
          index_name: "uq_alert_rule_global_type",
          is_unique: true,
          key_expressions: ["type"],
          predicate:
            "scope_kind = 'global'::alert_rule_scope_kind_enum",
        },
      ])
    ) {
      throw new Error(
        `alert delivery/seed index integrity mismatch: ${JSON.stringify(alertDeliveryIndexes.rows)}`,
      );
    }

    const alertDeliveryClaimFenceConstraint = await owner.query(`
      SELECT
        constraint_row.contype AS constraint_type,
        constraint_row.convalidated AS validated,
        pg_get_constraintdef(constraint_row.oid, true) AS definition
      FROM pg_constraint AS constraint_row
      WHERE constraint_row.conrelid =
          'public.alert_notification_delivery'::regclass
        AND constraint_row.conname =
          'ck_alert_notification_delivery_claim_fence'
    `);
    if (
      alertDeliveryClaimFenceConstraint.rows.length !== 1 ||
      alertDeliveryClaimFenceConstraint.rows[0].constraint_type !== "c" ||
      !alertDeliveryClaimFenceConstraint.rows[0].validated ||
      normalizeSqlDefinition(
        alertDeliveryClaimFenceConstraint.rows[0].definition,
      ) !==
        "check(phase='pending'andclaim_tokenisnullor(phase=any(array['claimed','succeeded','failed']))andclaim_tokenisnotnull)"
    ) {
      throw new Error(
        `alert delivery claim-fence constraint mismatch: ${JSON.stringify(alertDeliveryClaimFenceConstraint.rows)}`,
      );
    }

    const alertDeliveryRecipientConstraint = await owner.query(`
      SELECT
        constraint_row.contype AS constraint_type,
        constraint_row.convalidated AS validated,
        pg_get_constraintdef(constraint_row.oid, true) AS definition
      FROM pg_constraint AS constraint_row
      WHERE constraint_row.conrelid =
          'public.alert_notification_delivery'::regclass
        AND constraint_row.conname =
          'ck_alert_notification_delivery_recipient'
    `);
    if (
      alertDeliveryRecipientConstraint.rows.length !== 1 ||
      alertDeliveryRecipientConstraint.rows[0].constraint_type !== "c" ||
      !alertDeliveryRecipientConstraint.rows[0].validated ||
      normalizeSqlDefinition(
        alertDeliveryRecipientConstraint.rows[0].definition,
      ) !==
        "check(btrim(recipient_key)<>''and(phase<>'pending'orrecipient_emailisnullorbtrim(recipient_email)<>''))"
    ) {
      throw new Error(
        "recipient alert delivery constraint integrity mismatch: " +
          JSON.stringify(alertDeliveryRecipientConstraint.rows),
      );
    }

    const alertDeliveryFunctions = await owner.query(`
      SELECT
        function_row.proname AS function_name,
        pg_get_function_identity_arguments(function_row.oid)
          AS identity_arguments,
        pg_get_userbyid(function_row.proowner) AS function_owner,
        function_row.prosecdef AS security_definer,
        coalesce(function_row.proconfig, ARRAY[]::text[])
          AS function_configuration,
        EXISTS (
          SELECT 1
          FROM aclexplode(coalesce(
            function_row.proacl,
            acldefault('f', function_row.proowner)
          )) direct_acl
          WHERE direct_acl.grantee = (SELECT oid FROM pg_roles WHERE rolname='ledger_app')
            AND direct_acl.privilege_type = 'EXECUTE'
        ) AS app_can_execute,
        EXISTS (
          SELECT 1
          FROM aclexplode(coalesce(
            function_row.proacl,
            acldefault('f', function_row.proowner)
          )) direct_acl
          WHERE direct_acl.grantee = 0
            AND direct_acl.privilege_type = 'EXECUTE'
        ) AS public_can_execute,
        ARRAY(
          SELECT concat(
            CASE
              WHEN function_acl.grantee = 0 THEN 'PUBLIC'
              ELSE pg_get_userbyid(function_acl.grantee)
            END,
            ':',
            function_acl.privilege_type,
            ':',
            function_acl.is_grantable::text
          )
          FROM aclexplode(coalesce(
            function_row.proacl,
            acldefault('f', function_row.proowner)
          )) AS function_acl(
            grantor, grantee, privilege_type, is_grantable
          )
          ORDER BY 1
        ) AS function_acl,
        CASE function_row.proname
          WHEN 'append_alert_delivery_pending' THEN
            position('pg_advisory_xact_lock' in function_row.prosrc) > 0
            AND position('INSERT INTO public.alert_notification_delivery'
              in function_row.prosrc) > 0
          WHEN 'claim_alert_delivery' THEN
            position('pg_advisory_xact_lock' in function_row.prosrc) > 0
            AND position('gen_random_uuid' in function_row.prosrc) > 0
            AND position('INSERT INTO public.alert_notification_delivery'
              in function_row.prosrc) > 0
          WHEN 'complete_alert_delivery' THEN
            position('pg_advisory_xact_lock' in function_row.prosrc) > 0
            AND position('INSERT INTO public.alert_notification_delivery'
              in function_row.prosrc) > 0
        END AS body_guard_present
      FROM pg_proc AS function_row
      JOIN pg_namespace AS namespace
        ON namespace.oid = function_row.pronamespace
      WHERE namespace.nspname = 'public'
        AND function_row.proname IN (
          'append_alert_delivery_pending',
          'claim_alert_delivery',
          'complete_alert_delivery'
        )
      ORDER BY function_row.proname
    `);
    if (
      JSON.stringify(alertDeliveryFunctions.rows) !==
      JSON.stringify([
        {
          function_name: "append_alert_delivery_pending",
          identity_arguments:
            "p_alert_event_id uuid, p_occurred_at timestamp with time zone",
          function_owner: "ledger_owner",
          security_definer: true,
          function_configuration: ["search_path=pg_catalog, public"],
          app_can_execute: true,
          public_can_execute: false,
          function_acl: [
            "ledger_app:EXECUTE:false",
            "ledger_owner:EXECUTE:false",
          ],
          body_guard_present: true,
        },
        {
          function_name: "claim_alert_delivery",
          identity_arguments:
            "p_alert_event_id uuid, p_occurred_at timestamp with time zone, p_lease_expires_at timestamp with time zone, p_worker_id text",
          function_owner: "ledger_owner",
          security_definer: true,
          function_configuration: ["search_path=pg_catalog, public"],
          app_can_execute: true,
          public_can_execute: false,
          function_acl: [
            "ledger_app:EXECUTE:false",
            "ledger_owner:EXECUTE:false",
          ],
          body_guard_present: true,
        },
        {
          function_name: "complete_alert_delivery",
          identity_arguments:
            "p_alert_event_id uuid, p_attempt integer, p_claim_token uuid, p_occurred_at timestamp with time zone, p_phase alert_notification_delivery_phase_enum, p_provider_message_id text, p_accepted jsonb, p_error_code text",
          function_owner: "ledger_owner",
          security_definer: true,
          function_configuration: ["search_path=pg_catalog, public"],
          app_can_execute: true,
          public_can_execute: false,
          function_acl: [
            "ledger_app:EXECUTE:false",
            "ledger_owner:EXECUTE:false",
          ],
          body_guard_present: true,
        },
      ])
    ) {
      throw new Error(
        `alert delivery function integrity mismatch: ${JSON.stringify(alertDeliveryFunctions.rows)}`,
      );
    }

    const recipientAlertDeliveryFunctions = await owner.query(`
      SELECT
        function_row.proname AS function_name,
        pg_get_function_identity_arguments(function_row.oid)
          AS identity_arguments,
        pg_get_userbyid(function_row.proowner) AS function_owner,
        function_row.prosecdef AS security_definer,
        coalesce(function_row.proconfig, ARRAY[]::text[])
          AS function_configuration,
        EXISTS (
          SELECT 1
          FROM aclexplode(coalesce(
            function_row.proacl,
            acldefault('f', function_row.proowner)
          )) direct_acl
          WHERE direct_acl.grantee =
              (SELECT oid FROM pg_roles WHERE rolname = 'ledger_app')
            AND direct_acl.privilege_type = 'EXECUTE'
        ) AS app_can_execute,
        EXISTS (
          SELECT 1
          FROM aclexplode(coalesce(
            function_row.proacl,
            acldefault('f', function_row.proowner)
          )) direct_acl
          WHERE direct_acl.grantee = 0
            AND direct_acl.privilege_type = 'EXECUTE'
        ) AS public_can_execute,
        ARRAY(
          SELECT concat(
            CASE
              WHEN function_acl.grantee = 0 THEN 'PUBLIC'
              ELSE pg_get_userbyid(function_acl.grantee)
            END,
            ':',
            function_acl.privilege_type,
            ':',
            function_acl.is_grantable::text
          )
          FROM aclexplode(coalesce(
            function_row.proacl,
            acldefault('f', function_row.proowner)
          )) AS function_acl(
            grantor, grantee, privilege_type, is_grantable
          )
          ORDER BY 1
        ) AS function_acl,
        CASE function_row.proname
          WHEN 'append_alert_recipient_pending' THEN
            position('p_recipient_key' in function_row.prosrc) > 0
            AND position('pg_advisory_xact_lock'
              in function_row.prosrc) > 0
            AND position('recipient_user_account_id'
              in function_row.prosrc) > 0
            AND position('recipient_email' in function_row.prosrc) > 0
            AND position('recipient_locale' in function_row.prosrc) > 0
            AND position(
              'alert_event_id, recipient_key, recipient_user_account_id'
              in function_row.prosrc
            ) > 0
            AND position('INSERT INTO public.alert_notification_delivery'
              in function_row.prosrc) > 0
          WHEN 'claim_alert_recipient_delivery' THEN
            position('p_lease_expires_at <= p_occurred_at'
              in function_row.prosrc) > 0
            AND position('btrim(p_recipient_key)' in function_row.prosrc) > 0
            AND position('pg_advisory_xact_lock'
              in function_row.prosrc) > 0
            AND position('delivery.recipient_key = p_recipient_key'
              in function_row.prosrc) > 0
            AND position('gen_random_uuid' in function_row.prosrc) > 0
            AND position(
              'alert_event_id, recipient_key, attempt, phase'
              in function_row.prosrc
            ) > 0
            AND position('INSERT INTO public.alert_notification_delivery'
              in function_row.prosrc) > 0
          WHEN 'complete_alert_recipient_delivery' THEN
            position('p_phase NOT IN' in function_row.prosrc) > 0
            AND position('p_recipient_key' in function_row.prosrc) > 0
            AND position('pg_advisory_xact_lock'
              in function_row.prosrc) > 0
            AND position(
              'alert_event_id, recipient_key, attempt, phase'
              in function_row.prosrc
            ) > 0
            AND position('INSERT INTO public.alert_notification_delivery'
              in function_row.prosrc) > 0
        END AS body_guard_present
      FROM pg_proc AS function_row
      JOIN pg_namespace AS namespace
        ON namespace.oid = function_row.pronamespace
      WHERE namespace.nspname = 'public'
        AND function_row.proname IN (
          'append_alert_recipient_pending',
          'claim_alert_recipient_delivery',
          'complete_alert_recipient_delivery'
        )
      ORDER BY function_row.proname
    `);
    if (
      JSON.stringify(recipientAlertDeliveryFunctions.rows) !==
      JSON.stringify([
        {
          function_name: "append_alert_recipient_pending",
          identity_arguments:
            "p_alert_event_id uuid, p_recipient_key text, p_recipient_user_account_id uuid, p_recipient_email text, p_recipient_locale user_account_ui_language_enum, p_occurred_at timestamp with time zone",
          function_owner: "ledger_owner",
          security_definer: true,
          function_configuration: ["search_path=pg_catalog, public"],
          app_can_execute: true,
          public_can_execute: false,
          function_acl: [
            "ledger_app:EXECUTE:false",
            "ledger_owner:EXECUTE:false",
          ],
          body_guard_present: true,
        },
        {
          function_name: "claim_alert_recipient_delivery",
          identity_arguments:
            "p_alert_event_id uuid, p_recipient_key text, p_occurred_at timestamp with time zone, p_lease_expires_at timestamp with time zone, p_worker_id text",
          function_owner: "ledger_owner",
          security_definer: true,
          function_configuration: ["search_path=pg_catalog, public"],
          app_can_execute: true,
          public_can_execute: false,
          function_acl: [
            "ledger_app:EXECUTE:false",
            "ledger_owner:EXECUTE:false",
          ],
          body_guard_present: true,
        },
        {
          function_name: "complete_alert_recipient_delivery",
          identity_arguments:
            "p_alert_event_id uuid, p_recipient_key text, p_attempt integer, p_claim_token uuid, p_occurred_at timestamp with time zone, p_phase alert_notification_delivery_phase_enum, p_provider_message_id text, p_accepted jsonb, p_error_code text",
          function_owner: "ledger_owner",
          security_definer: true,
          function_configuration: ["search_path=pg_catalog, public"],
          app_can_execute: true,
          public_can_execute: false,
          function_acl: [
            "ledger_app:EXECUTE:false",
            "ledger_owner:EXECUTE:false",
          ],
          body_guard_present: true,
        },
      ])
    ) {
      throw new Error(
        "recipient alert delivery function integrity mismatch: " +
          JSON.stringify(recipientAlertDeliveryFunctions.rows),
      );
    }

    const lifecycleDeliveryFunctions = await owner.query(`
      SELECT
        function_row.proname AS function_name,
        pg_get_function_identity_arguments(function_row.oid)
          AS identity_arguments,
        pg_get_userbyid(function_row.proowner) AS function_owner,
        function_row.prosecdef AS security_definer,
        coalesce(function_row.proconfig, ARRAY[]::text[])
          AS function_configuration,
        EXISTS (
          SELECT 1
          FROM aclexplode(coalesce(
            function_row.proacl,
            acldefault('f', function_row.proowner)
          )) direct_acl
          WHERE direct_acl.grantee = (SELECT oid FROM pg_roles WHERE rolname='ledger_app')
            AND direct_acl.privilege_type = 'EXECUTE'
        ) AS app_can_execute,
        EXISTS (
          SELECT 1
          FROM aclexplode(coalesce(
            function_row.proacl,
            acldefault('f', function_row.proowner)
          )) direct_acl
          WHERE direct_acl.grantee = 0
            AND direct_acl.privilege_type = 'EXECUTE'
        ) AS public_can_execute,
        ARRAY(
          SELECT concat(
            CASE
              WHEN function_acl.grantee = 0 THEN 'PUBLIC'
              ELSE pg_get_userbyid(function_acl.grantee)
            END,
            ':',
            function_acl.privilege_type,
            ':',
            function_acl.is_grantable::text
          )
          FROM aclexplode(coalesce(
            function_row.proacl,
            acldefault('f', function_row.proowner)
          )) AS function_acl(
            grantor, grantee, privilege_type, is_grantable
          )
          ORDER BY 1
        ) AS function_acl,
        CASE function_row.proname
          WHEN 'initialize_lifecycle_notification_delivery' THEN
            position('INSERT INTO public.lifecycle_notification_delivery'
              in function_row.prosrc) > 0
          WHEN 'claim_lifecycle_notification' THEN
            position('pg_advisory_xact_lock' in function_row.prosrc) > 0
            AND position('gen_random_uuid' in function_row.prosrc) > 0
            AND position('lease_expires_at > p_occurred_at'
              in function_row.prosrc) > 0
            AND position('INSERT INTO public.lifecycle_notification_delivery'
              in function_row.prosrc) > 0
          WHEN 'complete_lifecycle_notification' THEN
            position('pg_advisory_xact_lock' in function_row.prosrc) > 0
            AND position('delivery.claim_token = p_claim_token'
              in function_row.prosrc) > 0
            AND position('claim.lease_expires_at <= p_occurred_at'
              in function_row.prosrc) > 0
            AND position('INSERT INTO public.lifecycle_notification_delivery'
              in function_row.prosrc) > 0
        END AS body_guard_present
      FROM pg_proc AS function_row
      JOIN pg_namespace AS namespace
        ON namespace.oid = function_row.pronamespace
      WHERE namespace.nspname = 'public'
        AND function_row.proname IN (
          'initialize_lifecycle_notification_delivery',
          'claim_lifecycle_notification',
          'complete_lifecycle_notification'
        )
      ORDER BY function_row.proname
    `);
    if (
      JSON.stringify(lifecycleDeliveryFunctions.rows) !==
      JSON.stringify([
        {
          function_name: "claim_lifecycle_notification",
          identity_arguments:
            "p_notification_id uuid, p_occurred_at timestamp with time zone, p_lease_expires_at timestamp with time zone, p_worker_id text",
          function_owner: "ledger_owner",
          security_definer: true,
          function_configuration: ["search_path=pg_catalog, public"],
          app_can_execute: true,
          public_can_execute: false,
          function_acl: [
            "ledger_app:EXECUTE:false",
            "ledger_owner:EXECUTE:false",
          ],
          body_guard_present: true,
        },
        {
          function_name: "complete_lifecycle_notification",
          identity_arguments:
            "p_notification_id uuid, p_attempt integer, p_claim_token uuid, p_occurred_at timestamp with time zone, p_phase alert_notification_delivery_phase_enum, p_provider_message_id text, p_accepted jsonb, p_error_code text",
          function_owner: "ledger_owner",
          security_definer: true,
          function_configuration: ["search_path=pg_catalog, public"],
          app_can_execute: true,
          public_can_execute: false,
          function_acl: [
            "ledger_app:EXECUTE:false",
            "ledger_owner:EXECUTE:false",
          ],
          body_guard_present: true,
        },
        {
          function_name: "initialize_lifecycle_notification_delivery",
          identity_arguments: "",
          function_owner: "ledger_owner",
          security_definer: true,
          function_configuration: ["search_path=pg_catalog, public"],
          app_can_execute: false,
          public_can_execute: false,
          function_acl: ["ledger_owner:EXECUTE:false"],
          body_guard_present: true,
        },
      ])
    ) {
      throw new Error(
        "lifecycle notification function integrity mismatch: " +
          JSON.stringify(lifecycleDeliveryFunctions.rows),
      );
    }

    const alertDeliveryInsertTrigger = await owner.query(`
      SELECT
        trigger_row.tgenabled AS enabled,
        trigger_row.tgtype::int AS trigger_type,
        function_row.proname AS function_name,
        pg_get_userbyid(function_row.proowner) AS function_owner,
        function_row.prosecdef AS security_definer,
        coalesce(function_row.proconfig, ARRAY[]::text[])
          AS function_configuration,
        ARRAY(
          SELECT concat(
            CASE
              WHEN function_acl.grantee = 0 THEN 'PUBLIC'
              ELSE pg_get_userbyid(function_acl.grantee)
            END,
            ':',
            function_acl.privilege_type,
            ':',
            function_acl.is_grantable::text
          )
          FROM aclexplode(coalesce(
            function_row.proacl,
            acldefault('f', function_row.proowner)
          )) AS function_acl(
            grantor, grantee, privilege_type, is_grantable
          )
          ORDER BY 1
        ) AS function_acl,
        position('matching_claim.lease_expires_at <= NEW.occurred_at'
          in function_row.prosrc) > 0
          AND position('delivery.claim_token = NEW.claim_token'
            in function_row.prosrc) > 0 AS body_guard_present
      FROM pg_trigger AS trigger_row
      JOIN pg_proc AS function_row ON function_row.oid = trigger_row.tgfoid
      WHERE trigger_row.tgrelid =
          'public.alert_notification_delivery'::regclass
        AND trigger_row.tgname =
          'trg_alert_notification_delivery_validate_insert'
        AND NOT trigger_row.tgisinternal
    `);
    if (
      JSON.stringify(alertDeliveryInsertTrigger.rows) !==
      JSON.stringify([
        {
          enabled: "O",
          trigger_type: 7,
          function_name: "validate_alert_delivery_insert",
          function_owner: "ledger_owner",
          security_definer: false,
          function_configuration: ["search_path=pg_catalog, public"],
          function_acl: ["ledger_owner:EXECUTE:false"],
          body_guard_present: true,
        },
      ])
    ) {
      throw new Error(
        `alert delivery transition trigger mismatch: ${JSON.stringify(alertDeliveryInsertTrigger.rows)}`,
      );
    }

    const systemDefaults = await owner.query(`
      SELECT
        setting.key,
        setting.value::text AS value,
        setting.updated_by::text AS updated_by,
        actor.id::text AS actor_id,
        actor.email,
        actor.status,
        actor.idp_subject
      FROM system_setting AS setting
      JOIN user_account AS actor ON actor.id = setting.updated_by
      WHERE setting.key IN (
        'notif_sender_email',
        'notif_escalation_email',
        'default_language'
      )
      ORDER BY setting.key
    `);
    if (
      JSON.stringify(systemDefaults.rows) !==
      JSON.stringify([
        {
          key: "default_language",
          value: '"es"',
          updated_by: systemUserId,
          actor_id: systemUserId,
          email: "system@ledger.invalid",
          status: "disabled",
          idp_subject: null,
        },
        {
          key: "notif_escalation_email",
          value: '"admin@corporativo.ec"',
          updated_by: systemUserId,
          actor_id: systemUserId,
          email: "system@ledger.invalid",
          status: "disabled",
          idp_subject: null,
        },
        {
          key: "notif_sender_email",
          value: '"ledger@corporativo.ec"',
          updated_by: systemUserId,
          actor_id: systemUserId,
          email: "system@ledger.invalid",
          status: "disabled",
          idp_subject: null,
        },
      ])
    ) {
      throw new Error(
        `system-default integrity mismatch: ${JSON.stringify(systemDefaults.rows)}`,
      );
    }

    const globalAlertDefaults = await owner.query(`
      SELECT
        type::text AS type,
        threshold,
        channel::text AS channel,
        enabled
      FROM alert_rule
      WHERE scope_kind = 'global'
      ORDER BY type
    `);
    if (
      JSON.stringify(globalAlertDefaults.rows) !==
      JSON.stringify([
        { type: "approval_aging", threshold: { hours: 24, escalationHours: 48 }, channel: "email", enabled: true },
        { type: "blocked_no_seat", threshold: { businessDays: 1 }, channel: "email", enabled: true },
        { type: "close_missed", threshold: { businessDays: 3 }, channel: "email", enabled: true },
        { type: "credential_failure", threshold: { failures: 1 }, channel: "email", enabled: true },
        { type: "deprovision_overdue", threshold: { businessDays: 0 }, channel: "email", enabled: true },
        { type: "invite_unaccepted", threshold: { hours: 168 }, channel: "email", enabled: true },
        { type: "low_pool", threshold: { floor: 5 }, channel: "email", enabled: true },
        { type: "provisioning_failure", threshold: { failures: 1 }, channel: "email", enabled: true },
        { type: "register_drift", threshold: { mismatches: 1 }, channel: "email", enabled: true },
        { type: "sync_stale", threshold: { hours: 48 }, channel: "email", enabled: true },
      ])
    ) {
      throw new Error(
        `global alert semantic defaults mismatch: ${JSON.stringify(globalAlertDefaults.rows)}`,
      );
    }
  } finally {
    await owner.end();
  }

  const application = new pg.Client({
    connectionString: applicationUrl,
    application_name: "ledger-runtime-grant-verifier",
  });
  await application.connect();
  let applicationIntegrity;
  try {
    const identity = await application.query("SELECT current_user");
    const role = identity.rows[0]?.current_user;
    if (role !== "ledger_app") {
      throw new Error(
        `DATABASE_URL must connect as ledger_app, connected as ${role}`,
      );
    }
    const roleAttributes = await application.query(`
      SELECT
        rolsuper,
        rolcreaterole,
        rolcreatedb,
        rolcanlogin,
        rolreplication,
        rolbypassrls
      FROM pg_roles
      WHERE rolname = current_user
    `);
    const attributes = roleAttributes.rows[0];
    if (
      !attributes ||
      attributes.rolsuper ||
      attributes.rolcreaterole ||
      attributes.rolcreatedb ||
      !attributes.rolcanlogin ||
      attributes.rolreplication ||
      attributes.rolbypassrls
    ) {
      throw new Error(
        `ledger_app role attributes are unsafe: ${JSON.stringify(attributes)}`,
      );
    }
    const membershipPaths = await application.query(`
      WITH RECURSIVE role_paths(role_oid, path, cycle) AS (
        SELECT
          role_row.oid,
          ARRAY[role_row.oid],
          false
        FROM pg_roles AS role_row
        WHERE role_row.rolname = current_user

        UNION ALL

        SELECT
          membership.roleid,
          role_paths.path || membership.roleid,
          membership.roleid = ANY(role_paths.path)
        FROM role_paths
        JOIN pg_auth_members AS membership
          ON membership.member = role_paths.role_oid
        WHERE NOT role_paths.cycle
      )
      SELECT array_to_string(
        ARRAY(
          SELECT role_row.rolname
          FROM unnest(role_paths.path) WITH ORDINALITY AS path_role(oid, position)
          JOIN pg_roles AS role_row ON role_row.oid = path_role.oid
          ORDER BY path_role.position
        ),
        ' -> '
      ) AS path
      FROM role_paths
      WHERE role_paths.role_oid <> role_paths.path[1]
      ORDER BY path
    `);
    if (membershipPaths.rows.length > 0) {
      throw new Error(
        "ledger_app must not be a member of any role: " +
          membershipPaths.rows.map(({ path }) => path).join(", "),
      );
    }
    const grants = await application.query(`
      WITH application_tables AS (
        SELECT relation.relname AS table_name
        FROM pg_class AS relation
        JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname = 'public'
          AND relation.relkind IN ('r', 'p')
          AND relation.relname <> 'ledger_schema_migrations'
      ),
      table_privileges(privilege) AS (
        VALUES
          ('SELECT'),
          ('INSERT'),
          ('UPDATE'),
          ('DELETE'),
          ('TRUNCATE'),
          ('REFERENCES'),
          ('TRIGGER')
      )
      SELECT table_name, privilege
      FROM application_tables
      CROSS JOIN table_privileges
      WHERE has_table_privilege(
        current_user,
        quote_ident('public') || '.' || quote_ident(table_name),
        privilege
      )
      ORDER BY table_name, privilege
    `);
    const actualRuntimeTableGrants = grants.rows.map(({ table_name, privilege }) => ({
      tableName: table_name,
      privilege,
    }));
    if (
      JSON.stringify(actualRuntimeTableGrants) !==
      JSON.stringify(expectedRuntimeTableGrants)
    ) {
      throw new Error(
        "ledger_app runtime table-grant matrix mismatch: expected " +
          JSON.stringify(expectedRuntimeTableGrants) +
          ", received " +
          JSON.stringify(actualRuntimeTableGrants),
      );
    }

    const applicationColumns = await application.query(`
      SELECT relation.relname AS table_name, attribute.attname AS column_name
      FROM pg_class AS relation
      JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      JOIN pg_attribute AS attribute ON attribute.attrelid = relation.oid
      WHERE namespace.nspname = 'public'
        AND relation.relkind IN ('r', 'p')
        AND relation.relname <> 'ledger_schema_migrations'
        AND attribute.attnum > 0
        AND NOT attribute.attisdropped
      ORDER BY relation.relname, attribute.attname
    `);
    const expectedColumnPrivileges = applicationColumns.rows.flatMap(
      ({ table_name, column_name }) => {
        const privileges = [
          ...(["alert_notification_delivery", "lifecycle_notification_delivery"].includes(table_name) ? [] : ["INSERT"]),
          "SELECT",
        ];
        if (normallyUpdateableTableNames.includes(table_name)) {
          privileges.push('UPDATE');
        } else if (
          expectedAppendOnlyColumnUpdates.some(
            ({ tableName, columnName }) =>
              tableName === table_name && columnName === column_name,
          )
        ) {
          privileges.push('UPDATE');
        }
        return privileges.map((privilege) => ({
          tableName: table_name,
          columnName: column_name,
          privilege,
        }));
      },
    ).sort((left, right) => {
      const leftKey = `${left.tableName}\u0000${left.columnName}\u0000${left.privilege}`;
      const rightKey = `${right.tableName}\u0000${right.columnName}\u0000${right.privilege}`;
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    });
    const columnPrivileges = await application.query(`
      WITH application_columns AS (
        SELECT relation.relname AS table_name, attribute.attname AS column_name
        FROM pg_class AS relation
        JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
        JOIN pg_attribute AS attribute ON attribute.attrelid = relation.oid
        WHERE namespace.nspname = 'public'
          AND relation.relkind IN ('r', 'p')
          AND relation.relname <> 'ledger_schema_migrations'
          AND attribute.attnum > 0
          AND NOT attribute.attisdropped
      ),
      column_privileges(privilege) AS (
        VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('REFERENCES')
      )
      SELECT table_name, column_name, privilege
      FROM application_columns
      CROSS JOIN column_privileges
      WHERE has_column_privilege(
        current_user,
        quote_ident('public') || '.' || quote_ident(table_name),
        quote_ident(column_name),
        privilege
      )
      ORDER BY table_name, column_name, privilege
    `);
    const actualColumnPrivileges = columnPrivileges.rows.map(
      ({ table_name, column_name, privilege }) => ({
        tableName: table_name,
        columnName: column_name,
        privilege,
      }),
    );
    if (JSON.stringify(actualColumnPrivileges) !== JSON.stringify(expectedColumnPrivileges)) {
      const mismatchIndex = expectedColumnPrivileges.findIndex(
        (expectedPrivilege, index) =>
          JSON.stringify(expectedPrivilege) !== JSON.stringify(actualColumnPrivileges[index]),
      );
      throw new Error(
        "ledger_app runtime column-grant matrix mismatch at index " +
          mismatchIndex +
          ": expected " +
          JSON.stringify(expectedColumnPrivileges[mismatchIndex]) +
          ", received " +
          JSON.stringify(actualColumnPrivileges[mismatchIndex]),
      );
    }

    const schemaPrivileges = await application.query(`
      SELECT
        has_schema_privilege(current_user, 'public', 'USAGE') AS has_usage,
        has_schema_privilege(current_user, 'public', 'CREATE') AS has_create,
        has_table_privilege(current_user, 'public.ledger_schema_migrations', 'SELECT')
          AS has_migration_select,
        has_table_privilege(current_user, 'public.ledger_schema_migrations', 'INSERT')
          AS has_migration_insert,
        has_table_privilege(current_user, 'public.ledger_schema_migrations', 'UPDATE')
          AS has_migration_update,
        has_table_privilege(current_user, 'public.ledger_schema_migrations', 'DELETE')
          AS has_migration_delete,
        has_table_privilege(current_user, 'public.ledger_schema_migrations', 'TRUNCATE')
          AS has_migration_truncate,
        has_table_privilege(current_user, 'public.ledger_schema_migrations', 'REFERENCES')
          AS has_migration_references,
        has_table_privilege(current_user, 'public.ledger_schema_migrations', 'TRIGGER')
          AS has_migration_trigger,
        EXISTS (
          SELECT 1
          FROM pg_attribute AS attribute
          WHERE attribute.attrelid = 'public.ledger_schema_migrations'::regclass
            AND attribute.attnum > 0
            AND NOT attribute.attisdropped
            AND (
              has_column_privilege(current_user, 'public.ledger_schema_migrations', attribute.attname, 'SELECT')
              OR has_column_privilege(current_user, 'public.ledger_schema_migrations', attribute.attname, 'INSERT')
              OR has_column_privilege(current_user, 'public.ledger_schema_migrations', attribute.attname, 'UPDATE')
              OR has_column_privilege(current_user, 'public.ledger_schema_migrations', attribute.attname, 'REFERENCES')
            )
        ) AS has_migration_column_privilege
    `);
    if (
      JSON.stringify(schemaPrivileges.rows) !==
      JSON.stringify([
        {
          has_usage: true,
          has_create: false,
          has_migration_select: false,
          has_migration_insert: false,
          has_migration_update: false,
          has_migration_delete: false,
          has_migration_truncate: false,
          has_migration_references: false,
          has_migration_trigger: false,
          has_migration_column_privilege: false,
        },
      ])
    ) {
      throw new Error(
        `ledger_app schema/migration privilege mismatch: ${JSON.stringify(schemaPrivileges.rows)}`,
      );
    }
    applicationIntegrity = {
      role,
      columnPrivileges: actualColumnPrivileges,
      tableGrants: actualRuntimeTableGrants,
      totalTables: tableCount,
    };
  } finally {
    await application.end();
  }

  return {
    ownerRole: ownerName,
    tableCount,
    migrationCount,
    appendOnlyTriggerCount: expectedAppendOnlyTriggers.length,
    applicationIntegrity,
  };
}

async function main() {
  const result = await verifyMigratedSchema();
  console.log(
    `✓ ${result.migrationCount} committed migration checksum(s) verified across ` +
      `${result.tableCount} application table(s)`,
  );
  console.log(`✓ ${result.appendOnlyTriggerCount} append-only trigger(s) verified`);
  if (result.applicationIntegrity) {
    console.log(
      "✓ ledger_app has the exact least-privilege runtime grant matrix",
    );
  }
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  main().catch((error) => {
    console.error(`✗ committed migration verification failed: ${error.message}`);
    process.exitCode = 1;
  });
}
