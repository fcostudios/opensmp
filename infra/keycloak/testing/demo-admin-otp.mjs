// CHG-124 — demo stack only: switch the platform-admin OTP step of the running
// realm's browser flow through the Keycloak admin API. Never edits
// realm-corporativo.json; production keeps mandatory admin 2FA.
//
//   DEMO_ADMIN_OTP=off  set the `ledger-platform-admin-otp` sub-flow execution
//                       to DISABLED, then verify it took effect
//   DEMO_ADMIN_OTP=on   write nothing; verify it is still CONDITIONAL
//
// Either way it verifies every user named in DEMO_PLATFORM_ADMINS (comma
// separated) is still a member of the `platform-admin` group: the app's
// authorization is unchanged, only the second factor is.
const baseUrl = process.env.KEYCLOAK_URL;
const adminUsername = process.env.KEYCLOAK_ADMIN_USERNAME;
const adminPassword = process.env.KEYCLOAK_ADMIN_PASSWORD;
const mode = process.env.DEMO_ADMIN_OTP;
const realm = process.env.KEYCLOAK_REALM ?? "corporativo";
const subFlowAlias = "ledger-platform-admin-otp";
const expectedAdmins = (process.env.DEMO_PLATFORM_ADMINS ?? "")
  .split(",").map((name) => name.trim()).filter(Boolean);

function fail(message) {
  console.error(`demo-admin-otp: ${message}`);
  process.exit(1);
}

if (!baseUrl || !adminUsername || !adminPassword) fail("KEYCLOAK_URL, KEYCLOAK_ADMIN_USERNAME and KEYCLOAK_ADMIN_PASSWORD are required");
if (mode !== "on" && mode !== "off") fail(`DEMO_ADMIN_OTP must be "on" or "off", got ${JSON.stringify(mode)}`);

async function request(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, init);
  if (!response.ok) fail(`${init.method ?? "GET"} ${path} failed with ${response.status}`);
  return response;
}

const tokenResponse = await request("/realms/master/protocol/openid-connect/token", {
  method: "POST",
  body: new URLSearchParams({ client_id: "admin-cli", grant_type: "password", username: adminUsername, password: adminPassword }),
});
const { access_token: accessToken } = await tokenResponse.json();
if (typeof accessToken !== "string") fail("did not receive an admin token");

const admin = (path, init = {}) => request(`/admin/realms/${encodeURIComponent(realm)}${path}`, {
  ...init,
  headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", ...init.headers },
});

const { browserFlow } = await (await admin("")).json();
if (typeof browserFlow !== "string" || browserFlow === "") fail(`realm ${realm} has no browser flow`);
const executionsPath = `/authentication/flows/${encodeURIComponent(browserFlow)}/executions`;

async function otpExecution() {
  const executions = await (await admin(executionsPath)).json();
  const matches = executions.filter((execution) => execution.authenticationFlow === true && execution.displayName === subFlowAlias);
  if (matches.length !== 1) {
    fail(`expected exactly one '${subFlowAlias}' sub-flow under browser flow '${browserFlow}', found ${matches.length}`);
  }
  return matches[0];
}

const before = await otpExecution();
if (mode === "off") {
  if (before.requirement !== "DISABLED") {
    await admin(executionsPath, { method: "PUT", body: JSON.stringify({ ...before, requirement: "DISABLED" }) });
  }
  const after = await otpExecution();
  if (after.requirement !== "DISABLED") fail(`'${subFlowAlias}' is still ${after.requirement} after the update`);
} else if (before.requirement !== "CONDITIONAL") {
  fail(`DEMO_ADMIN_OTP=on but '${subFlowAlias}' is ${before.requirement}, not CONDITIONAL`);
}

for (const username of expectedAdmins) {
  const [user] = await (await admin(`/users?username=${encodeURIComponent(username)}&exact=true`)).json();
  if (!user?.id) fail(`user ${username} not found`);
  const groups = await (await admin(`/users/${encodeURIComponent(user.id)}/groups`)).json();
  if (!groups.some((group) => group.path === "/platform-admin")) fail(`${username} is no longer in platform-admin`);
}

console.log(`demo-admin-otp: browser flow '${browserFlow}', '${subFlowAlias}' ${before.requirement} -> ${(await otpExecution()).requirement}`
  + `; platform-admin members verified: ${expectedAdmins.join(", ") || "(none named)"}`);
