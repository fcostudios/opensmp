import { signIn } from "@/lib/auth/auth-config";

export async function GET(): Promise<never> {
  await signIn("keycloak", { redirectTo: "/auth/landing" });
  throw new Error("OIDC sign-in redirect did not terminate the request");
}
