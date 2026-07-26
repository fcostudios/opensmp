# Go-live import

The committed CSVs are synthetic format examples. Never replace them with
operator exports or real addresses.

The import sequence is:

1. Call the read-only preview with all three exact CSV contracts.
2. Resolve every reported error before running the mutation.
3. Run the import once as a Ledger `group_admin`.
4. Review the returned reconciliation by vendor organization and license type.

The parser rejects unknown or reordered columns and any header that resembles a
credential, token, password, or secret. Company codes and emails are normalized;
all references are validated before the transaction mutates the database.

Vendor credentials are not CSV fields. They enter only through the server-side
secret channel, are encrypted with XChaCha20-Poly1305 under a random data key,
and the data key is wrapped by a 32-byte KEK. The KEK is a base64 value read from
the Docker secret file configured by the operator. Production code never accepts
the KEK from a browser request.

The import uses deterministic natural keys, including an `IMP-<hash>` request
number for every seat. Repeating identical inputs creates no new company,
contact grant, request, assignment, capacity, or credential.

Real execution remains gated on OQ-SMP-1: the final company inventory, exported
members, purchased capacity, and per-organization Admin/Analytics keys must be
delivered through their approved private channels. Do not use these templates as
substitute operational evidence.
