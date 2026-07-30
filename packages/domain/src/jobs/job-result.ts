export type SuccessfulJob = {
  processed: number;
  status: "succeeded";
};

export type SkippedJob = {
  processed: 0;
  reason: "dependency_not_delivered";
  status: "skipped";
  story: `US-${string}`;
};

export type FailedJob = {
  alertRuleId: string;
  errorCode: string;
  processed: number;
  status: "failed";
};

export type JobResult = FailedJob | SuccessfulJob | SkippedJob;

export function successfulJob(processed: number): SuccessfulJob {
  if (!Number.isInteger(processed) || processed < 0) {
    throw new RangeError("processed must be a non-negative integer");
  }

  return { processed, status: "succeeded" };
}

export function dependencyNotDelivered(story: `US-${string}`): SkippedJob {
  if (!/^US-\d+$/.test(story)) {
    throw new TypeError("story must be a US-NNN identifier");
  }

  return {
    processed: 0,
    reason: "dependency_not_delivered",
    status: "skipped",
    story,
  };
}

export function failedJob(
  alertRuleId: string,
  errorCode: string,
  processed: number,
): FailedJob {
  if (!alertRuleId.trim() || !errorCode.trim()) {
    throw new TypeError("failed job identity is required");
  }
  if (!Number.isInteger(processed) || processed < 0) {
    throw new RangeError("processed must be a non-negative integer");
  }
  return { alertRuleId, errorCode, processed, status: "failed" };
}
