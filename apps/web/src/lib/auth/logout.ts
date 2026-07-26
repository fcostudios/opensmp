"use client";

import { ROUTE_AUTH_LOGOUT } from "../routes";

/** Navigate the browser through Auth.js cleanup and Keycloak RP logout. */
export function logout(): void {
  window.location.assign(ROUTE_AUTH_LOGOUT);
}
