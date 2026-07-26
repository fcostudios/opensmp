# Go-live import

The committed CSVs are synthetic format examples. Never replace them with
operator exports or real addresses.

The import sequence is:

1. Place the real credential manifest under `data/imports/private/` (gitignored).
2. Set `LEDGER_CREDENTIAL_MANIFEST_FILE` to its absolute path and
   `LEDGER_CREDENTIAL_KEK_FILE` to the Docker-secret file containing the
   base64-encoded 32-byte KEK.
3. Export every environment variable named by the manifest.
4. Call the read-only preview with all three exact CSV contracts.
5. Resolve every reported error before running the mutation.
6. Run the import once as a Ledger `group_admin`.
7. Review the returned reconciliation by vendor organization and license type.

The parser rejects unknown or reordered columns and any header that resembles a
credential, token, password, or secret. Company codes and emails are normalized;
all references are validated before the transaction mutates the database.
The companies file must contain exactly 30 rows. Capacity accepts exactly one
row per `(vendor_org_ref, license_type)` go-live snapshot.

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

For the self-hosted Compose deployment, set
`LEDGER_CREDENTIAL_MANIFEST_SOURCE` and `LEDGER_CREDENTIAL_KEK_SOURCE` to
operator-owned host files outside the repository. Compose mounts both files
read-only and sets the application paths to
`/run/ledger-secrets/go-live-credential-manifest.json` and
`/run/ledger-secrets/integration-credential.kek`. Inject the credential
environment variables named by the manifest through the private deployment
environment; never add their values to `.env.example` or a committed override.

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
