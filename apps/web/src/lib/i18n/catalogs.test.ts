import { describe, expect, test } from "vitest";

import enUs from "../../../messages/en-US.json";
import esEc from "../../../messages/es-EC.json";

function leafPaths(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return [prefix];
  }
  return Object.entries(value).flatMap(([key, child]) =>
    leafPaths(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe("message catalogs", () => {
  test("have recursive key parity and cover every shared workspace vocabulary", () => {
    expect(leafPaths(esEc).sort()).toEqual(leafPaths(enUs).sort());
    expect(Object.keys(esEc)).toEqual(
      expect.arrayContaining([
        "auth",
        "audit",
        "empty",
        "errors",
        "freshness",
        "loading",
        "money",
        "nav",
        "pages",
        "shell",
        "status",
      ]),
    );
    expect(Object.keys(esEc.status)).toHaveLength(12);
  });

  test("locks the Ecuadorian Spanish request-state vocabulary", () => {
    expect(esEc.status).toEqual({
      submitted: "Enviada",
      pending_approval: "Pendiente de aprobación",
      approved: "Aprobada",
      blocked_no_seat: "Bloqueada: sin licencia disponible",
      provisioning: "Aprovisionando",
      failed: "Fallida",
      invited: "Invitación enviada",
      active: "Activa",
      flagged_inactive: "Marcada inactiva",
      offboarding: "En retiro",
      deprovisioned: "Retirada",
      rejected: "Rechazada",
    });
  });

  test("locks the complete bilingual shell vocabulary", () => {
    expect(esEc.shell).toEqual({
      administration: "ADMINISTRACIÓN",
      breadcrumbs: "Migas de pan",
      closeMenu: "Cerrar menú",
      finance: "FINANZAS",
      language: "Idioma",
      mainNavigation: "Navegación principal",
      menu: "Menú",
      mobileNavigation: "Navegación móvil",
      operation: "OPERACIÓN",
      skipToContent: "Saltar al contenido",
      userMenu: "Cuenta de usuario",
    });
    expect(enUs.shell).toEqual({
      administration: "ADMINISTRATION",
      breadcrumbs: "Breadcrumbs",
      closeMenu: "Close menu",
      finance: "FINANCE",
      language: "Language",
      mainNavigation: "Main navigation",
      menu: "Menu",
      mobileNavigation: "Mobile navigation",
      operation: "OPERATIONS",
      skipToContent: "Skip to content",
      userMenu: "User account",
    });
  });
});
