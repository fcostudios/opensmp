import { execFileSync } from 'node:child_process';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';

const envFile = process.env.PRODUCTION_ENV_FILE;
assert.ok(envFile, 'PRODUCTION_ENV_FILE must name the local rehearsal environment');
const compose = (...args) => execFileSync('docker', ['compose', '--project-name',
  process.env.PRODUCTION_PROJECT ?? 'ledger-production', '--env-file', envFile,
  '-f', 'infra/docker-compose.production.yml', '-f', 'infra/production/docker-compose.local.yml', ...args],
  { encoding: 'utf8' });
const request = (host, path, format = '%{http_code}') => execFileSync('curl', [
  '--fail-with-body', '--silent', '--show-error', '--cacert', `${process.env.LOCAL_CA_DIR}/root.crt`,
  '--resolve', `${host}:18443:127.0.0.1`, '-w', `\n${format}`, `https://${host}:18443${path}`,
], { encoding: 'utf8' });

test('TLS app health proves the deployed Next server can query PostgreSQL', () => {
  const [body, status] = request('ledger.localhost', '/api/health').trim().split('\n');
  assert.equal(status, '200');
  assert.deepEqual(JSON.parse(body), { status: 'ok', database: 'reachable' });
});

test('the committed migration verifier succeeded before the runtime started', () => {
  const id = compose('ps', '--all', '--quiet', 'migrate').trim();
  assert.equal(execFileSync('docker', ['inspect', '-f', '{{.State.Status}}:{{.State.ExitCode}}', id], { encoding: 'utf8' }).trim(), 'exited:0');
  const output = compose('exec', '-T', 'postgres', 'psql', '-U', 'postgres', '-d', 'ledger', '-Atc',
    "SELECT count(*) > 0 FROM ledger_schema_migrations");
  assert.equal(output.trim(), 't');
});

test('realm import advertises HTTPS issuer and keeps admin API behind the proxy', () => {
  const [body, status] = request('auth.localhost', '/realms/corporativo/.well-known/openid-configuration').trim().split('\n');
  assert.equal(status, '200');
  assert.equal(JSON.parse(body).issuer, 'https://auth.localhost:18443/realms/corporativo');
  assert.throws(() => request('auth.localhost', '/admin/realms/corporativo'), /404/);
});

test('runtime is healthy, non-root, and can read the KEK with the crypto permission contract', () => {
  for (const name of ['app', 'worker', 'postgres', 'keycloak', 'smtp-relay', 'caddy']) {
    const id = compose('ps', '--quiet', name).trim();
    assert.ok(id, `${name} running`);
    assert.equal(execFileSync('docker', ['inspect', '-f', '{{.State.Health.Status}}', id], { encoding: 'utf8' }).trim(), 'healthy');
  }
  const result = compose('exec', '-T', 'app', 'node', '-e', `
    const fs = require('node:fs');
    const p = process.env.LEDGER_CREDENTIAL_KEK_FILE;
    const s = fs.statSync(p);
    process.stdout.write(JSON.stringify({uid:process.getuid(), mode:s.mode & 511, bytes:Buffer.from(fs.readFileSync(p,'utf8'),'base64').length}));
  `);
  assert.deepEqual(JSON.parse(result), { uid: 1001, mode: 0o440, bytes: 32 });
});

test('server-side OIDC discovery validates the same local CA and canonical issuer', () => {
  const output = compose('exec', '-T', 'app', 'node', '-e', `
    fetch(process.env.KEYCLOAK_ISSUER+'/.well-known/openid-configuration')
      .then(async r=>{if(!r.ok)process.exit(1);process.stdout.write((await r.json()).issuer)})
      .catch(()=>process.exit(1));
  `);
  assert.equal(output, 'https://auth.localhost:18443/realms/corporativo');
});
