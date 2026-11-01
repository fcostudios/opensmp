import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';

test('production dump is signed, checksum-bound, decryptable and contains the RLS table', () => {
  const fixture = process.env.BACKUP_FIXTURE_DIR;
  assert.ok(fixture, 'BACKUP_FIXTURE_DIR names the private rehearsal fixture');
  const backups = readdirSync(`${fixture}/backups`).filter(name => /^ledger-\d{14}\.dump\.age$/.test(name)).sort();
  assert.ok(backups.length > 0, 'a complete encrypted dump was published');
  const basename = backups.at(-1);
  const encrypted = readFileSync(`${fixture}/backups/${basename}`);
  const digest = createHash('sha256').update(encrypted).digest('hex');
  const manifest = Object.fromEntries(readFileSync(`${fixture}/backups/${basename}.manifest`, 'utf8').trim().split('\n').map(line => line.split('=')));
  assert.equal(manifest.ciphertext_sha256, digest);
  assert.equal(Number(manifest.ciphertext_size), encrypted.length);
  assert.equal(manifest.basename, basename);
  const contents = execFileSync('docker', ['run', '--rm', '--user', `${process.getuid()}:${process.getgid()}`, '-v', `${fixture}:/fixture:ro`,
    '--entrypoint', 'sh', 'ledger-backup:local', '-ec', `
      minisign -Vm "/fixture/backups/$1.manifest" -p /fixture/backup-verify.pub -q
      age -d -i /fixture/backup-age.key -o /tmp/verified.dump "/fixture/backups/$1"
      pg_restore --list /tmp/verified.dump
    `, 'verify', basename], { encoding: 'utf8' });
  assert.match(contents, /TABLE public member_observation /);
  assert.match(contents, /TABLE DATA public member_observation /);
  assert.match(contents, /ROW SECURITY public member_observation /);
});
