import { NextResponse } from "next/server";

type DatabaseCheck = () => Promise<unknown>;

export async function createHealthResponse(checkDatabase: DatabaseCheck) {
  try {
    await checkDatabase();
    return NextResponse.json({ status: "ok", database: "reachable" });
  } catch {
    return NextResponse.json({ status: "unavailable" }, { status: 503 });
  }
}
