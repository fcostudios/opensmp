// CHG-124 — the demo stack's admin 2FA switch. Run:
//   node --test infra/tests/demo-two-factor.test.mjs
// 1. infra/keycloak/testing/demo-admin-otp.mjs against an in-process fake of the
//    Keycloak admin API: it disables exactly the `ledger-platform-admin-otp`
//    sub-flow execution, verifies the change and the admins' platform-admin
//    membership, and fails loudly otherwise. Nothing real is contacted.
// 2. demo-up.sh with stub docker/curl/openssl: `--with-2fa` parsing and how a
//    reused stack reports its recorded mode. No container is touched.
import { spawn, spawnSync } from 'node:child_process';
import { strict as assert } from 'node:assert';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

const SUB_FLOW = 'ledger-platform-admin-otp';

/** Flattened executions of the realm's browser flow, as Keycloak 26 returns them. */
function browserExecutions({ otpRequirement = 'CONDITIONAL', otpFlows = 1 } = {}) {
  const executions = [
    { id: 'e-cookie', requirement: 'ALTERNATIVE', displayName: 'Cookie', providerId: 'auth-cookie', level: 0, index: 0, priority: 10, authenticationFlow: false },
    { id: 'e-forms', requirement: 'ALTERNATIVE', displayName: 'ledger-browser-forms', flowId: 'f-forms', level: 0, index: 1, priority: 30, authenticationFlow: true },
    { id: 'e-password', requirement: 'REQUIRED', displayName: 'Username Password Form', providerId: 'auth-username-password-form', level: 1, index: 0, priority: 10, authenticationFlow: false },
  ];
  for (let n = 0; n < otpFlows; n += 1) {
    executions.push({ id: `e-otp-${n}`, requirement: otpRequirement, displayName: SUB_FLOW, flowId: `f-otp-${n}`, level: 1, index: 1 + n, priority: 20, authenticationFlow: true });
  }
  executions.push({ id: 'e-otp-form', requirement: 'REQUIRED', displayName: 'OTP Form', providerId: 'auth-otp-form', level: 2, index: 1, priority: 20, authenticationFlow: false });
  return executions;
}

/** Minimal fake of the endpoints the script uses; records every write. */
async function fakeKeycloak({ executions = browserExecutions(), ignorePut = false, members = ['demo-group-admin', 'demo-central-finance'] } = {}) {
  const puts = [];
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      const url = new URL(request.url, 'http://fake');
      const send = (status, value) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(value ?? null)); };
      if (url.pathname === '/realms/master/protocol/openid-connect/token' && request.method === 'POST') return send(200, { access_token: 'token-1' });
      if (request.headers.authorization !== 'Bearer token-1') return send(401, {});
      const base = '/admin/realms/corporativo';
      if (url.pathname === base && request.method === 'GET') return send(200, { realm: 'corporativo', browserFlow: 'ledger-browser' });
      if (url.pathname === `${base}/authentication/flows/ledger-browser/executions`) {
        if (request.method === 'GET') return send(200, executions);
        if (request.method === 'PUT') {
          const update = JSON.parse(body);
          puts.push(update);
          const target = executions.find((execution) => execution.id === update.id);
          if (!target) return send(404, {});
          if (!ignorePut) target.requirement = update.requirement;
          return send(202, null);
        }
      }
      if (url.pathname === `${base}/users` && request.method === 'GET') {
        const username = url.searchParams.get('username');
        return send(200, [{ id: `id-${username}`, username }]);
      }
      const groups = url.pathname.match(/^\/admin\/realms\/corporativo\/users\/id-([^/]+)\/groups$/);
      if (groups && request.method === 'GET') {
        return send(200, members.includes(decodeURIComponent(groups[1])) ? [{ id: 'g1', name: 'platform-admin', path: '/platform-admin' }] : []);
      }
      return send(404, { path: url.pathname, method: request.method });
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, puts, executions, close: () => new Promise((resolve) => server.close(resolve)) };
}

/** Async: the fake server lives in this process, so spawnSync would deadlock. */
function runOtpScript(keycloakUrl, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['infra/keycloak/testing/demo-admin-otp.mjs'], {
      env: { PATH: process.env.PATH, KEYCLOAK_URL: keycloakUrl, KEYCLOAK_ADMIN_USERNAME: 'admin', KEYCLOAK_ADMIN_PASSWORD: 'pw',
        DEMO_PLATFORM_ADMINS: 'demo-group-admin,demo-central-finance', ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

test('off: disables exactly the platform-admin OTP sub-flow execution and verifies it', async () => {
  const keycloak = await fakeKeycloak();
  try {
    const result = await runOtpScript(keycloak.url, { DEMO_ADMIN_OTP: 'off' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(keycloak.puts.length, 1);
    assert.equal(keycloak.puts[0].id, 'e-otp-0');
    assert.equal(keycloak.puts[0].requirement, 'DISABLED');
    assert.equal(keycloak.puts[0].displayName, SUB_FLOW, 'the PUT carries the execution as read, only the requirement changed');
    assert.deepEqual(
      keycloak.executions.filter((execution) => execution.requirement === 'DISABLED').map((execution) => execution.id),
      ['e-otp-0'], 'nothing else in the browser flow changes');
    assert.match(result.stdout, /CONDITIONAL -> DISABLED/);
  } finally { await keycloak.close(); }
});

test('off: fails loudly when the change does not take effect', async () => {
  const keycloak = await fakeKeycloak({ ignorePut: true });
  try {
    const result = await runOtpScript(keycloak.url, { DEMO_ADMIN_OTP: 'off' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /still CONDITIONAL after the update/);
  } finally { await keycloak.close(); }
});

for (const [label, otpFlows] of [['missing', 0], ['ambiguous', 2]]) {
  test(`off: refuses a ${label} '${SUB_FLOW}' sub-flow without writing`, async () => {
    const keycloak = await fakeKeycloak({ executions: browserExecutions({ otpFlows }) });
    try {
      const result = await runOtpScript(keycloak.url, { DEMO_ADMIN_OTP: 'off' });
      assert.equal(result.status, 1);
      assert.match(result.stderr, new RegExp(`expected exactly one '${SUB_FLOW}'.*found ${otpFlows}`));
      assert.deepEqual(keycloak.puts, []);
    } finally { await keycloak.close(); }
  });
}

test('off: fails when an admin is no longer in platform-admin', async () => {
  const keycloak = await fakeKeycloak({ members: ['demo-group-admin'] });
  try {
    const result = await runOtpScript(keycloak.url, { DEMO_ADMIN_OTP: 'off' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /demo-central-finance is no longer in platform-admin/);
  } finally { await keycloak.close(); }
});

test('on: writes nothing and accepts the imported CONDITIONAL requirement', async () => {
  const keycloak = await fakeKeycloak();
  try {
    const result = await runOtpScript(keycloak.url, { DEMO_ADMIN_OTP: 'on' });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(keycloak.puts, []);
  } finally { await keycloak.close(); }
});

test('on: refuses a realm whose admin OTP is not CONDITIONAL', async () => {
  const keycloak = await fakeKeycloak({ executions: browserExecutions({ otpRequirement: 'DISABLED' }) });
  try {
    const result = await runOtpScript(keycloak.url, { DEMO_ADMIN_OTP: 'on' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /is DISABLED, not CONDITIONAL/);
    assert.deepEqual(keycloak.puts, []);
  } finally { await keycloak.close(); }
});

for (const value of [undefined, '', 'disabled']) {
  test(`refuses DEMO_ADMIN_OTP=${JSON.stringify(value)} before any request`, async () => {
    const keycloak = await fakeKeycloak();
    try {
      const env = value === undefined ? {} : { DEMO_ADMIN_OTP: value };
      const result = await runOtpScript(keycloak.url, env);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /DEMO_ADMIN_OTP must be "on" or "off"/);
      assert.deepEqual(keycloak.puts, []);
    } finally { await keycloak.close(); }
  });
}

// --- demo-up.sh -------------------------------------------------------------

const stubRoot = mkdtempSync(join(tmpdir(), 'demo-2fa-'));
after(() => rmSync(stubRoot, { recursive: true, force: true }));

/** A reused, healthy-looking stack: docker reports a container, curl succeeds. */
function reusedStack(stateLines) {
  const dir = mkdtempSync(join(stubRoot, 'case-'));
  const bin = join(dir, 'bin');
  const state = join(dir, 'state');
  mkdirSync(bin);
  mkdirSync(state);
  writeFileSync(join(bin, 'docker'), '#!/bin/sh\ncase "$*" in "ps -aq"*) echo abc123 ;; esac\nexit 0\n');
  writeFileSync(join(bin, 'curl'), '#!/bin/sh\nexit 0\n');
  writeFileSync(join(bin, 'openssl'), '#!/bin/sh\necho "SHA1 Fingerprint=AA:BB:CC"\n');
  for (const tool of ['docker', 'curl', 'openssl']) chmodSync(join(bin, tool), 0o755);
  writeFileSync(join(state, 'state.env'), `${stateLines.join('\n')}\n`);
  writeFileSync(join(state, 'credentials.json'), '{}');
  writeFileSync(join(state, 'root.crt'), 'stub');
  return { bin, state };
}

function demoUp(stack, args = []) {
  return spawnSync('bash', ['infra/production/demo-up.sh', ...args], {
    encoding: 'utf8', env: { ...process.env, PATH: `${stack.bin}:${process.env.PATH}`, DEMO_STATE_DIR: stack.state },
  });
}

test('a reused stack with admin 2FA off reports it and prints no TOTP instructions', () => {
  const stack = reusedStack(['DEMO_MODE=journey', 'DEMO_ADMIN_OTP=off', 'DEMO_STATUS=ready']);
  const result = demoUp(stack);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /reusing it \(mode journey, admin 2FA off\)/);
  assert.match(result.stdout, /no 2FA \(demo only\)/);
  assert.match(result.stdout, /Production keeps mandatory admin 2FA/);
  assert.doesNotMatch(result.stdout, /TOTP|otpauthUri|totpSecret/);
  assert.equal(result.stderr, '');
});

test('a reused stack from before CHG-124 (no DEMO_ADMIN_OTP) reports 2FA on with the TOTP instructions', () => {
  const stack = reusedStack(['DEMO_MODE=empty', 'DEMO_STATUS=ready']);
  const result = demoUp(stack, ['--with-2fa']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /admin 2FA on\)/);
  assert.match(result.stdout, /otpauthUri/);
  assert.doesNotMatch(result.stdout, /no 2FA/);
  assert.equal(result.stderr, '');
});

test('asking for a 2FA mode a reused stack does not have says so', () => {
  const stack = reusedStack(['DEMO_MODE=journey', 'DEMO_ADMIN_OTP=off', 'DEMO_STATUS=ready']);
  const result = demoUp(stack, ['--with-2fa']);
  assert.equal(result.status, 0);
  assert.match(result.stderr, /asked for admin 2FA on, but this stack has it off/);
});

test('demo:up --with-2fa is an accepted argument; a typo next to it is not', () => {
  const stack = reusedStack([]);
  const typo = demoUp(stack, ['--with-2fa', '--emtpy']);
  assert.equal(typo.status, 1);
  assert.match(typo.stderr, /unknown argument '--emtpy'/);
  const help = demoUp(stack, ['--with-2fa', '--help']);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /--with-2fa\s+keep the platform admins' TOTP/);
});
