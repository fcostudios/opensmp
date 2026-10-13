import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { WorkReadinessError, validateOwnedScopeShape } from "../work-readiness/model.mjs";
import { loadCommittedReadinessAuthority } from "../work-readiness/git.mjs";

export { validateOwnedScopeShape };

function reject(path, message) {
  throw new WorkReadinessError("WR_OWNED_SCOPE_AUTHORITY", message, path);
}

function requireDiskBinding(authority) {
  const path = `docs/readiness/${authority.artifact.work_id}.json`;
  try {
    const absolute = join(authority.root, path);
    const stat = lstatSync(absolute);
    if (!stat.isFile() || stat.isSymbolicLink() || !readFileSync(absolute).equals(authority.bytes)) reject(path, "Working artifact differs from committed authority");
    const diskLines = readFileSync(join(authority.root, ".nous-feedback.jsonl"), "utf8").split("\n");
    const committedLines = (authority.feedbackText ?? "").split("\n");
    for (const record of authority.feedbackRecords.filter(record => record.event === "decision" && record.id === authority.artifact.approval.evidence)) {
      const matching = committedLines.filter(line => { try { const value = JSON.parse(line); return value.event === "decision" && value.id === record.id; } catch { return false; } });
      if (matching.length !== 1 || !diskLines.includes(matching[0])) reject(".nous-feedback.jsonl", "Approval record differs from committed authority");
    }
  } catch (error) {
    if (error instanceof WorkReadinessError) throw error;
    reject(path, "Committed authority is unavailable in the working tree");
  }
}

export function loadApprovedOwnedScope({ root, governingWorkId, subjectWorkId, executionHead }) {
  const governing = loadCommittedReadinessAuthority({ root, revision: executionHead, workId: governingWorkId });
  requireDiskBinding(governing);
  if (governing.artifact.kind !== "CHG" || governing.artifact.work_type !== "technical" || governing.assessment.decision !== "ready" || !governing.assessment.active) reject("$.governingWorkId", "Owned scope requires active ready technical CHG authority");
  const scope = validateOwnedScopeShape(governing.artifact.mutation_scope);
  if (scope.subject_work_id !== subjectWorkId) reject("$.subjectWorkId", "Owned scope authority is for a different subject");
  const subject = loadCommittedReadinessAuthority({ root, revision: executionHead, workId: subjectWorkId });
  requireDiskBinding(subject);
  if (subject.assessment.decision !== "ready" || (!subject.assessment.active && !subject.assessment.complete) || subject.artifact.approval.status !== "approved") reject("$.subjectWorkId", "Owned scope subject requires valid approval");
  if (scope.subject_readiness_sha256 !== subject.artifact.readiness_payload_sha256) reject("$.mutation_scope.subject_readiness_sha256", "Owned scope subject digest differs from approved payload");
  return { scope, governingDigest: governing.artifact.readiness_payload_sha256, subjectDigest: subject.artifact.readiness_payload_sha256 };
}
