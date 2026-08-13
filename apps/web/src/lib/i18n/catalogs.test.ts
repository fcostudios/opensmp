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

  test("locks the critical bilingual vendor-account registry vocabulary", () => {
    expect(enUsRaw.vendorAccounts).toMatchObject({
      title: "Vendor organizations",
      form: {
        success: "Organization created. Now add its capacity and credentials.",
        fields: { lowPoolFloor: "Minimum free-license floor" },
      },
      empty: "No vendor organizations have been registered.",
    });
    expect(esEcRaw.vendorAccounts).toMatchObject({
      title: "Organizaciones",
      form: {
        success: "Organización creada. Ahora carga su capacidad y credenciales.",
        fields: { lowPoolFloor: "Umbral mínimo de licencias libres" },
      },
      empty: "No hay organizaciones de proveedor registradas.",
    });
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

  test("locks the complete bilingual SCR-users-roles interaction vocabulary", () => {
    expect(esEcRaw.usersRoles).toMatchObject({
      accountDescription: "Crea una cuenta de acceso y vincúlala a una persona del directorio. La persona recibirá un correo para configurar su contraseña y su 2FA.",
      addRoleDescription: "Otorga un rol de aprobación, finanzas o lectura sobre una compañía. La ventana de vigencia es opcional.",
      addRoleSuccess: "Rol agregado.",
      createSuccess: "Cuenta creada. Enviamos el correo de activación.",
      delegationHelp: "Ventana de delegación temporal: pendiente (R2). Por ahora define solo la vigencia del rol.",
      disableDescription: "La cuenta no podrá ingresar y sus roles por compañía dejan de aplicar. Las licencias de la persona no se tocan: si corresponde, inicia el retiro desde la ficha de la persona.",
      disablePlaceholder: "Ej.: salida de la compañía el 30/06/2026",
      disableSuccess: "Cuenta desactivada. Queda registrado en auditoría.",
      emailPlaceholder: "nombre@compania.ec",
      error: "No pudimos completar la acción. Revisa los datos e inténtalo de nuevo.",
      globalRoleHelp: "Déjalo vacío si la cuenta solo tendrá roles por compañía.",
      globalRoleOptional: "Rol global (opcional)",
      personHelp: "Busca por nombre o correo en el directorio de personas.",
      removeDescription: "El usuario dejará de ver y operar esa compañía con este rol. La acción queda registrada en auditoría.",
      removePlaceholder: "Ej.: fin del encargo de aprobación en Opina",
      removeRoleSuccess: "Rol quitado.",
      resetDescription: "Se invalidará el TOTP actual de la cuenta y la persona deberá configurarlo de nuevo en su próximo ingreso.",
      resetPlaceholder: "Ej.: cambió de teléfono y perdió el autenticador",
      resetSuccess: "2FA restablecido. Queda registrado en auditoría.",
      submitting: "Enviando",
      userHelp: "Busca por correo de la cuenta.",
      validFromOptional: "Vigente desde (opcional)",
      validToOptional: "Vigente hasta (opcional)",
    });
    expect(enUsRaw.usersRoles).toMatchObject({
      accountDescription: "Create an access account and link it to a person in the directory. The person will receive an email to configure their password and 2FA.",
      addRoleDescription: "Grant an approval, finance, or read-only role for one company. The validity window is optional.",
      addRoleSuccess: "Role added.",
      createSuccess: "Account created. We sent the activation email.",
      delegationHelp: "Temporary delegation windows are pending (R2). For now, these dates define only the role's validity.",
      disableDescription: "The account will no longer be able to sign in and its company roles will stop applying. The person's licenses are unchanged; when applicable, start offboarding from the person's record.",
      disablePlaceholder: "Example: left the company on 06/30/2026",
      disableSuccess: "Account disabled. The action is recorded in the audit log.",
      emailPlaceholder: "name@company.ec",
      error: "We couldn't complete the action. Review the data and try again.",
      globalRoleHelp: "Leave this empty if the account will only have company roles.",
      globalRoleOptional: "Global role (optional)",
      personHelp: "Search the people directory by name or email.",
      removeDescription: "The user will no longer be able to view or operate this company with this role. The action is recorded in the audit log.",
      removePlaceholder: "Example: approval assignment for Opina ended",
      removeRoleSuccess: "Role removed.",
      resetDescription: "The account's current TOTP will be invalidated and the person must configure it again at the next sign-in.",
      resetPlaceholder: "Example: changed phones and lost the authenticator",
      resetSuccess: "2FA reset. The action is recorded in the audit log.",
      submitting: "Submitting",
      userHelp: "Search by account email.",
      validFromOptional: "Valid from (optional)",
      validToOptional: "Valid to (optional)",
    });
  });
});
