// IMP-238 — serverless API route (Next.js App Router route handler).
// In the next-serverless stack, route handlers + server actions ARE
// the backend (no separate apps/api service).
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ status: "ok" });
}
