"use server";

export async function ping(): Promise<{ ok: true }> {
  return { ok: true };
}
