import { PassThrough } from "node:stream";

import { describe, expect, it } from "vitest";

import { createJobLogger } from "./logger.js";

describe("US-046 structured job logging", () => {
  it("emits the required run fields with duration and a redacted failure code", () => {
    const output = new PassThrough();
    let line = "";
    output.setEncoding("utf8");
    output.once("data", (chunk: string) => {
      line = chunk;
    });
    const logger = createJobLogger(output);

    logger.write({
      attempt: 2,
      durationMs: 413,
      errorCode: "credential_failure",
      finishedAt: "2026-07-25T14:15:00.413Z",
      jobId: "3b8fd9f2-3ea1-4a1c-9a79-6a2b4a23c201",
      jobName: "member-sync",
      processed: 0,
      startedAt: "2026-07-25T14:15:00.000Z",
      status: "failed",
    });

    expect(JSON.parse(line)).toEqual({
      attempt: 2,
      durationMs: 413,
      errorCode: "credential_failure",
      finishedAt: "2026-07-25T14:15:00.413Z",
      jobId: "3b8fd9f2-3ea1-4a1c-9a79-6a2b4a23c201",
      jobName: "member-sync",
      processed: 0,
      startedAt: "2026-07-25T14:15:00.000Z",
      status: "failed",
    });
  });
});
