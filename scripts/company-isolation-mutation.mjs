import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

// Supplemental BR-22 fault injection: the diff campaign cannot mutate unchanged
// authorization and finance seams. Only assertion failures count as kills;
// startup failures, missing tests and runtime errors fail this gate.
const root = fileURLToPath(new URL("../", import.meta.url));
const web = "apps/web/src/modules/";
const probes = [
  {name:"inventory missing inherited statement ownership", file:"testing/company-isolation.json", search:'"statement_line": {', replacement:'"unowned_statement_line": {', pkg:"@smp/db", test:"src/company-isolation-inventory.spec.ts", pattern:"every schema table"},
  {name:"CI isolation step removed", file:".github/workflows/ci.yml", search:"run: pnpm test:isolation", replacement:"run: pnpm test", pkg:"@smp/db", test:"src/ci-workflow.spec.ts", pattern:"US-047"},
  {name:"transfer day omitted by close", file:"packages/domain/src/close/license-close.ts", search:"const licenseDays = (to - from) / dayMs + 1;", replacement:"const licenseDays = (to - from) / dayMs;", test:"src/modules/close/close-service.integration.test.ts", pattern:"US-047"},
  {name:"viewer command capability", file:"packages/domain/src/identity-access/authorization.ts", search:'viewer: ["company:read", "finance:read"],', replacement:'viewer: ["company:read", "finance:read", "request:create"],', pkg:"@smp/domain", test:"src/identity-access/authorization.test.ts", pattern:"reads only its company financial evidence"},
  {name:"register company predicate", file:web+"register/repository.ts", search:"return inArray(column, ids);", replacement:"return sql`TRUE`;", test:"src/modules/register/repository.integration.test.ts", pattern:"register evidence and CSV never"},
  {name:"explicit register company denial", file:web+"register/repository.ts", search:'\n    if (filters.companyId) assertCapability(authorization, "finance:read", filters.companyId);', replacement:"", test:"src/modules/register/repository.integration.test.ts", pattern:"register evidence and CSV never"},
  {name:"stream denial before header", file:web+"register/repository.ts", search:'        if (filters.companyId) assertCapability(authorization, "finance:read", filters.companyId);', replacement:"", test:"src/modules/register/repository.integration.test.ts", pattern:"register evidence and CSV never"},
  {name:"people company predicate", file:web+"org-registry/repository.ts", search:'return ids.length === 0 ? sql`FALSE` : inArray(column, ids);', replacement:'return sql`TRUE`;', test:"src/modules/org-registry/repository.integration.test.ts", pattern:"US-047"},
  {name:"viewer and scoped people writes", file:web+"org-registry/repository.ts", search:'if (authorization.globalRole !== "group_admin") {', replacement:'if (false) {', test:"src/modules/org-registry/repository.integration.test.ts", pattern:"US-047"},
  {name:"statement list grant intersection", file:web+"statements/repository.ts", search:'authorization.companyIds.filter(id => permitted === "all" || permitted.has(id))', replacement:'authorization.companyIds', test:"src/modules/statements/list-repository.integration.test.ts", pattern:"US-041"},
  {name:"statement detail company predicate", file:web+"statements/repository.ts", search:'scope === "all" ? sql`TRUE` : inArray(statement.companyId, [...scope])', replacement:'sql`TRUE`', test:"src/modules/statements/repository.integration.test.ts", pattern:"rejects foreign company"},
  {"name":"statement CSV company predicates","file":"apps/web/src/modules/statements/export-transaction.ts","search":"const [header] = await tx.select({ statement, code: company.code, name: company.name, language: company.statementLanguage })\n          .from(statement).innerJoin(company, and(eq(company.id, statement.companyId), inArray(company.id, ids)))\n          .where(and(eq(statement.id, id), inArray(statement.companyId, ids)));","replacement":"const [header] = await tx.select({ statement, code: company.code, name: company.name, language: company.statementLanguage })\n          .from(statement).innerJoin(company, eq(company.id, statement.companyId))\n          .where(eq(statement.id, id));","test":"src/modules/statements/export.integration.test.ts","pattern":"US-041 .* exports only granted company evidence"},
  {"name":"statement PDF company predicates","file":"apps/web/src/modules/statements/export-transaction.ts","search":"const [snapshot] = await tx.select({ statement, company: { id: company.id, code: company.code, name: company.name, statementLanguage: company.statementLanguage } })\n          .from(statement).innerJoin(company, and(eq(company.id, statement.companyId), inArray(company.id, ids)))\n          .where(and(eq(statement.id, id), inArray(statement.companyId, ids)));","replacement":"const [snapshot] = await tx.select({ statement, company: { id: company.id, code: company.code, name: company.name, statementLanguage: company.statementLanguage } })\n          .from(statement).innerJoin(company, eq(company.id, statement.companyId))\n          .where(eq(statement.id, id));","test":"src/modules/statements/export.integration.test.ts","pattern":"US-041 .* exports only granted company PDF evidence"},
  {name:"rollup scoped-role guard", file:web+"close/rollup-transaction.ts", search:'!auth || (auth.globalRole !== "central_finance" && auth.globalRole !== "group_admin")', replacement:'!auth', test:"src/modules/close/rollup.integration.test.ts", pattern:"US-047"},
];
const output = join(root,"reports/us047");
mkdirSync(output,{recursive:true});
function run(probe, index, baseline) {
  const path = join(output,`${index}-${baseline?"baseline":"mutant"}.json`);
  const result = spawnSync("pnpm",["--filter",probe.pkg ?? "smp-web","exec","vitest","run",probe.test,"--testNamePattern",probe.pattern,"--passWithNoTests=false","--reporter=json","--reporter=default",`--outputFile=${path}`],{cwd:root,env:process.env,encoding:"utf8",timeout:180_000,maxBuffer:8*1024*1024});
  if (result.error || result.signal) throw new Error(`${probe.name}: process failure`,{cause:result.error});
  const report=JSON.parse(readFileSync(path,"utf8"));
  const assertions=report.testResults.flatMap(suite=>suite.assertionResults);
  const failed=assertions.filter(test=>test.status==="failed");
  if (report.numTotalTests===0 || assertions.every(test=>test.status==="pending") || report.numRuntimeErrorTestSuites>0) throw new Error(`${probe.name}: no valid test execution`);
  if(baseline) {
    if(result.status!==0 || failed.length) throw new Error(`${probe.name}: baseline failed`);
  } else if(result.status===0 || failed.length===0 || failed.some(test=>!test.failureMessages.every(message=>/AssertionError|Assertion\.__VITEST_(?:REJECTS|RESOLVES)__/.test(message) || (/Property failed after/.test(message) && /Caused by: AssertionError/.test(result.stdout+result.stderr))))) {
    throw new Error(`${probe.name}: survived or failed without an assertion oracle`);
  }
  return {name:probe.name,status:baseline?"baseline_pass":"killed",assertions:failed.map(test=>test.fullName)};
}
const evidence=[];
for (const [index,probe] of probes.entries()) {
  const path=join(root,probe.file),original=readFileSync(path,"utf8");
  // Match whole lines for the two denial guards (the stream line is indented).
  const occurrences=original.split(probe.search).length-1;
  if(occurrences!==1) throw new Error(`${probe.name}: expected one target, found ${occurrences}`);
  run(probe,index,true);
  try {
    writeFileSync(path,original.replace(probe.search,probe.replacement));
    evidence.push(run(probe,index,false));
  } finally {writeFileSync(path,original);}
  console.log(`killed: ${probe.name}`);
}
writeFileSync(join(output,"br22-probes.json"),JSON.stringify({rule:"BR-22",killed:evidence.length,total:probes.length,survived:0,errors:0,probes:evidence},null,2)+"\n");
console.log(`BR-22: ${evidence.length}/${probes.length} assertion kills`);
