// CHG-121 — the demo wrapper's safety guards refuse before any stack-changing
// Docker call. A stub `docker` on PATH records every invocation; nothing real
// is touched. Run: node --test infra/tests/demo-guards.test.mjs
import { spawnSync } from 'node:child_process';
import { strict as assert } from 'node:assert';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

const fakeBin = mkdtempSync(join(tmpdir(), 'demo-guards-bin-'));
const callLog = join(fakeBin, 'docker-calls.log');
writeFileSync(join(fakeBin, 'docker'), `#!/bin/sh\necho "$*" >> "${callLog}"\nexit 0\n`);
chmodSync(join(fakeBin, 'docker'), 0o755);
after(() => rmSync(fakeBin, { recursive: true, force: true }));

function run(script, args = [], env = {}) {
  writeFileSync(callLog, '');
  const result = spawnSync('bash', [`infra/production/${script}`, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}`,
      DEMO_STATE_DIR: join(fakeBin, 'state'), ...env },
  });
  return { ...result, calls: readFileSync(callLog, 'utf8').split('\n').filter(Boolean) };
}

const stackChanging = (calls) => calls.filter((call) => !/^(ps|volume ls|image inspect) /.test(call));

for (const project of ['ledger-production', 'ledger-production-rehearsal']) {
  test(`demo:up and demo:down refuse the production project ${project}`, () => {
    for (const script of ['demo-up.sh', 'demo-down.sh']) {
      const result = run(script, [], { DEMO_PROJECT: project });
      assert.equal(result.status, 1, `${script} must refuse ${project}`);
      assert.match(result.stderr, /never the production project/);
      assert.deepEqual(result.calls, [], `${script} called docker before refusing`);
    }
  });
}

test('demo:up refuses a state dir under the production data directory', () => {
  const result = run('demo-up.sh', [], { DEMO_STATE_DIR: `${process.env.HOME}/.local/share/smp/production/demo` });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /production data/);
  assert.deepEqual(result.calls, []);
});

test('demo:up rejects unknown arguments', () => {
  const result = run('demo-up.sh', ['--emtpy']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /unknown argument/);
  assert.deepEqual(result.calls, []);
});

test('demo:up refuses when the demo HTTPS port is already taken, before building anything', async () => {
  const server = createServer();
  const listening = await new Promise((resolve) => {
    server.once('error', () => resolve(false));
    server.listen(28443, '127.0.0.1', () => resolve(true));
  });
  try {
    // If something else already holds 28443 the guard must refuse all the same.
    const result = run('demo-up.sh');
    assert.equal(result.status, 1);
    assert.match(result.stderr, /port 28443/);
    assert.deepEqual(stackChanging(result.calls), [], 'no build/compose call before the port refusal');
    assert.equal(existsSync(join(fakeBin, 'state')), false, 'state dir must not be created');
  } finally {
    if (listening) await new Promise((resolve) => server.close(resolve));
  }
});

test('rehearse.sh refuses a non-empty REHEARSAL_DIR (it appends to runtime.env)', () => {
  const dir = mkdtempSync(join(fakeBin, 'stack-'));
  writeFileSync(join(dir, 'runtime.env'), 'X=1\n');
  writeFileSync(callLog, '');
  const result = spawnSync('bash', ['infra/production/rehearse.sh'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}`, REHEARSAL_DIR: dir,
      PRODUCTION_PROJECT: 'ledger-demo-guards' },
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /existing empty directory/);
  assert.equal(readFileSync(join(dir, 'runtime.env'), 'utf8'), 'X=1\n');
  assert.equal(readFileSync(callLog, 'utf8'), '');
});
