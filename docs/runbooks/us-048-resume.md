# US-048 continuation record

The scheduled artifact `ledger-20261102070006.dump.age` has now been restored
through the repaired guarded path. The prior one-shot watcher left only its
waiting state; the resumed session performed and reviewed the actual drill.

Current evidence and comparison details:
[US-048 recovery evidence](us-048-recovery-evidence.md) and
[per-company scheduled restore record](../evidence/us-048/scheduled-restore.json).
The exact counts and SHA-256 hashes match the live source for all five
provisional companies. Fresh and recovered targets pass all 69 committed
migrations and exact runtime-grant verification.

Development completion uses canonical `done`. Only the IT Director records
human recovery/escrow acceptance at the S4 demo. Those unperformed portions
remain `ac_unverifiable`; no production `verified` event is claimed. Break-glass
remains R2 FEAT-R2-13 under DEC-SMP-067 / CHG-115.
