# Go-live import

The committed CSVs are synthetic format examples. Never replace them with
operator exports or real addresses.

The import sequence is:

1. Place the real credential manifest under `data/imports/private/` (gitignored).
2. Copy `infra/credential-runtime.env.example` to an operator-owned private
   location and fill every environment variable named by the real manifest.
3. Set `LEDGER_CREDENTIAL_MANIFEST_SOURCE`,
   `LEDGER_CREDENTIAL_KEK_SOURCE`, and `LEDGER_CREDENTIAL_RUNTIME_ENV_FILE`
   to the operator-owned manifest, base64-encoded 32-byte KEK, and private
   runtime environment file.
4. Call the read-only preview with all three exact CSV contracts.
5. Resolve every reported error before running the mutation.
6. Run the import once as a Ledger `group_admin`.
7. Review the returned reconciliation by vendor organization and license type.

The parser rejects unknown or reordered columns and any header that resembles a
credential, token, password, or secret. Company codes and emails are normalized;
all references are validated before the transaction mutates the database.
Five companies is the DEC-SMP-018 MVP baseline. The importer accepts the
operator's complete validated inventory through the same path, including the
approved six-company fixture and the 30-company rollout; company count is not a
parser invariant. Capacity accepts exactly one row per
`(vendor_org_ref, license_type)` go-live snapshot.

Vendor credentials are not CSV fields. They enter only through the server-side
secret channel, are encrypted with XChaCha20-Poly1305 under a random data key,
and the data key is wrapped by a 32-byte KEK. The KEK is a base64 value read from
the Docker secret file configured by the operator. Production code never accepts
the KEK, manifest path, environment-variable names, or credential values from a
browser request or CSV.

The manifest contract is shown by
`templates/credential-manifest.example.json`. It is strict JSON:
`version` must be `1`, every capacity organization must appear exactly once, and
each organization names one Admin environment variable and one different
Analytics environment variable. Every name and value must be present and unique;
Admin and Analytics key material must differ. The manifest stores names only,
never secrets.

The normal self-hosted Compose stack has no dependency on go-live import
artifacts. For an import invocation, add the optional
`infra/docker-compose.import.yml` overlay after `infra/docker-compose.yml`.
The overlay loads the operator-owned runtime env file, mounts the manifest and
KEK read-only, and sets the application paths to
`/run/ledger-secrets/go-live-credential-manifest.json` and
`/run/ledger-secrets/integration-credential.kek`:

```bash
docker compose --env-file .env \
  --file infra/docker-compose.yml \
  --file infra/docker-compose.import.yml \
  up --detach app
```

The app runs as numeric UID/GID `1001:1001`. Install the KEK as either
`1001:1001` mode `0400` or `root:1001` mode `0440`; for example:

```bash
sudo install -o root -g 1001 -m 0440 /private/source/integration-credential.kek \
  /srv/ledger/secrets/integration-credential.kek
```

The manifest must also be readable by UID/GID `1001:1001` and must not be
writable by the container. The private runtime env file is read by Compose on
the host and should remain operator-owned mode `0600`.

Never add credential values to `.env.example`, the synthetic runtime template,
or a committed override.

## Local synthetic fixture

See the [US-007 local fixture runbook](../runbooks/US-007_LOCAL_FIXTURE.md) for
the approved six-company inventory. Synthetic Teams credentials are
nonfunctional placeholders solely for exercising the encrypted-storage path
until US-055 supplies API-less ingestion.

The import uses deterministic natural keys, including an `IMP-<hash>` request
number for every seat. Repeating identical inputs creates no new company,
contact grant, request, assignment, capacity, or credential. Dry-run reports
credential inserts/existing matches/conflicts without returning secret values.

Reconciliation has two independent zero checks. `memberDelta` compares console
members with active imported assignments. `capacityDelta` compares the purchased
quantity in the CSV with the persisted capacity row. Purchased capacity may
legitimately exceed occupied seats; spare seats do not fail reconciliation.

Run the reproducible focused mutation gate from the repository root:

```bash
pnpm exec stryker run stryker.us007.conf.json
```

Real execution remains gated on OQ-SMP-1: the final company inventory, exported
members, purchased capacity, and per-organization Admin/Analytics keys must be
delivered through their approved private channels. Do not use these templates as
substitute operational evidence.
