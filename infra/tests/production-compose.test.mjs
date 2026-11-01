import { execFileSync } from 'node:child_process';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';

// Exercise Compose interpolation/normalization, not a parallel YAML model.
const env = { ...process.env,
  POSTGRES_SUPERUSER_PASSWORD: 'test-super', LEDGER_OWNER_PASSWORD: 'test-owner',
  LEDGER_APP_PASSWORD: 'test-app', LEDGER_BACKUP_PASSWORD: 'test-backup',
  KEYCLOAK_DB_PASSWORD: 'test-idp', KEYCLOAK_ADMIN_PASSWORD: 'test-admin',
  KEYCLOAK_CLIENT_SECRET: 'test-web', KEYCLOAK_ADMIN_CLIENT_SECRET: 'test-service',
  NEXTAUTH_SECRET: 'test-session', APP_DOMAIN: 'ledger.example.com',
  AUTH_DOMAIN: 'auth.example.com', ACME_EMAIL: 'ops@example.com',
  APP_IMAGE: 'ledger-app:test', WORKER_IMAGE: 'ledger-worker:test',
  MIGRATION_IMAGE: 'ledger-migrations:test', LEDGER_KEK_FILE: '/tmp/kek',
  SMTP_RELAYHOST: 'smtp.example.com:587', SMTP_SENDER_DOMAINS: 'example.com',
  ECUADOR_HOLIDAYS: '2026-01-01',
};
const compose = (...args) => execFileSync('docker', ['compose', '--env-file', '/dev/null',
  '-f', 'infra/docker-compose.production.yml', ...args], { env, encoding: 'utf8' });

test('only TLS proxy publishes ports; runtime never uses the DDL role', () => {
  const { services } = JSON.parse(compose('config', '--format', 'json'));
  assert.deepEqual(Object.entries(services).filter(([, s]) => s.ports?.length).map(([name]) => name), ['caddy']);
  assert.deepEqual(services.caddy.ports.map(p => Number(p.target)).sort((a, b) => a - b), [80, 443]);
  for (const name of ['app', 'worker']) {
    assert.equal(services[name].environment.PGUSER, 'ledger_app');
    assert.equal(services[name].environment.PGPASSWORD, 'test-app');
    assert.equal(services[name].restart, 'unless-stopped');
    assert.equal(services[name].depends_on.migrate.condition, 'service_completed_successfully');
  }
});

test('identity uses durable PostgreSQL and the canonical HTTPS issuer', () => {
  const { services } = JSON.parse(compose('config', '--format', 'json'));
  assert.deepEqual(services.keycloak.command, ['start', '--import-realm']);
  assert.equal(services.keycloak.environment.KC_DB, 'postgres');
  assert.equal(services.keycloak.environment.KC_HOSTNAME, 'https://auth.example.com');
  assert.equal(services.app.environment.KEYCLOAK_ISSUER, 'https://auth.example.com/realms/corporativo');
  assert.equal(services.keycloak.environment.KC_PROXY_HEADERS, 'xforwarded');
  assert.ok(services.keycloak.volumes.some(v => v.target.endsWith('/realm-corporativo.json') && v.read_only));
});

test('KEK uses the existing crypto contract; migrations precede runtime', () => {
  const { services, secrets } = JSON.parse(compose('config', '--format', 'json'));
  assert.equal(secrets.credential_kek.file, '/tmp/kek');
  for (const name of ['app', 'worker']) {
    assert.equal(services[name].environment.LEDGER_CREDENTIAL_KEK_FILE, '/run/ledger-secrets/credential-kek');
    assert.equal(services[name].secrets[0].target, '/run/ledger-secrets/credential-kek');
  }
  assert.equal(services.migrate.environment.PGUSER, 'ledger_owner');
  assert.equal(services.migrate.restart, 'no');
  assert.equal(services.migrate.depends_on.postgres.condition, 'service_healthy');
  assert.equal(services.app.environment.LEDGER_OWNER_PASSWORD, undefined);
});

test('missing deployment values fail closed', () => {
  assert.throws(() => execFileSync('docker', ['compose', '--env-file', '/dev/null', '-f',
    'infra/docker-compose.production.yml', 'config', '--quiet'], {
    env: { ...env, APP_IMAGE: '', NEXTAUTH_SECRET: '' }, stdio: 'pipe',
  }), /failed|Command/);
});
