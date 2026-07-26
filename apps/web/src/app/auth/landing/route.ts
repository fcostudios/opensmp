import { NextResponse } from "next/server";

import { auth } from "@/lib/auth/auth-config";
import { publicAppOrigin } from "@/lib/auth/public-app-origin";
import { roleLanding } from "@/lib/auth/role-landing";
import { ROUTE_SCR_LOGIN } from "@/lib/routes";

export async function GET() {
  const session = await auth();
  const destination = session ? roleLanding(session.user) : ROUTE_SCR_LOGIN;
  return NextResponse.redirect(new URL(destination, publicAppOrigin()));
}
