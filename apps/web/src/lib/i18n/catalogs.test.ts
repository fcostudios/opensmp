import { describe, expect, test } from "vitest";

import enUsRaw from "../../../messages/en-US.json";
import esEcRaw from "../../../messages/es-EC.json";
import { loadAppMessages } from "./messages";

function leafPaths(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return [prefix];
  }
  return Object.entries(value).flatMap(([key, child]) =>
    leafPaths(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe("message catalogs", () => {
  test("have recursive key parity and cover every shared workspace vocabulary", async () => {
    const [enUs, esEc] = await Promise.all([
      loadAppMessages("en-US"),
      loadAppMessages("es-EC"),
    ]);
    expect(leafPaths(esEc).sort()).toEqual(leafPaths(enUs).sort());
    expect(Object.keys(esEc)).toEqual(
      expect.arrayContaining([
        "auth",
        "audit",
        "empty",
        "errors",
        "freshness",
        "loading",
        "lifecycle",
        "money",
        "nav",
        "pages",
        "shell",
        "status",
      ]),
    );
    expect(Object.keys(esEc.status)).toHaveLength(12);
  });

  test("locks the Ecuadorian Spanish request-state vocabulary", async () => {
    const esEc = await loadAppMessages("es-EC");
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

  test("localizes the stable checklist assignment-missing failure code", () => {
    expect(enUsRaw.orchestration.exceptionAssignmentMissing).toBe(
      "Member synchronization did not find the attested active assignment.",
    );
    expect(esEcRaw.orchestration.exceptionAssignmentMissing).toBe(
      "La sincronización de miembros no encontró la asignación activa atestada.",
    );
  });

  test("states only the register guarantees enforced by the database", () => {
    expect(enUsRaw.register.integrityContent).toBe(
      "The database prevents overlapping assignments and requires reallocation moves to remain contiguous. Review register-drift alerts when another attribution gap needs investigation.",
    );
    expect(esEcRaw.register.integrityContent).toBe(
      "La base de datos impide asignaciones solapadas y exige continuidad en los movimientos por reasignación. Revisa las alertas de desvío del registro cuando otra brecha de atribución requiera investigación.",
    );
  });

  test("locks the complete bilingual shell vocabulary", () => {
    expect(esEcRaw.shell).toEqual({
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
    expect(enUsRaw.shell).toEqual({
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
