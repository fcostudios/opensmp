# External acceptance blockers

## US-048 — recovery (2026-11-01)

- **ADR-03 break-glass implementation absent.** The current release registers
  only Keycloak and rejects non-Keycloak sign-ins. The IT Director needs a
  release providing the contracted deploy-time enablement, sealed one-time
  Compose secret, TOTP, first-login/24-hour disablement and audit/alert checks.
  Do not invent enablement commands or certify AC1 from a checklist alone.
- **Nightly/off-host proof pending.** A new encrypted backup of the live
  localhost register was actually restored and exactly verified, but it was a
  manual run; the private keys remain localhost rehearsal material. The
  IT Director must retrieve independent escrow and a previous-night scheduled
  artifact. No statements existed in this snapshot, so finance totals cannot
  yet be compared.
- **Production journey pending.** The release image serves recovery docs
  without identity configuration; the existing localhost app was left running
  its prior image. Deploy the committed release and have the IT Director
  complete the recovery journey without SCR-credentials. Only humans record
  production acceptance. Provisional rates remain provisional (DEC-SMP-066).

Evidence and exact limits: [US-048 recovery record](../runbooks/us-048-recovery-evidence.md).
Triaged at the slice demo under `10_plan.md` SEC3; no new work ID is allocated
here, and no other story's scope or status is changed.
