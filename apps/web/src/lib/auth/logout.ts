"use client";

import {{ signOut }} from "next-auth/react";

/**
 * Full logout: clears NextAuth session AND ends Keycloak SSO session.
 * Use this instead of raw signOut() to ensure SSO session is terminated.
 */
export async function logout() {{
  // NextAuth signOut triggers the server-side events.signOut callback
  // which calls Keycloak's end-session endpoint
  await signOut({{ callbackUrl: "/" }});
}}
