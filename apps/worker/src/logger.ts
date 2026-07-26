import type { Writable } from "node:stream";

export type JobRunLog = {
  attempt: number;
  durationMs: number;
  errorCode: string | null;
  finishedAt: string;
  jobId: string;
  jobName: string;
  processed: number;
  reason?: "dependency_not_delivered";
  startedAt: string;
  status: "failed" | "skipped" | "succeeded";
  story?: `US-${string}`;
};

export type JobLogger = {
  write(entry: JobRunLog): void;
};

export function createJobLogger(output: Writable = process.stdout): JobLogger {
  return {
    write(entry) {
      output.write(`${JSON.stringify(entry)}\n`);
    },
  };
}
