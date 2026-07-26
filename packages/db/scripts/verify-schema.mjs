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
  "alert_rule",
  "audit_log",
  "close_run",
  "company",
  "company_role_assignment",
  "cost_record",
  "integration_credential",
  "license_assignment",
  "license_request",
  "license_type",
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
    { tableName, privilege: "INSERT" },
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
    'company_role_assignment.revoked',
    'CompanyRoleAssignment',
    assignment_row.id,
    assignment_row.company_id,
    NULL,
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

    const sourceRequestUniqueness = await owner.query(`
      SELECT
        constraint_row.contype AS constraint_type,
        index_definition.indisunique AS index_is_unique,
        index_definition.indnullsnotdistinct AS nulls_not_distinct,
        array_agg(attribute.attname::text ORDER BY constraint_key.ordinality) AS column_names
      FROM pg_constraint AS constraint_row
      JOIN pg_index AS index_definition
        ON index_definition.indexrelid = constraint_row.conindid
      JOIN LATERAL unnest(constraint_row.conkey) WITH ORDINALITY
        AS constraint_key(attnum, ordinality) ON true
      JOIN pg_attribute AS attribute
        ON attribute.attrelid = constraint_row.conrelid
        AND attribute.attnum = constraint_key.attnum
      WHERE constraint_row.conrelid = 'public.license_assignment'::regclass
        AND constraint_row.conname = 'uq_license_assignment_source_request_id'
      GROUP BY
        constraint_row.oid,
        constraint_row.contype,
        index_definition.indisunique,
        index_definition.indnullsnotdistinct
    `);
    const sourceRequestUnique = sourceRequestUniqueness.rows[0];
    if (
      sourceRequestUniqueness.rows.length !== 1 ||
      sourceRequestUnique.constraint_type !== "u" ||
      !sourceRequestUnique.index_is_unique ||
      sourceRequestUnique.nulls_not_distinct ||
      JSON.stringify(sourceRequestUnique.column_names) !==
        JSON.stringify(["source_request_id"])
    ) {
      throw new Error(
        `source-request uniqueness integrity mismatch: ${JSON.stringify(sourceRequestUniqueness.rows)}`,
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
        AND pg_get_function_arguments(function_row.oid) =
          'p_assignment_id uuid, p_company_id uuid, p_actor_user_id uuid'
    `);
    const revocation = roleRevocationFunction.rows[0];
    if (
      roleRevocationFunction.rows.length !== 1 ||
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
        const privileges = ['INSERT', 'SELECT'];
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
