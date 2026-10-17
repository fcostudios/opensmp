// DEC-SMP-053: finite catalog comparison using the existing owner connection.
// Declaration text is never executable SQL. Every lookup uses parameters.
function mismatch(part, received) {
  throw new Error(`schema-catalog/${part}: ${JSON.stringify(received)}`);
}
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
// Compare both sides by identifier codepoints, independently of DB/host locale.
const sorted = (rows) => [...rows].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

export async function verifySchemaExtensionCatalog({ owner, newTables, baselineTableNames }) {
  const tables = await owner.query(`SELECT c.relname AS name FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
    AND c.relkind IN ('r','p') AND c.relname <> 'ledger_schema_migrations' ORDER BY c.relname`);
  if (!same(tables.rows.map(({ name }) => name).sort(), [...baselineTableNames, ...newTables.map(({ tableName }) => tableName)].sort())) mismatch("table-set", tables.rows);
  const result = [];
  for (const table of newTables) {
    const relation = await owner.query(`SELECT c.relrowsecurity AS enabled,c.relforcerowsecurity AS forced,c.relkind
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=$1`, [table.tableName]);
    if (relation.rows.length !== 1 || relation.rows[0].relkind !== 'r' || !same({ enabled: relation.rows[0].enabled, forced: relation.rows[0].forced }, table.rls)) mismatch("rls", relation.rows);
    const policies = await owner.query(`SELECT policyname AS name,cmd AS command,roles::text[] AS roles,permissive,qual,with_check
      FROM pg_policies WHERE schemaname='public' AND tablename=$1 ORDER BY policyname`, [table.tableName]);
    // Exact PostgreSQL16 deparse of the one approved predicate. Whitespace
    // folds formatting only; parentheses/operators/identifiers remain exact.
    const predicate = "(EXISTS ( SELECT 1 FROM vendor_account WHERE (vendor_account.id = drift_episode.vendor_account_id)))";
    const expression = (text) => text === null ? null : text.replace(/\s+/gu, " ").trim();
    const expectedPolicies = sorted(table.policies).map(({ name, command, role, using, withCheck }) => ({ name, command, roles: [role], permissive: "PERMISSIVE", qual: using === null ? null : predicate, with_check: withCheck === null ? null : predicate }));
    const actualPolicies = policies.rows.map((row) => ({ ...row, qual: expression(row.qual), with_check: expression(row.with_check) }));
    if (!same(sorted(actualPolicies), expectedPolicies)) mismatch("policies", actualPolicies);
    const constraints = await owner.query(`SELECT k.conname AS name,k.contype AS kind,k.convalidated AS validated,
      k.condeferrable AS deferrable,k.condeferred AS deferred,k.confupdtype AS update_action,k.confdeltype AS delete_action,k.confmatchtype AS match_type,
      ARRAY(SELECT a.attname::text FROM unnest(k.conkey) WITH ORDINALITY x(num,pos) JOIN pg_attribute a ON a.attrelid=k.conrelid AND a.attnum=x.num ORDER BY x.pos) AS columns,
      rn.nspname AS referenced_schema,r.relname AS referenced_table,
      ARRAY(SELECT a.attname::text FROM unnest(k.confkey) WITH ORDINALITY x(num,pos) JOIN pg_attribute a ON a.attrelid=k.confrelid AND a.attnum=x.num ORDER BY x.pos) AS referenced_columns
      FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      LEFT JOIN pg_class r ON r.oid=k.confrelid LEFT JOIN pg_namespace rn ON rn.oid=r.relnamespace
      WHERE n.nspname='public' AND c.relname=$1 ORDER BY k.conname`, [table.tableName]);
    const expectedConstraints = sorted(table.constraints.filter(({ kind }) => kind !== "UNIQUE_OPEN")).map((row) => ({
      name: row.name, kind: ({ PRIMARY_KEY: "p", FOREIGN_KEY: "f", UNIQUE: "u" })[row.kind], validated: true, deferrable: false, deferred: false,
      update_action: row.kind === "FOREIGN_KEY" ? "a" : " ", delete_action: row.kind === "FOREIGN_KEY" ? "a" : " ", match_type: row.kind === "FOREIGN_KEY" ? "s" : " ",
      columns: row.columns, referenced_schema: row.kind === "FOREIGN_KEY" ? "public" : null, referenced_table: row.referencedTable ?? null, referenced_columns: row.referencedColumns ?? [],
    }));
    if (!same(sorted(constraints.rows), expectedConstraints)) mismatch("constraints", constraints.rows);
    // Validate ALL index flags, ordered key columns, includes/expressions and
    // predicate. Constraint-backed indexes are checked here as well.
    const indexes = await owner.query(`SELECT ci.relname AS name,i.indisunique AS unique,i.indisprimary AS primary,
      i.indisvalid AS valid,i.indisready AS ready,i.indimmediate AS immediate,i.indnullsnotdistinct AS nulls_not_distinct,
      i.indnatts::int AS attributes,i.indnkeyatts::int AS keys,
      ARRAY(SELECT a.attname::text FROM unnest(i.indkey) WITH ORDINALITY x(num,pos) LEFT JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=x.num ORDER BY x.pos) AS columns,
      pg_get_expr(i.indexprs,i.indrelid) AS expressions,pg_get_expr(i.indpred,i.indrelid) AS predicate,
      am.amname AS method,k.conname AS constraint_name
      FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_class ci ON ci.oid=i.indexrelid JOIN pg_am am ON am.oid=ci.relam LEFT JOIN pg_constraint k ON k.conindid=i.indexrelid AND k.conrelid=i.indrelid
      WHERE n.nspname='public' AND c.relname=$1 ORDER BY ci.relname`, [table.tableName]);
    const expectedIndexes = sorted(table.constraints.filter(({ kind }) => ["PRIMARY_KEY", "UNIQUE", "UNIQUE_OPEN"].includes(kind))).map((row) => ({ name: row.name, unique: true, primary: row.kind === "PRIMARY_KEY", valid: true, ready: true, immediate: true, nulls_not_distinct: false, attributes: row.columns.length, keys: row.columns.length, columns: row.columns, expressions: null, predicate: row.kind === "UNIQUE_OPEN" ? "(resolved_at IS NULL)" : null, method: "btree", constraint_name: row.kind === "UNIQUE_OPEN" ? null : row.name }));
    if (!same(sorted(indexes.rows), expectedIndexes)) mismatch("indexes", indexes.rows);
    const nullable = await owner.query(`SELECT a.attnotnull AS required FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname=$1 AND a.attname='resolved_at' AND NOT a.attisdropped`, [table.tableName]);
    if (nullable.rows.length !== 1 || nullable.rows[0].required !== false) mismatch("nullable", nullable.rows);
    // Projection is safe only after every actual tuple was compared above.
    // Recover finite descriptors from actual names/commands/columns/actions;
    // the digest therefore changes with a real accepted catalog rename.
    result.push({ tableName: tables.rows.find(({ name }) => name === table.tableName).name,
      rls: { enabled: relation.rows[0].enabled, forced: relation.rows[0].forced },
      policies: table.policies.map(({ name }) => { const actual = actualPolicies.find((row) => row.name === name); const finite = { template: "account-reference-exists-v1", columnName: "vendor_account_id", referencedTable: "vendor_account", referencedColumn: "id" }; return { name: actual.name, command: actual.command, role: actual.roles[0], using: actual.qual === null ? null : finite, withCheck: actual.with_check === null ? null : finite }; }),
      constraints: table.constraints.map(({ name, kind }) => {
        if (kind === "UNIQUE_OPEN") { const actual = indexes.rows.find((row) => row.name === name); return { name: actual.name, kind, columns: actual.columns, nullColumn: "resolved_at" }; }
        const actual = constraints.rows.find((row) => row.name === name); const row = { name: actual.name, kind: ({ p: "PRIMARY_KEY", f: "FOREIGN_KEY", u: "UNIQUE" })[actual.kind], columns: actual.columns };
        if (actual.kind === "f") Object.assign(row, { referencedTable: actual.referenced_table, referencedColumns: actual.referenced_columns, onUpdate: "NO_ACTION", onDelete: "NO_ACTION" }); return row;
      }),
    });
  }
  return result;
}
