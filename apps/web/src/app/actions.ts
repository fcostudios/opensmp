"use server";

/** @read-only-action Health-style scaffold probe; performs no mutation. */
export async function ping(): Promise<{ ok: true }> {
  return { ok: true };
}
