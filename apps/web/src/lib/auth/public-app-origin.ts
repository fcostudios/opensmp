type PublicOriginEnvironment = Readonly<
  Partial<Record<"AUTH_URL" | "NEXTAUTH_URL" | "NODE_ENV", string | undefined>>
>;

const localDevelopmentOrigin = "http://localhost:3000";

export function publicAppOrigin(
  environment: PublicOriginEnvironment = process.env,
): string {
  const configured = environment.AUTH_URL ?? environment.NEXTAUTH_URL;
  if (!configured && environment.NODE_ENV === "development") {
    return localDevelopmentOrigin;
  }
  try {
    const url = new URL(configured ?? "");
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      throw new Error("unsafe origin components");
    }
    return url.origin;
  } catch {
    throw new Error("AUTH_URL or NEXTAUTH_URL must be a valid public application origin");
  }
}
