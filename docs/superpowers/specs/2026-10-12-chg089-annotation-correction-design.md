# CHG-089 exact append-only integration annotation correction

Authority: canonical Nous/WorkControl/fcostudios/smp/CHG-089_TECH_SPEC.md at 7e239ee, operator request dbf03c249f9f04ee83968d4bf87450c26acb0887, standing approval of assessed stages. Readiness: docs/readiness/CHG-089.json, digest a57d243512603239d509e80719e49b5501c80674b823362207d4dba6afaa1882, 80 minutes.

## Contract
Extend existing lifecycle_corrected only for the exact US-024 deviation at 2026-10-12T03:00:34.941232Z whose original line bytes excluding terminator hash to d1dba52d00fd4b60aa47a2654e4ee4c82f229370966d1dcdfea2c5911b6150bd. Add target content digest and prior CHG-089 authority binding (digest/evidence) to the closed correction shape. Existing historical-start channel retains its exact shape and behavior.

Carry original parsed line bytes alongside records without adding serialized ledger fields. Hash original UTF-8 bytes; no JSON reserialization identity. CLI and Git revision parsers use the same byte-preserving interpretation. Validate exactly one earlier own-story target, canonical fixed identity, unique correction, explicit chronology, nonempty operator reason/approver and independently ready active technical CHG-089 artifact with matching prior approval. Validate authority against raw history prefix and without parent projection, so no circular authorization. Revoked/inactive/completed/missing/forged authorities fail closed. Artifact declarations alone are insufficient.

Projection omits only the targeted non-execution deviation from lifecycle execution scans; retain all original and correction audit rows. Parent partition_required assessment, original approval019a1da and original ledger prefix remain immutable. No production, routing, threshold or instrumentation change. No generalized deviation suppression or content heuristics. Raw feedback history ownership checks unchanged.

## Verification and closure
Focused real-Git contracts first demonstrate uncorrected RED and corrected GREEN with original prefix/parent invariant assertions; authority/identity/execution/ambiguity/duplicate and raw-history adversarial negatives. Scoped review examines code and evidence, fresh adversarial review independently attacks ACs. Append actual correction only after authority committed. CHG-090 pins changed source after review-green checkpoint; stock awake full gate after both repairs. No done/build_pass before coordinated gate succeeds. Zero mutatable TypeScript sources; no borrowed US-086 score.
